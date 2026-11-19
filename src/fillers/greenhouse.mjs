import { clickOptionText, fillText, firstMatch, pickOption, ruleFor, visibleOptions, wantsCheck } from "./kit.mjs";

export async function greenhouse(page, ctx, H, state) {
  const R = ctx.rules;
  const me = ctx.me;
  const has = async (id) => (await page.locator('[id="' + id + '"]').count()) > 0;
  const T = async (sel, v) => {
    const l = page.locator(sel);
    if ((await l.count()) && v) await fillText(l.first(), v);
  };
  const openOptions = async (id, typed, wait) => {
    await page.keyboard.press("Escape").catch(() => {});
    await H.sleep(200);
    const l = page.locator('[id="' + id + '"]');
    await l.scrollIntoViewIfNeeded().catch(() => {});
    await l.click();
    await H.sleep(500);
    if (typed) {
      await page.keyboard.type(typed, { delay: 40 });
      await H.sleep(wait || 1500);
    }
    return visibleOptions(page);
  };
  const choose = async (id, typed, patterns, wait) => {
    const os = await openOptions(id, typed, wait);
    const pick = pickOption(os, patterns, ctx.avoid);
    if (!pick) {
      await page.keyboard.press("Escape").catch(() => {});
      return { miss: true, options: os.slice(0, 12) };
    }
    await clickOptionText(page, pick);
    await H.sleep(600);
    await page.keyboard.press("Escape").catch(() => {});
    return { value: pick };
  };

  if (state.step === 0) {
    if (!(await has("first_name"))) {
      const m = ctx.url.match(/greenhouse[.]io[/]([^/]+)[/]jobs[/]([0-9]+)/) || ctx.url.match(/for=([^&]+).*token=([0-9]+)/);
      if (m) page = await H.goto("https://job-boards.greenhouse.io/embed/job_app?for=" + m[1] + "&token=" + m[2]);
    }
    if (!(await has("first_name"))) return { done: true, result: { status: "noForm", detail: "no Greenhouse application form at " + page.url() } };
    const body = await page.evaluate(() => document.body.innerText);
    if (/no longer (open|accepting)|job (is )?(closed|not found)|position has been filled/i.test(body)) return { done: true, result: { status: "closed", detail: "the posting is closed" } };
    await T("#first_name", me.firstName);
    await T("#last_name", me.lastName);
    await T("#email", me.email);
    const tel = page.locator("input[type=tel]");
    if (await tel.count()) {
      if (!(await tel.first().inputValue())) await tel.first().pressSequentially(me.phone, { delay: 20 }).catch(() => {});
    }
    if (await has("country")) H.log("country", JSON.stringify(await choose("country", me.country, ["^" + me.country])));
    if (await has("candidate-location")) {
      const l = page.locator("#candidate-location");
      await l.focus();
      await page.keyboard.type(me.city, { delay: 50 });
      await H.sleep(3500);
      const cities = await visibleOptions(page);
      const city = firstMatch(cities, ["^" + me.city + ", " + me.region, "^" + me.city + ",", "^" + me.city + "[^0-9]*$", me.city]);
      if (city) await clickOptionText(page, city);
      else {
        await page.keyboard.press("ArrowDown");
        await page.keyboard.press("Enter");
      }
      await H.sleep(800);
      H.log("city", city || "first option");
    }
    const ed = ctx.education;
    if (await has("school--0")) {
      let s = await choose("school--0", ed.schoolSearch, [ed.schoolSearch, ed.school], 4000);
      if (s.miss) s = await choose("school--0", "Other", ["^Other$"], 4000);
      H.log("school", s.value || "MISS");
    }
    if (await has("degree--0")) H.log("degree", JSON.stringify(await choose("degree--0", ed.degreeLevel, ["^" + ed.degreeLevel, ed.degreeLevel])));
    if (await has("discipline--0")) H.log("discipline", JSON.stringify(await choose("discipline--0", ed.field, ["^" + ed.field + "$", ed.field, "Computer"])));
    if (await has("start-month--0")) await choose("start-month--0", "", ["^" + ed.startMonth + "$"]);
    if (await has("start-year--0")) await T('[id="start-year--0"]', String(ed.startYear));
    if (await has("end-month--0")) await choose("end-month--0", "", ["^" + ed.endMonth + "$"]);
    if (await has("end-year--0")) await T('[id="end-year--0"]', String(ed.endYear));
    const resume = await H.file("resume");
    const cover = await H.file("cover");
    if (resume && (await has("resume"))) await page.locator("#resume").setInputFiles(resume).catch((e) => H.log("resume upload failed", String(e.message).slice(0, 80)));
    await H.sleep(2000);
    if (cover && (await has("cover_letter"))) await page.locator("#cover_letter").setInputFiles(cover).catch(() => {});
    await H.sleep(2000);
    return { state: { step: 1 }, done: false };
  }

  if (state.step === 1) {
    const qs = await page.evaluate(() => [...document.querySelectorAll("input[id^=question_], textarea[id^=question_], input[role=combobox], input[type=checkbox], input[type=file]")].filter((e) => !/^(country|candidate-location|school--|degree--|discipline--|start-|end-|iti|resume|cover_letter)/.test(e.id) && !e.closest(".iti")).map((e) => {
      let lab = "";
      const l = e.id && document.querySelector('label[for="' + e.id + '"]');
      if (l) lab = l.innerText;
      if (!lab) {
        const fs = e.closest("fieldset");
        if (fs && fs.querySelector("legend")) lab = fs.querySelector("legend").innerText;
      }
      if (!lab) {
        let n = e;
        for (let k = 0; k < 5 && n && !lab; k++) {
          n = n.parentElement;
          const x = n && n.querySelector("label,legend");
          if (x) lab = x.innerText;
        }
      }
      if (e.type === "file") {
        let n = e;
        for (let k = 0; k < 5 && n; k++) n = n.parentElement;
        lab = (n ? n.innerText : lab).slice(0, 200);
      }
      const req = /[*]/.test(lab) || e.getAttribute("aria-required") === "true" || e.required;
      return { id: e.id, tag: e.tagName, type: e.type, lab: lab.replace(/[ ]+/g, " ").trim(), req, combo: !!e.closest("[class*=select__]") || e.getAttribute("role") === "combobox", opt: e.type === "checkbox" && e.labels && e.labels[0] ? e.labels[0].innerText.trim() : "", val: e.value || "" };
    }));
    const need = [];
    const seen = new Set();
    for (const q of qs) {
      if (!q.id || seen.has(q.id)) continue;
      seen.add(q.id);
      const lab = q.lab.split("\n")[0];
      try {
        if (q.type === "file") {
          if (/transcript/i.test(q.lab)) {
            const t = await H.file("transcript");
            if (t) {
              await page.locator('[id="' + q.id + '"]').setInputFiles(t).catch(() => {});
              H.log("transcript uploaded");
            } else if (q.req) need.push({ kind: "file", label: lab });
          } else if (/cover/i.test(q.lab)) {
            const c = await H.file("cover");
            if (c) await page.locator('[id="' + q.id + '"]').setInputFiles(c).catch(() => {});
          } else if (q.req) need.push({ kind: "file", label: lab });
          continue;
        }
        if (q.type === "checkbox") {
          if (wantsCheck(R.checks, lab + " :: " + q.opt)) {
            await page.locator('[id="' + q.id + '"]').check({ force: true }).catch(() => {});
            H.log("check", lab.slice(0, 60), "::", q.opt);
          }
          continue;
        }
        if (q.combo) {
          const rule = ruleFor(R.choices, lab);
          if (!rule) {
            if (q.req) {
              const os = await openOptions(q.id, "", 800);
              await page.keyboard.press("Escape").catch(() => {});
              need.push({ kind: "choice", label: lab, options: os.slice(0, 15) });
            }
            continue;
          }
          const got = await choose(q.id, "", rule.a, 800);
          if (got.miss) need.push({ kind: "choice", label: lab, options: got.options, tried: rule.a });
          else H.log("answer", lab.slice(0, 70), "=>", got.value);
          continue;
        }
        if (q.tag === "TEXTAREA" || ["text", "url", "number", "email"].includes(q.type)) {
          if (q.val) continue;
          const tr = ruleFor(R.texts, lab);
          if (tr) {
            await T('[id="' + q.id + '"]', tr.text);
            H.log("text", lab.slice(0, 60), "=>", tr.text.slice(0, 40));
          } else if (q.req) need.push({ kind: "text", label: q.lab.slice(0, 300) });
        }
      } catch (e) {
        H.log("error", q.id, String(e.message).slice(0, 80));
      }
    }
    const tx = await page.evaluate(() => document.body.innerText);
    const resumeName = ctx.fileNames.resume;
    const filesOk = !resumeName || tx.includes(resumeName.replace(/[.]pdf$/i, ""));
    if (need.length) return { done: true, result: { status: "needsAnswers", need, filesOk } };
    if (!ctx.submit) return { done: true, result: { status: "filled", detail: "filled and left unsubmitted (dry run)", filesOk } };
    return { state: { step: 2 }, done: false };
  }

  if (state.step === 2) {
    const done = () => /confirmation|thank/i.test(page.url());
    const btn = page.getByRole("button", { name: /Submit application|Submit|Envoyer ma candidature/i }).first();
    await btn.scrollIntoViewIfNeeded().catch(() => {});
    await btn.click();
    for (let i = 0; i < 6; i++) {
      await H.sleep(4000);
      page = await H.refresh();
      if (done()) break;
    }
    if (done()) return { done: true, result: { status: "submitted", detail: page.url() } };
    const codeInputs = await page.evaluate(() => [...document.querySelectorAll("input")].filter((e) => e.offsetParent && (/security|code/i.test(e.id + " " + (e.name || "") + " " + (e.getAttribute("aria-label") || "")) || e.maxLength === 1)).map((e) => e.id || e.name));
    if (!codeInputs.length) {
      const errs = await page.evaluate(() => [...document.querySelectorAll("[class*=error], [aria-invalid=true]")].map((e) => e.textContent.trim().slice(0, 80)).filter(Boolean).slice(0, 6));
      return { done: true, result: { status: "notConfirmed", detail: "no confirmation page after Submit", errors: errs } };
    }
    return { state: { step: 3, codeInputs }, done: false };
  }

  if (state.step === 3) {
    let code = null;
    for (let k = 0; k < 6 && !code; k++) {
      await H.sleep(10000);
      code = await H.mail('"Security code for your application to ' + ctx.company + '"', "#[ ]*([A-Za-z0-9]{8})", 20).catch(() => null);
    }
    if (!code) return { done: true, result: { status: "codeMissing", detail: "Greenhouse asked for a security code and none arrived by email" } };
    page = await H.refresh();
    const ins = state.codeInputs;
    if (ins.length >= 8) for (let j = 0; j < 8; j++) await page.locator('[id="' + ins[j] + '"]').fill(code[j]);
    else await page.locator('[id="' + ins[0] + '"]').fill(code);
    await page.getByRole("button", { name: /Submit application|Submit/i }).first().click();
    for (let i = 0; i < 6; i++) {
      await H.sleep(4000);
      page = await H.refresh();
      if (/confirmation|thank/i.test(page.url())) return { done: true, result: { status: "submitted", detail: page.url() } };
    }
    return { done: true, result: { status: "notConfirmed", detail: "no confirmation page after the security code" } };
  }
  return { done: true, result: { status: "stopped", detail: "unknown step " + state.step } };
}
