import { fillText, pickOption, ruleFor, wantsCheck } from "./kit.mjs";

// One filler for single-page application forms: Ashby, Lever and BambooHR.
// Everything (files, answers, submit) happens in one step: Lever and BambooHR read the
// attached file again at submit time, and the Aside driver runs each step in a fresh sandbox.
export async function forms(page, ctx, H, state) {
  const R = ctx.rules;
  const me = ctx.me;
  const host = new URL(ctx.url).hostname;
  const kind = /ashbyhq/.test(host) ? "ashby" : /lever[.]co/.test(host) ? "lever" : "bamboohr";
  const need = [];
  const fullName = me.firstName + " " + me.lastName;
  const yesNoOf = (rule) => {
    const a = (rule && rule.a && rule.a[0]) || "";
    const m = /^\^?(Yes|No)\b/i.exec(a.replace(/^[(][?]![^)]*[)][.][*]/, ""));
    return m ? m[1][0].toUpperCase() + m[1].slice(1).toLowerCase() : null;
  };
  const textFor = (lab) => {
    const t = ruleFor(R.texts, lab);
    if (t) return t.text;
    return yesNoOf(ruleFor(R.choices, lab));
  };
  const choiceFor = (lab, options) => {
    const r = ruleFor(R.choices, lab);
    return r ? pickOption(options, r.a, ctx.avoid) : null;
  };
  const mdy = (a) => (Array.isArray(a) && a[2] ? a.join("/") : null);
  const iso = (a) => (Array.isArray(a) && a[2] ? a[2] + "-" + a[0] + "-" + a[1] : null);
  const clean = (s) => String(s || "").split("\n")[0].replace(/[*✱]/g, "").replace(/\s+/g, " ").trim();

  // ---- open the form
  if (kind === "lever" && !/[/]apply([?#]|$)/.test(page.url())) page = await H.goto(ctx.url.replace(/[?#].*$/, "").replace(/[/]+$/, "") + "/apply");
  if (kind === "ashby" && !/[/]application([?#]|$)/.test(page.url())) page = await H.goto(ctx.url.replace(/[?#].*$/, "").replace(/[/]+$/, "") + "/application");
  if (kind === "bamboohr") {
    const b = page.getByRole("button", { name: /Apply for This Job/i });
    if (await b.count()) {
      await b.first().click();
      await H.sleep(3500);
    }
  }
  const body = await page.evaluate(() => document.body.innerText);
  if (/no longer (accepting|available|open)|couldn.t find anything here|job not found|position has been filled|page you are looking for doesn.t exist/i.test(body)) return { done: true, result: { status: "closed", detail: "the posting is closed" } };

  const resume = await H.file("resume");
  const cover = await H.file("cover");

  // ---- standard fields
  if (kind === "ashby") {
    if (!(await page.locator("#_systemfield_name").count())) return { done: true, result: { status: "noForm", detail: "no Ashby application form at " + page.url() } };
    await fillText(page.locator("#_systemfield_name"), fullName);
    await fillText(page.locator("#_systemfield_email"), me.email);
    if (resume) await page.locator("#_systemfield_resume").setInputFiles(resume).catch((e) => H.log("resume upload failed", String(e.message).slice(0, 80)));
    await H.sleep(5000);
  }
  if (kind === "lever") {
    if (!(await page.locator("input[name=name]").count())) return { done: true, result: { status: "noForm", detail: "no Lever application form at " + page.url() } };
    if (resume) await page.locator("input[name=resume]").setInputFiles(resume).catch((e) => H.log("resume upload failed", String(e.message).slice(0, 80)));
    await H.sleep(6000);
    await fillText(page.locator("input[name=name]"), fullName);
    await fillText(page.locator("input[name=email]"), me.email);
    await fillText(page.locator("input[name=phone]"), me.phone);
    const org = page.locator("input[name=org]");
    if ((await org.count()) && ctx.experience[0]) await fillText(org, ctx.experience[0].company);
    for (const [n, re] of [["urls[LinkedIn]", "LinkedIn"], ["urls[GitHub]", "GitHub"], ["urls[Portfolio]", "Portfolio"]]) {
      const l = page.locator('input[name="' + n + '"]');
      const t = ruleFor(R.texts, re);
      if ((await l.count()) && t) await fillText(l, t.text);
    }
    const loc = page.locator("#location-input");
    if (await loc.count()) {
      await loc.fill("");
      await loc.pressSequentially(me.city, { delay: 60 });
      await H.sleep(2500);
      const idx = await page.evaluate((city) => {
        const os = [...document.querySelectorAll(".dropdown-results .dropdown-location")].map((x) => x.innerText.trim());
        return Math.max(0, os.findIndex((o) => o.toLowerCase().startsWith(city.toLowerCase())));
      }, me.city);
      for (let k = 0; k <= idx; k++) await page.keyboard.press("ArrowDown");
      await H.sleep(300);
      await page.keyboard.press("Enter");
      await H.sleep(800);
      H.log("location", await page.evaluate(() => (document.querySelector("#selected-location") || {}).value || ""));
    }
  }
  if (kind === "bamboohr") {
    const tb = async (name, v) => {
      const e = page.getByRole("textbox", { name });
      if ((await e.count()) && v) await e.first().fill(String(v));
    };
    if (!(await page.getByRole("textbox", { name: /First Name/ }).count())) return { done: true, result: { status: "noForm", detail: "no BambooHR application form at " + page.url() } };
    await tb(/^First Name/, me.firstName);
    await tb(/^Last Name/, me.lastName);
    await tb(/^Email/, me.email);
    await tb(/^Phone/, me.phone);
    await tb(/^Address/, me.address);
    await tb(/^City/, me.city);
    await tb(/^(Postal Code|ZIP)/, me.postalCode);
    await tb(/^Date Available/, mdy(ctx.dates && ctx.dates.start));
    for (const [re, v] of [[/^Province|^State/, me.region], [/^Country/, me.country]]) {
      const btn = page.getByRole("button", { name: re }).first();
      if (!(await btn.count())) continue;
      await btn.click().catch(() => {});
      await H.sleep(900);
      const box = await page.evaluate((val) => {
        const o = [...document.querySelectorAll("[role=option], [role=menuitem], li")].find((x) => x.offsetParent && (x.textContent || "").trim() === val);
        if (!o) return null;
        o.scrollIntoView({ block: "center" });
        const r = o.getBoundingClientRect();
        return [r.x + r.width / 2, r.y + r.height / 2];
      }, v);
      if (box) await page.mouse.click(box[0], box[1]);
      else await page.keyboard.press("Escape").catch(() => {});
      await H.sleep(600);
    }
    const kinds = await page.evaluate(() => [...document.querySelectorAll("input[type=file]")].map((e) => {
      let n = e;
      for (let k = 0; k < 3 && n; k++) n = n.parentElement;
      const t = (n && n.innerText) || "";
      return /^Cover/i.test(t.trim()) ? "cover" : /transcript/i.test(t) ? "transcript" : "resume";
    }));
    for (let i = 0; i < kinds.length; i++) {
      const f = kinds[i] === "cover" ? cover : kinds[i] === "transcript" ? await H.file("transcript") : resume;
      if (f) await page.locator("input[type=file]").nth(i).setInputFiles(f).catch(() => {});
      await H.sleep(2500);
    }
  }

  // ---- custom questions
  const qs = await page.evaluate((kind) => {
    const labOf = (e) => {
      let lab = "";
      if (e.id && !["radio", "checkbox"].includes(e.type)) {
        const l = document.querySelector('label[for="' + CSS.escape(e.id) + '"]');
        if (l) lab = l.innerText;
      }
      if (!lab) {
        const c = e.closest(kind === "lever" ? "li.application-question, .application-question" : "fieldset, [class*=fieldEntry], [class*=field-entry]");
        const x = c && c.querySelector(kind === "lever" ? ".application-label, .text" : "label, legend");
        if (x) lab = x.innerText;
      }
      if (!lab) {
        let n = e;
        for (let k = 0; k < 6 && n && !lab; k++) {
          n = n.parentElement;
          const x = n && n.querySelector("label, legend");
          if (x && !x.contains(e)) lab = x.innerText;
        }
      }
      return (lab || "").replace(/[ ]+/g, " ").trim();
    };
    const skip = /recaptcha|h-captcha|_systemfield_(name|email|resume)|^(name|email|phone|org|resume|location|selectedLocation)$|^urls\[/;
    return [...document.querySelectorAll("input, textarea, select")].map((e, i) => {
      e.setAttribute("data-la", String(i));
      if (["hidden", "submit", "button", "file", "search"].includes(e.type) || skip.test(e.name || "") || skip.test(e.id || "")) return null;
      if (!e.offsetParent && !["radio", "checkbox"].includes(e.type)) return null;
      if (e.getAttribute("role") === "combobox" || e.placeholder === "Pick date...") return null;
      const lab = labOf(e);
      if (/^(First Name|Last Name|Email|Phone|Address|City|Postal Code|ZIP|Date Available|LinkedIn URL|Website, Blog or Portfolio)/i.test(lab) && kind === "bamboohr") return null;
      const opt = ["radio", "checkbox"].includes(e.type) ? ((e.labels && e.labels[0] && e.labels[0].innerText) || (e.closest("label") && e.closest("label").innerText) || e.getAttribute("aria-label") || e.value || "").trim() : "";
      const req = /[*✱]/.test(lab) || e.required || e.getAttribute("aria-required") === "true";
      return { i, tag: e.tagName, type: e.type, name: e.name || "", lab, opt, req, val: e.value || "", opts: e.tagName === "SELECT" ? [...e.options].map((o) => o.text.trim()).filter(Boolean) : [] };
    }).filter(Boolean);
  }, kind);
  const at = (q) => page.locator('[data-la="' + q.i + '"]');
  const groups = {};
  for (const q of qs) if (q.type === "radio" || q.type === "checkbox") (groups[q.name + "|" + clean(q.lab)] = groups[q.name + "|" + clean(q.lab)] || []).push(q);
  const done = new Set();
  for (const q of qs) {
    const lab = clean(q.lab);
    try {
      if (q.type === "radio" || q.type === "checkbox") {
        const key = q.name + "|" + lab;
        if (done.has(key)) continue;
        done.add(key);
        const g = groups[key];
        const opts = g.map((x) => x.opt);
        const yesNo = opts.length <= 2 && opts.every((o) => /^(Yes|No)$/i.test(o));
        if (q.type === "radio" || yesNo) {
          const pick = wantsCheck(R.checks, lab) && opts.some((o) => /^Yes$/i.test(o)) ? opts.find((o) => /^Yes$/i.test(o)) : choiceFor(lab, opts);
          if (!pick) {
            if (q.req || q.type === "radio") need.push({ kind: "choice", label: lab, options: opts });
            continue;
          }
          await at(g.find((x) => x.opt === pick)).check({ force: true }).catch(async () => { await at(g.find((x) => x.opt === pick)).click({ force: true }).catch(() => {}); });
          H.log("answer", lab.slice(0, 70), "=>", pick);
          continue;
        }
        if (kind === "ashby" && !q.opt) {
          // Ashby yes/no fields render as two buttons next to a hidden checkbox
          const v = wantsCheck(R.checks, lab) ? "Yes" : yesNoOf(ruleFor(R.choices, lab));
          if (!v) {
            need.push({ kind: "choice", label: lab, options: ["Yes", "No"] });
            continue;
          }
          const ok = await page.evaluate(([sel, v]) => {
            const e = document.querySelector(sel);
            let n = e;
            for (let k = 0; k < 5 && n; k++) {
              n = n.parentElement;
              const b = n && [...n.querySelectorAll("button")].find((x) => x.innerText.trim() === v);
              if (b) {
                b.click();
                return true;
              }
            }
            if (v === "Yes" && !e.checked) {
              e.click();
              return true;
            }
            return false;
          }, ['[data-la="' + q.i + '"]', v]);
          if (ok) H.log("answer", lab.slice(0, 70), "=>", v);
          else need.push({ kind: "choice", label: lab, options: ["Yes", "No"] });
          continue;
        }
        for (const x of g) {
          if (wantsCheck(R.checks, lab + " :: " + x.opt) || wantsCheck(R.checks, x.opt)) {
            await at(x).check({ force: true }).catch(() => {});
            H.log("check", lab.slice(0, 50), "::", x.opt.slice(0, 40));
          }
        }
        continue;
      }
      if (q.tag === "SELECT") {
        const pick = choiceFor(lab, q.opts);
        if (!pick) {
          if (q.req) need.push({ kind: "choice", label: lab, options: q.opts.slice(0, 15) });
          continue;
        }
        await at(q).selectOption({ label: pick });
        H.log("answer", lab.slice(0, 70), "=>", pick);
        continue;
      }
      if (q.val) continue;
      if (q.type === "tel" || /phone/i.test(lab)) {
        await fillText(at(q), me.phone);
        continue;
      }
      if (/preferred (first )?name/i.test(lab)) {
        await fillText(at(q), me.firstName);
        continue;
      }
      if (/^(full |legal )?name$|legal full name/i.test(lab)) {
        await fillText(at(q), fullName);
        continue;
      }
      if (q.type === "date") {
        const d = iso(/graduat|completion|degree/i.test(lab) ? ctx.dates && ctx.dates.graduation : ctx.dates && ctx.dates.start);
        if (d) await fillText(at(q), d);
        else if (q.req) need.push({ kind: "text", label: lab });
        continue;
      }
      const t = textFor(lab);
      if (t) {
        await fillText(at(q), t);
        H.log("text", lab.slice(0, 60), "=>", t.slice(0, 40));
      } else if (q.req) need.push({ kind: "text", label: q.lab.slice(0, 300) });
    } catch (e) {
      H.log("error", lab.slice(0, 40), String(e.message).slice(0, 80));
    }
  }

  // ---- Ashby comboboxes (location, school, dropdown questions) and date pickers
  if (kind === "ashby") {
    const cbs = await page.evaluate(() => [...document.querySelectorAll("input[role=combobox]")].map((e, i) => {
      e.setAttribute("data-cb", String(i));
      let n = e;
      let lab = "";
      for (let k = 0; k < 6 && n && !lab; k++) {
        n = n.parentElement;
        const l = n && n.querySelector("label");
        if (l) lab = l.innerText;
      }
      return [i, lab, e.value];
    }));
    for (const [i, rawLab, val] of cbs) {
      if (val) continue;
      const lab = clean(rawLab);
      const L = page.locator('[data-cb="' + i + '"]');
      const isLoc = /^Location|current location|where are you (located|based)|^city/i.test(lab);
      const isSchool = /^School$|school|university|college/i.test(lab);
      const r = isLoc || isSchool ? null : ruleFor(R.choices, lab);
      const typed = isLoc ? me.city : isSchool ? ctx.education.schoolSearch : "a";
      try {
        await L.click();
        await H.sleep(500);
        await L.pressSequentially(typed, { delay: 60 });
        await H.sleep(2500);
        const opts = await page.evaluate(() => [...document.querySelectorAll("[role=option]")].filter((o) => o.offsetParent).map((o) => o.innerText.trim()));
        const pick = isLoc ? opts[0] : isSchool ? opts.find((o) => o.includes(ctx.education.schoolSearch)) || opts.find((o) => /^Other/i.test(o)) : r ? pickOption(opts, r.a, ctx.avoid) : null;
        if (!pick) {
          await page.keyboard.press("Escape").catch(() => {});
          need.push({ kind: "choice", label: lab, options: opts.slice(0, 15) });
          continue;
        }
        await page.evaluate((t) => {
          const o = [...document.querySelectorAll("[role=option]")].find((x) => x.offsetParent && x.innerText.trim() === t);
          if (o) o.click();
        }, pick);
        await H.sleep(700);
        H.log("answer", lab.slice(0, 60), "=>", pick);
      } catch (e) {
        H.log("error", lab.slice(0, 40), String(e.message).slice(0, 80));
      }
    }
    const dateLabels = await page.evaluate(() => [...document.querySelectorAll('input[placeholder="Pick date..."]')].map((e, i) => {
      e.setAttribute("data-dp", String(i));
      let n = e;
      let t = "";
      for (let k = 0; k < 6 && n && !t; k++) {
        n = n.parentElement;
        const l = n && n.querySelector("label");
        if (l) t = l.innerText;
      }
      return [i, t, e.value];
    }));
    for (const [di, rawLab, dval] of dateLabels) {
      if (dval) continue;
      const L = page.locator('[data-dp="' + di + '"]');
      const lab = clean(rawLab);
      const v = mdy(/graduat|completion|degree/i.test(lab) ? ctx.dates && ctx.dates.graduation : /start|available/i.test(lab) ? ctx.dates && ctx.dates.start : null);
      if (!v) {
        need.push({ kind: "date", label: lab });
        continue;
      }
      await L.click();
      await L.pressSequentially(v, { delay: 60 });
      await page.keyboard.press("Enter");
      await page.keyboard.press("Escape").catch(() => {});
      H.log("date", lab.slice(0, 60), "=>", v);
    }
  }

  if (need.length) return { done: true, result: { status: "needsAnswers", need } };
  if (!ctx.submit) return { done: true, result: { status: "filled", detail: "filled and left unsubmitted (dry run)" } };

  // ---- submit (same step, so the attached files are still readable)
  const clicked = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button, input[type=submit]")].find((x) => /^(Submit application|Submit Application|Submit)$/i.test((x.innerText || x.value || "").trim()));
    if (!b) return false;
    b.scrollIntoView({ block: "center" });
    b.click();
    return true;
  });
  if (!clicked) return { done: true, result: { status: "notConfirmed", detail: "no Submit button found" } };
  let after = "";
  for (let i = 0; i < 6; i++) {
    await H.sleep(4000);
    page = await H.refresh();
    after = await page.evaluate(() => document.body.innerText).catch(() => "");
    if (/thank you|application (has been )?(submitted|received)|successfully submitted|we.ve received|application was sent|[/]thanks/i.test(after + " " + page.url())) return { done: true, result: { status: "submitted", detail: page.url() } };
  }
  const challenge = await page.evaluate(() => [...document.querySelectorAll("iframe")].some((f) => /hcaptcha|recaptcha|turnstile|challenges[.]cloudflare/.test(f.src) && f.getBoundingClientRect().height > 100) || /not a robot|verify you are human/i.test(document.body.innerText));
  if (challenge) return { done: true, result: { status: "captcha", detail: "the site asked for a CAPTCHA: complete it in the open tab and press Submit there" } };
  const errors = await page.evaluate(() => [...document.querySelectorAll("[class*=error], [role=alert]")].map((e) => e.innerText.trim().slice(0, 100)).filter(Boolean).slice(0, 6));
  return { done: true, result: { status: "notConfirmed", detail: "no confirmation after Submit", errors } };
}
