import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";
import { searchMail } from "../mail/imap.mjs";

const CANDIDATES = [
  process.env.LOG_APPLY_CHROME,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/microsoft-edge",
].filter(Boolean);

export const PORT = Number(process.env.LOG_APPLY_CDP_PORT || 9333);
export const PROFILE_DIR = resolve(process.env.LOG_APPLY_BROWSER_PROFILE || join(homedir(), ".log-apply", "browser"));

export function findChrome() {
  return CANDIDATES.find((p) => existsSync(p)) || null;
}

export async function endpointUp() {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
    return res.ok;
  } catch (e) {
    return false;
  }
}

export async function launchBrowser(url = "about:blank") {
  if (await endpointUp()) return { started: false, port: PORT };
  const chrome = findChrome();
  if (!chrome) throw new Error("browserMissing: no Chrome, Edge or Brave found; set LOG_APPLY_CHROME to its path");
  mkdirSync(PROFILE_DIR, { recursive: true });
  const child = spawn(chrome, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE_DIR}`, "--no-first-run", "--no-default-browser-check", url], { detached: true, stdio: "ignore" });
  child.unref();
  for (let i = 0; i < 40; i++) {
    if (await endpointUp()) return { started: true, port: PORT, chrome };
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`browserNotReady: ${chrome} did not open its debugging port ${PORT}`);
}

export async function runCdp(filler, ctx, files, options = {}) {
  await launchBrowser();
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
  const context = browser.contexts()[0] || (await browser.newContext());
  const page = await context.newPage();
  const logs = [];
  const H = {
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    log: (...a) => {
      const line = a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ");
      logs.push(line);
      if (options.onLog) options.onLog(line);
    },
    refresh: async () => page,
    goto: async (url) => {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
      await H.sleep(6000);
      return page;
    },
    file: async (name) => files[name] || null,
    mail: (query, pattern, minutes) => searchMail(query, pattern, minutes),
  };
  let state = { step: 0 };
  let out = { done: false };
  try {
    await page.goto(ctx.url, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
    await H.sleep(5000);
    for (let i = 0; i < (options.maxSteps || 40) && !out.done; i++) {
      out = await filler(page, ctx, H, state);
      state = out.state || state;
    }
    return { ...(out.result || { status: "stopped", detail: "the filler ran out of steps" }), logs };
  } finally {
    if (!options.keepOpen) await page.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}
