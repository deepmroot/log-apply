export function ruleFor(list, label) {
  for (const r of list) {
    try {
      if (new RegExp(r.q, "i").test(label)) return r;
    } catch (e) {}
  }
  return null;
}

export function firstMatch(options, patterns) {
  for (const src of patterns) {
    let re;
    try {
      re = new RegExp(src, "i");
    } catch (e) {
      continue;
    }
    const hit = options.find((o) => re.test(o));
    if (hit) return hit;
  }
  return null;
}

export function wantsCheck(checks, text) {
  return checks.some((src) => {
    try {
      return new RegExp(src, "i").test(text);
    } catch (e) {
      return false;
    }
  });
}

export async function visibleOptions(page) {
  return page.evaluate(() => [...document.querySelectorAll("[role=listbox] [role=option], [role=option]")].filter((x) => x.offsetParent && !x.closest("[data-automation-id=selectedItemList]") && !x.closest(".iti")).map((x) => x.innerText.trim()).filter(Boolean));
}

export async function clickOptionText(page, text) {
  const box = await page.evaluate((c) => {
    const o = [...document.querySelectorAll("[role=listbox] [role=option], [role=option]")].find((x) => x.offsetParent && !x.closest("[data-automation-id=selectedItemList]") && x.innerText.trim() === c);
    if (!o) return null;
    o.scrollIntoView({ block: "center" });
    const b = o.getBoundingClientRect();
    return [b.x + b.width / 2, b.y + b.height / 2];
  }, text);
  if (!box) return false;
  await page.mouse.click(box[0], box[1]);
  return true;
}

export async function fillText(locator, value) {
  try {
    await locator.fill(value);
  } catch (e) {
    await locator.fill("").catch(() => {});
    await locator.pressSequentially(value, { delay: 25 });
  }
}
