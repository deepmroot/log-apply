import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";
import * as kit from "../fillers/kit.mjs";

const b64 = (s) => Buffer.from(s, "utf8").toString("base64");

export function asideCli() {
  if (process.env.LOG_APPLY_ASIDE) return process.env.LOG_APPLY_ASIDE;
  const local = join(homedir(), "AppData", "Local", "Aside", "CLI", "current", "aside.exe");
  return existsSync(local) ? local : "aside";
}

export function asideAvailable() {
  const r = spawnSync(asideCli(), ["--help"], { encoding: "utf8" });
  return r.status === 0;
}

function kitSource() {
  return Object.values(kit).filter((f) => typeof f === "function").map((f) => f.toString().replace(/^export\s+/, "")).join("\n");
}

function prelude(ctx, state, files) {
  const fileTable = Object.fromEntries(Object.entries(files).filter(([, p]) => p && existsSync(p)).map(([k, p]) => [k, { name: basename(p), data: readFileSync(p).toString("base64") }]));
  return `
const AF = Object.getPrototypeOf(async function(){}).constructor;
const CTX = JSON.parse(Buffer.from('${b64(JSON.stringify(ctx))}','base64').toString());
let STATE = JSON.parse(Buffer.from('${b64(JSON.stringify(state))}','base64').toString());
const FILES = JSON.parse(Buffer.from('${b64(JSON.stringify(fileTable))}','base64').toString());
let P;
if (STATE.tab) { P = await attachBrowserTab(STATE.tab); }
else { P = await openTab(CTX.url); await sleep(6000); const t = (await listBrowserTabs()).find((x) => x.active); STATE.tab = t && t.targetId; P = await attachBrowserTab(STATE.tab); }
const H = {
  sleep,
  log: (...a) => console.log('LOG ' + a.map((x) => typeof x === 'string' ? x : JSON.stringify(x)).join(' ')),
  refresh: async () => { P = await attachBrowserTab(STATE.tab); return P; },
  goto: async (u) => { await P.goto(u).catch(() => {}); await sleep(6000); P = await attachBrowserTab(STATE.tab); return P; },
  file: async (k) => { const f = FILES[k]; if (!f) return null; await fs.writeFile(f.name, Buffer.from(f.data, 'base64')); return f.name; },
  mail: async (query, pattern, minutes) => {
    const re = new RegExp(pattern, 'i');
    const r = await gmail.search(0, query + ' newer_than:' + Math.max(1, Math.ceil((minutes || 30) / 60)) + 'h');
    for (const x of (r.results || []).slice(0, 6)) { const t = await gmail.getThread(0, x.threadId); const b = (t.messages[t.messages.length - 1].body || ''); const m = b.match(re); if (m) return m[1] || m[0]; }
    return null;
  },
};
`;
}

export function runAside(filler, ctx, files, options = {}) {
  const dir = mkdtempSync(join(tmpdir(), "logApplyAside"));
  const body = `${kitSource()}\n${filler.toString()}\nreturn await ${filler.name}(page, ctx, H, state);`;
  let state = { step: 0 };
  const logs = [];
  for (let i = 0; i < (options.maxSteps || 40); i++) {
    const script = `${prelude(ctx, state, files)}
const __fn = new AF('page', 'ctx', 'H', 'state', Buffer.from('${b64(body)}', 'base64').toString());
const __out = await __fn(P, CTX, H, STATE);
console.log('RESULT ' + JSON.stringify({ ...__out, state: { ...(__out.state || STATE), tab: STATE.tab } }));
`;
    const path = join(dir, `step${i}.js`);
    writeFileSync(path, script);
    const r = spawnSync(asideCli(), ["repl", "--file", path], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    const lines = `${r.stdout || ""}\n${r.stderr || ""}`.split(/\r?\n/);
    for (const l of lines.filter((l) => l.startsWith("LOG "))) {
      logs.push(l.slice(4));
      if (options.onLog) options.onLog(l.slice(4));
    }
    const resultLine = lines.reverse().find((l) => l.startsWith("RESULT "));
    if (!resultLine) return { status: "driverError", detail: `aside repl gave no result (exit ${r.status}): ${lines.filter(Boolean).slice(0, 4).join(" | ").slice(0, 400)}`, logs };
    const out = JSON.parse(resultLine.slice(7));
    state = out.state;
    if (out.done) return { ...(out.result || {}), logs };
  }
  return { status: "stopped", detail: "the filler ran out of steps", logs };
}
