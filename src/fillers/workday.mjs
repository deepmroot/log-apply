import { clickOptionText, fillText, firstMatch, pickOption, ruleFor, visibleOptions, wantsCheck } from "./kit.mjs";

export async function workday(page, ctx, H, state) {
  const R = ctx.rules;
  const me = ctx.me;
  const sel = (id) => page.locator('[data-automation-id="' + id + '"]');
  const byId = (id) => page.locator('[id="' + id + '"]');
  const bodyText = () => page.evaluate(() => document.body.innerText);
  const activeStep = () => page.evaluate(() => (((document.querySelector("[data-automation-id=progressBarActiveStep]") || {}).innerText || "") + " :: " + [...document.querySelectorAll("h2, h3")].map((h) => h.innerText.trim()).filter(Boolean).join(" / ")).replace(/\s+/g, " "));
  const clickFilterOr = async (label, fallbackId) => {
    const f = page.locator('[data-automation-id=click_filter][aria-label="' + label + '"]');
    if (await f.count()) await f.first().click();
    else if (fallbackId) await sel(fallbackId).first().click();
  };
  const ended = async () => {
    const t = await bodyText();
    if (/already applied for this job|You've already applied/i.test(t)) return { status: "alreadyApplied", detail: "Workday says this job was already applied to" };
    if (/doesn.t exist|no longer (available|accepting)|job posting is no longer/i.test(t)) return { status: "closed", detail: "the posting is closed" };
    return null;
  };
  const signIn = async () => {
    if (!(await sel("signInSubmitButton").count())) {
      const l = sel("signInLink");
      if (await l.count()) {
        await l.click();
        await H.sleep(3000);
      }
    }
    await sel("email").fill(ctx.account.email);
    await sel("password").fill(ctx.account.password);
    await clickFilterOr("Sign In", "signInSubmitButton");
    await H.sleep(9000);
    page = await H.refresh();
    if (/wrong email address or password|account might be locked/i.test(await bodyText())) return false;
    return true;
  };

  if (state.step === 0) {
    const gone = await ended();
    if (gone) return { done: true, result: gone };
    if (!/[/]apply/i.test(page.url())) page = await H.goto(ctx.applyUrl);
    const g = page.locator("[data-automation-id=GoogleSignInButton]");
    if (ctx.google && (await g.count())) {
      await g.first().click();
      await H.sleep(10000);
      page = await H.refresh();
      H.log("signed in with Google");
    } else if (await sel("createAccountSubmitButton").count()) {
      if (ctx.account.isNew) {
        await sel("email").fill(ctx.account.email);
        await sel("password").fill(ctx.account.password);
        await sel("verifyPassword").fill(ctx.account.password);
        const cb = sel("createAccountCheckbox");
        if (await cb.count()) await cb.check({ force: true });
        await clickFilterOr("Create Account", "createAccountSubmitButton");
        await H.sleep(9000);
        page = await H.refresh();
        H.log("account created on", ctx.host);
        const tenant = ctx.host.split(".")[0];
        const link = await H.mail("verify " + tenant, "(https:[^ )<>\"]*" + tenant + "[^ )<>\"]*activate[^ )<>\"]*)", 30).catch(() => null);
        if (link) {
          page = await H.goto(link);
          H.log("verified the account by email");
        }
        page = await H.goto(ctx.applyUrl);
      }
      if (!(await signIn())) return { done: true, result: { status: "signInFailed", detail: "Workday refused the saved password for " + ctx.host } };
      if (!/[/]apply/i.test(page.url())) page = await H.goto(ctx.applyUrl);
    } else if ((await sel("signInSubmitButton").count()) || (await sel("password").count())) {
      if (!(await signIn())) return { done: true, result: { status: "signInFailed", detail: "Workday refused the saved password for " + ctx.host } };
      if (!/[/]apply/i.test(page.url())) page = await H.goto(ctx.applyUrl);
    }
    return { state: { step: 1, pages: 0, prev: "" }, done: false };
  }

  if (state.step === 1) {
    page = await H.refresh();
    const gone = await ended();
    if (gone) return { done: true, result: gone };
    if (/Something went wrong|Please refresh the page and then try again/i.test(await bodyText())) {
      const tries = (state.siteErrors || 0) + 1;
      if (tries > 2) return { done: true, result: { status: "siteError", detail: "Workday kept showing \"Something went wrong\" on " + ctx.host } };
      H.log("Workday error page; reloading", tries);
      page = await H.goto(ctx.applyUrl);
      return { state: { ...state, siteErrors: tries }, done: false };
    }
    const step = await activeStep();
    H.log("page", step);
    if (/Application Submitted|jobTasks\/completed/i.test(step + page.url())) return { done: true, result: { status: "alreadyApplied", detail: "already submitted" } };
    if (/Candidate Home/i.test(step) || (!/step [0-9]+ of/i.test(step) && !state.reentered)) {
      page = await H.goto(ctx.applyUrl);
      state = { ...state, reentered: /Candidate Home/i.test(step) ? state.reentered : true };
      return { state: { ...state, pages: state.pages + 1 }, done: false };
    }
    if (/Review/i.test(step)) return { state: { step: 2 }, done: !ctx.submit, result: { status: "filled", detail: "filled to Review and left unsubmitted (dry run)" } };
    if (state.prev === step && state.stuck) return { done: true, result: { status: "stuck", detail: "the same page twice with errors: " + step, errors: state.errors } };

    if (/My Information/i.test(step)) await safely("my information", myInformation);
    else if (/My Experience/i.test(step)) await safely("my experience", myExperience);
    else await safely("questions", questions);

    const before = await activeStep();
    const nextBtn = page.locator("[data-automation-id=pageFooterNextButton], [data-automation-id=bottom-navigation-next-button]").first();
    const f = page.locator('[data-automation-id=click_filter][aria-label="Save and Continue"], [data-automation-id=click_filter][aria-label="Next"]').first();
    if (await f.count()) await f.click();
    else if (await nextBtn.count()) await nextBtn.click();
    await H.sleep(7000);
    page = await H.refresh();
    const after = await activeStep();
    const errors = await page.evaluate(() => [...document.querySelectorAll("[data-automation-id=errorMessage], [data-automation-id=inputAlert], [role=alert]")].map((e) => e.innerText.trim()).filter((t) => t && !/successfully uploaded|page is loaded/i.test(t)).slice(0, 8));
    if (errors.length) H.log("errors", JSON.stringify(errors));
    if (state.pages > 14) return { done: true, result: { status: "stuck", detail: "more than 14 wizard pages" } };
    return { state: { step: 1, pages: state.pages + 1, prev: before, stuck: before === after && errors.length > 0, errors, reentered: state.reentered }, done: false };
  }

  if (state.step === 2) {
    if (!ctx.submit) return { done: true, result: { status: "filled", detail: "filled to Review and left unsubmitted (dry run)" } };
    await clickFilterOr("Submit", "pageFooterNextButton");
    await H.sleep(10000);
    page = await H.refresh();
    const t = await bodyText();
    if (/Application Submitted|received your application|successfully submitted/i.test(t) || /jobTasks\/completed/.test(page.url())) return { done: true, result: { status: "submitted", detail: page.url() } };
    return { done: true, result: { status: "notConfirmed", detail: (t.match(/.{0,80}(error|required).{0,80}/i) || ["no confirmation after Submit"])[0] } };
  }
  return { done: true, result: { status: "stopped", detail: "unknown step " + state.step } };

  async function dropdownById(id, patterns) {
    const b = byId(id);
    if (!(await b.count())) return;
    const now = (await b.innerText().catch(() => "")).trim();
    if (now && now !== "Select One" && firstMatch([now], patterns)) return;
    await clickCentre(b);
    await H.sleep(900);
    const pick = firstMatch(await visibleOptions(page), patterns);
    if (pick) await clickOptionText(page, pick);
    else await page.keyboard.press("Escape");
    await H.sleep(600);
    H.log(id, pick || "MISS");
  }

  async function selectedNear(id, allowPlus) {
    return page.evaluate(([id, allowPlus]) => {
      let n = document.getElementById(id);
      for (let k = 0; k < 3 && n; k++) {
        n = n.parentElement;
        const s = n && n.querySelector("[data-automation-id=selectedItem]");
        if (s && (allowPlus || !/[+][0-9]/.test(s.innerText))) return s.innerText.trim();
      }
      return "";
    }, [id, Boolean(allowPlus)]);
  }

  async function safely(name, fn) {
    try {
      await fn();
    } catch (e) {
      H.log("skipped " + name, String(e.message).split(String.fromCharCode(10))[0].slice(0, 120));
      await page.keyboard.press("Escape").catch(() => {});
    }
  }

  async function tick(loc) {
    await loc.check({ force: true }).catch(() => {});
    if (await loc.isChecked().catch(() => false)) return true;
    const box = await loc.evaluate((e) => {
      const t = (e.labels && e.labels[0]) || e;
      t.scrollIntoView({ block: "center" });
      const r = t.getBoundingClientRect();
      return [r.x + Math.min(12, r.width / 2), r.y + r.height / 2];
    });
    await page.mouse.click(box[0], box[1]);
    await H.sleep(300);
    return loc.isChecked().catch(() => false);
  }

  async function clickCentre(loc) {
    await page.keyboard.press("Escape").catch(() => {});
    await page.mouse.click(4, 4).catch(() => {});
    await H.sleep(300);
    const box = await loc.evaluate((e) => {
      e.scrollIntoView({ block: "center" });
      const r = e.getBoundingClientRect();
      return [r.x + r.width / 2, r.y + r.height / 2];
    });
    await H.sleep(300);
    await page.mouse.click(box[0], box[1]);
  }

  async function promptPick(locatorOrId, typed, patterns) {
    const e = typeof locatorOrId === "string" ? byId(locatorOrId) : locatorOrId;
    if (!(await e.count())) return "absent";
    await clickCentre(e);
    await H.sleep(500);
    await page.keyboard.press("Control+A").catch(() => {});
    await page.keyboard.press("Backspace").catch(() => {});
    await page.keyboard.type(typed, { delay: 60 });
    await page.keyboard.press("Enter");
    await H.sleep(2500);
    for (let depth = 0; depth < 3; depth++) {
      const os = await page.evaluate(() => {
        const c = document.querySelector("[data-automation-id=activeListContainer]") || document;
        return [...c.querySelectorAll("[data-automation-id=promptOption], [role=option]")].filter((x) => x.offsetParent).map((x) => x.textContent.trim());
      });
      if (!os.length) break;
      const pick = firstMatch(os, patterns);
      if (!pick) {
        H.log("prompt options", JSON.stringify(os.slice(0, 8)));
        break;
      }
      const box = await page.evaluate((txt) => {
        const c = document.querySelector("[data-automation-id=activeListContainer]") || document;
        const o = [...c.querySelectorAll("[data-automation-id=promptOption], [role=option]")].find((x) => x.offsetParent && x.textContent.trim() === txt);
        if (!o) return null;
        o.scrollIntoView({ block: "center" });
        const b = o.getBoundingClientRect();
        return [b.x + b.width / 2, b.y + b.height / 2];
      }, pick);
      if (!box) break;
      await page.mouse.click(box[0], box[1]);
      await H.sleep(1500);
      const still = await page.evaluate(() => !!document.querySelector("[data-automation-id=activeListContainer] [data-automation-id=promptOption]"));
      if (!still) return pick;
    }
    await page.keyboard.press("Escape").catch(() => {});
    return "MISS";
  }

  async function myInformation() {
    const fillIf = async (id, v) => {
      const e = byId(id);
      if (v && (await e.count()) && !(await e.inputValue())) await e.fill(v);
    };
    await fillIf("name--legalName--firstName", me.firstName);
    await fillIf("name--legalName--lastName", me.lastName);
    await fillIf("address--addressLine1", me.address);
    await fillIf("address--city", me.city);
    await fillIf("address--postalCode", me.postalCode);
    await fillIf("phoneNumber--phoneNumber", me.phone);
    await dropdownById("address--countryRegion", ["^" + me.region + "$", me.region]);
    const em = page.locator("input[id$=--email], input[id$=--emailAddress], input[data-automation-id=email]").first();
    if ((await em.count()) && !(await em.inputValue())) await em.fill(me.email).catch(() => {});
    await dropdownById("phoneNumber--phoneType", ["^Mobile$", "Personal Mobile", "^Cell", "Mobile", "Personal Primary"]);
    await safely("phone code", async () => {
      const cc = await selectedNear("phoneNumber--countryPhoneCode", true);
      if ((await byId("phoneNumber--countryPhoneCode").count()) && !new RegExp(me.phoneCountry, "i").test(cc)) {
        const del = page.locator("[data-automation-id=selectedItem] [data-automation-id=DELETE_charm]").first();
        if (cc && (await del.count())) {
          await del.click();
          await H.sleep(500);
        }
        H.log("phone code", await promptPick("phoneNumber--countryPhoneCode", me.phoneCountry, [me.phoneCountry]));
      }
    });
    await safely("source", async () => {
      if ((await byId("source--source").count()) && !(await selectedNear("source--source"))) {
        H.log("source", await promptPick("source--source", ctx.source.typed, ctx.source.patterns));
      }
    });
    const prevNo = await page.evaluate(() => {
      const out = [];
      for (const r of document.querySelectorAll("input[type=radio]")) {
        if (!r.offsetParent) continue;
        const lab = (r.labels && r.labels[0] ? r.labels[0].innerText : r.value).trim();
        if (lab !== "No") continue;
        let n = r;
        let q = "";
        for (let k = 0; k < 8 && n && !q; k++) {
          n = n.parentElement;
          const t = (n && n.innerText) || "";
          if (/previous|prior|worked|employed|employee|former/i.test(t) && t.length < 1200) q = t;
        }
        if (q) out.push(r.id);
      }
      return out;
    });
    for (const id of prevNo) await byId(id).check({ force: true }).catch(() => {});
  }

  async function myExperience() {
    const docs = [await H.file("resume"), await H.file("cover"), await H.file("transcript")].filter(Boolean);
    const prefix = ctx.filePrefix;
    for (let k = 0; k < 8; k++) {
      const del = await page.evaluate(([pre, keep]) => {
        const items = [...document.querySelectorAll("[data-automation-id=file-upload-item], [data-automation-id=fileUploadItem]")].filter((x) => x.offsetParent);
        const bad = items.find((x) => x.innerText.includes(pre + "_") && !/transcript/i.test(x.innerText) && !keep.some((n) => x.innerText.includes(n)));
        if (!bad) return null;
        const b = bad.querySelector("[data-automation-id=delete-file], button[aria-label*=Delete], button[aria-label*=Remove]");
        if (!b) return "NOBTN";
        b.click();
        return bad.innerText.split("\n")[0];
      }, [prefix, Object.values(ctx.fileNames).filter(Boolean)]);
      if (!del || del === "NOBTN") break;
      H.log("removed an old upload", del);
      await H.sleep(1500);
    }
    const fi = page.locator("input[type=file]");
    const shown = await page.evaluate(() => document.body.innerText);
    const hasTranscript = /transcript/i.test(shown);
    const missing = docs.filter((d) => {
      const name = d.split(String.fromCharCode(92)).pop().split("/").pop();
      if (/transcript/i.test(name) && hasTranscript) return false;
      return !shown.includes(name);
    });
    if (missing.length && (await fi.count())) {
      await fi.first().setInputFiles(missing).catch(async () => fi.first().setInputFiles(missing[0]));
      await H.sleep(9000);
      page = await H.refresh();
      H.log("uploaded", missing.length, "documents");
    }
    const blocks = await page.evaluate(() => [...document.querySelectorAll('input[id$="--jobTitle"]')].filter((e) => e.offsetParent && !e.value).map((e) => e.id.replace("--jobTitle", "")));
    let ji = 0;
    for (const b of blocks) {
      const j = ctx.experience[ji++ % Math.max(1, ctx.experience.length)];
      if (!j) break;
      await byId(b + "--jobTitle").fill(j.title);
      await byId(b + "--companyName").fill(j.company);
      const cur = byId(b + "--currentlyWorkHere");
      if (j.current && (await cur.count())) await cur.check({ force: true });
      const m = byId(b + "--startDate-dateSectionMonth-input");
      if (await m.count()) {
        await clickCentre(m);
        await page.keyboard.type(String(j.start.month) + String(j.start.year), { delay: 80 });
      }
      H.log("work", j.company);
    }
    const ed = ctx.education;
    const edus = await page.evaluate(() => [...document.querySelectorAll('input[id$="--school"], input[id$="--schoolName"]')].filter((e) => e.offsetParent && !e.value).map((e) => e.id.replace(/--school(Name)?$/, "")));
    for (const b of edus) {
      const sch = page.locator('[id^="' + b + '--school"]').first();
      const isPrompt = await sch.evaluate((e) => e.getAttribute("placeholder") === "Search" || !!e.closest("[data-automation-id=multiselectInputContainer]"));
      if (isPrompt) {
        let got = await promptPick(sch, ed.schoolSearch, [ed.schoolSearch, ed.school, "^Other"]);
        if (got === "MISS") got = await promptPick(sch, "Other", ["^Other"]);
        H.log("school", got);
      }
      else await sch.fill(ed.school);
      const dg = byId(b + "--degree");
      if ((await dg.count()) && /Select One/.test(await dg.innerText())) {
        await dg.click();
        await H.sleep(1200);
        const pick = firstMatch(await visibleOptions(page), ["^" + ed.degreeLevel, ed.degreeLevel, "Undergrad"]);
        if (pick) await clickOptionText(page, pick);
        else await page.keyboard.press("Escape");
        H.log("degree", pick || "MISS");
      }
      const fos = byId(b + "--fieldOfStudy");
      if (await fos.count()) {
        const pr = await fos.evaluate((e) => e.getAttribute("placeholder") === "Search" || !!e.closest("[data-automation-id=multiselectInputContainer]"));
        if (pr) H.log("field", await promptPick(fos, ed.field, [ed.field, "Computer"]));
        else await fos.fill(ed.field);
      }
      const gpa = byId(b + "--gradeAverage");
      if (ed.gpa && (await gpa.count())) await gpa.fill(ed.gpa);
    }
    const years = await page.evaluate(() => [...document.querySelectorAll('input[id$="--firstYearAttended-dateSectionYear-input"], input[id$="--lastYearAttended-dateSectionYear-input"]')].filter((e) => e.offsetParent && !e.value).map((e) => e.id));
    for (const id of years) {
      await safely("year " + id, async () => {
        await clickCentre(byId(id));
        await page.keyboard.type(String(/firstYear/.test(id) ? ed.startYear : ed.endYear), { delay: 80 });
        await H.sleep(300);
      });
    }
    await answerDropdowns([["^Degree", ["^" + ed.degreeLevel, ed.degreeLevel, "^Degree$"]], ["^Language[*]?$", ["^English"]], ["^Overall[*]?$|^Speaking|^Writing|^Reading|^Listening|^Oral", ["^Fluent$", "Native", "^5"]]]);
  }

  async function answerDropdowns(sets) {
    for (const [lre, patterns] of sets) {
      const bs = await page.evaluate(() => [...document.querySelectorAll("button[aria-haspopup=listbox]")].filter((b) => b.offsetParent).map((b, i) => {
        b.setAttribute("data-r", "r" + i);
        const fs = b.closest("fieldset");
        let l = fs && fs.querySelector("legend") ? fs.querySelector("legend").innerText : "";
        if (!l) {
          let n = b;
          for (let k = 0; k < 8 && n && !l; k++) {
            n = n.parentElement;
            const x = n && n.querySelector("label,legend");
            if (x && x.innerText.trim()) l = x.innerText;
          }
        }
        return ["r" + i, l.trim(), b.innerText.trim()];
      }));
      for (const hit of bs.filter(([, l, v]) => new RegExp(lre, "i").test(l) && /Select One/.test(v))) {
        await clickCentre(page.locator("[data-r=" + hit[0] + "]"));
        await H.sleep(1200);
        const pick = firstMatch(await visibleOptions(page), patterns);
        if (pick) await clickOptionText(page, pick);
        else await page.keyboard.press("Escape");
        await H.sleep(700);
      }
    }
  }

  async function questions() {
    const items = await page.evaluate(() => {
      const lab = (e) => {
        const fs = e.closest("fieldset");
        if (fs && fs.querySelector("legend")) return fs.querySelector("legend").innerText;
        const l = e.id && document.querySelector('label[for="' + e.id + '"]');
        if (l) return l.innerText;
        let n = e;
        for (let k = 0; k < 6 && n; k++) {
          n = n.parentElement;
          const x = n && n.querySelector("label,legend");
          if (x && x.innerText.trim()) return x.innerText;
        }
        return "";
      };
      return [...document.querySelectorAll("button[aria-haspopup=listbox], textarea, input[type=text]:not([data-automation-id^=dateSection]), input[type=checkbox], input[type=radio]")].filter((e) => e.offsetParent).map((e, i) => {
        e.setAttribute("data-q", "q" + i);
        return { k: "q" + i, tag: e.tagName, type: e.type, label: lab(e).replace(/\s+/g, " ").trim(), opt: e.labels && e.labels[0] ? e.labels[0].innerText.trim() : "", val: e.tagName === "BUTTON" ? e.innerText.trim() : e.type === "checkbox" || e.type === "radio" ? e.checked : e.value };
      });
    });
    const radioGroups = new Map();
    for (const it of items) {
      const el = page.locator("[data-q=" + it.k + "]");
      if (it.tag === "BUTTON") {
        const rule = ruleFor(R.choices, it.label);
        if (!rule) {
          if (it.label) H.log("noRule", it.label.slice(0, 90));
          continue;
        }
        if (it.val && it.val !== "Select One" && pickOption([it.val], rule.a, ctx.avoid)) continue;
        await page.keyboard.press("Escape").catch(() => {});
        await H.sleep(300);
        await clickCentre(el);
        await H.sleep(1500);
        const pick = pickOption(await visibleOptions(page), rule.a, ctx.avoid);
        if (pick) await clickOptionText(page, pick);
        else await page.keyboard.press("Escape");
        await H.sleep(700);
        H.log(pick ? "answer" : "miss", it.label.slice(0, 70), "=>", pick || "");
      } else if (it.tag === "TEXTAREA" || it.type === "text") {
        if (it.val) continue;
        const tr = ruleFor(R.texts, it.label);
        if (tr) {
          await fillText(el, tr.text);
          H.log("text", it.label.slice(0, 60));
        } else if (it.label) H.log("noRule", it.label.slice(0, 90));
      } else if (it.type === "radio") {
        if (!radioGroups.has(it.label)) radioGroups.set(it.label, []);
        radioGroups.get(it.label).push(it);
      } else if (it.type === "checkbox") {
        const inGroup = await el.evaluate((e) => !!e.closest("[data-automation-id$=-CheckboxGroup]"));
        if (!inGroup && !it.val && wantsCheck(R.checks, it.label + " :: " + it.opt)) H.log("check", it.opt.slice(0, 60), (await tick(el)) ? "ok" : "FAILED");
      }
    }
    for (const [label, opts] of radioGroups) {
      if (opts.some((o) => o.val)) continue;
      const rule = ruleFor(R.choices, label);
      if (!rule) {
        H.log("noRule", label.slice(0, 90));
        continue;
      }
      const pick = pickOption(opts.map((o) => o.opt), rule.a, ctx.avoid);
      const o = opts.find((x) => x.opt === pick);
      if (o) await page.locator("[data-q=" + o.k + "]").check({ force: true }).catch(() => {});
    }
    const groups = await page.evaluate(() => [...document.querySelectorAll("[data-automation-id$=-CheckboxGroup]")].map((g, gi) => {
      const ff = g.closest("[data-automation-id^=formField]");
      const lg = ff && ff.querySelector("legend");
      const q = (lg ? lg.innerText : "").replace(/[*]/g, "").trim();
      return [...g.querySelectorAll("input[type=checkbox]")].map((c, i) => {
        c.setAttribute("data-cbg", "g" + gi + "_" + i);
        return ["g" + gi + "_" + i, q, c.labels && c.labels[0] ? c.labels[0].innerText.trim() : "", c.checked];
      });
    }).flat());
    const termGrid = /term length|placement are you seeking|term lengths/i;
    for (const [k, q, o, on] of groups) {
      if (on) continue;
      const want = termGrid.test(q) ? ctx.termMonths.some((m) => new RegExp("^(" + m + "|" + ["", "", "", "", "Four", "", "", "", "Eight", "", "", "", "Twelve", "", "", "", "Sixteen"][m] + ")( months?)?", "i").test(o)) : wantsCheck(R.checks, q + " :: " + o);
      if (want) {
        H.log("check", q.slice(0, 50), "::", o, (await tick(page.locator("[data-cbg=" + k + "]"))) ? "ok" : "FAILED");
      }
    }
    const dates = await page.evaluate(() => [...document.querySelectorAll("[data-automation-id=dateSectionMonth-input]")].filter((e) => e.offsetParent).map((e, i) => {
      e.setAttribute("data-dq", "d" + i);
      const fs = e.closest("fieldset");
      let l = fs && fs.querySelector("legend") ? fs.querySelector("legend").innerText : "";
      if (!l) {
        let n = e;
        for (let k = 0; k < 8 && n && !l; k++) {
          n = n.parentElement;
          const x = n && n.querySelector("label");
          if (x && x.innerText.trim()) l = x.innerText;
        }
      }
      return { k: "d" + i, label: l.replace(/\s+/g, " ").trim(), hasDay: !!(fs || document).querySelector("[data-automation-id=dateSectionDay-input]") };
    }));
    for (const d of dates) {
      const r = ruleFor(R.dates, d.label);
      const val = r && ctx.dates[r.use];
      if (!val) continue;
      const m = page.locator("[data-dq=" + d.k + "]");
      await clickCentre(m).catch(() => {});
      await H.sleep(300);
      await page.keyboard.type(val[0], { delay: 80 });
      if (d.hasDay) await page.keyboard.type(val[1], { delay: 80 });
      await page.keyboard.type(val[2], { delay: 80 });
      await H.sleep(400);
    }
  }
}
