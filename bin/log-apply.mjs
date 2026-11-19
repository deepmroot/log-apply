#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import YAML from "yaml";
import { apply, siteOf } from "../src/apply.mjs";
import { asideAvailable } from "../src/drivers/aside.mjs";
import { findChrome, launchBrowser, PROFILE_DIR } from "../src/drivers/cdp.mjs";
import { imapConfigured } from "../src/mail/imap.mjs";
import { loadProfile, profilePath, ROOT } from "../src/profile.mjs";
import { buildLedger, record } from "../src/tracker.mjs";

const USAGE = `log apply: your agent applies to jobs for you

  log-apply setup                      copy profile.example.yaml to ./profile.yaml to fill in
  log-apply doctor                     check the browser, Aside, LaTeX, mail and your profile
  log-apply browser                    open the log apply Chrome profile (sign in to Google once)
  log-apply docs <job.yaml>            build the one-page resume and cover letter for one job
  log-apply apply <job.yaml> [--driver chrome|aside] [--submit] [--keep-open] [--google]
                                       fill the job's form; it is left unsubmitted unless --submit
  log-apply track <job.yaml> --status applied|interview|rejected|prepared [--evidence "..."]
  log-apply ledger [--out <dir>]       build the public ledger site from applications.json

  --profile <path> picks a profile other than ./profile.yaml (or LOG_APPLY_PROFILE).`;

function flags(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      const v = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
      out[k] = v;
    } else out._.push(a);
  }
  return out;
}

function readJob(path) {
  if (!path || !existsSync(path)) throw new Error(`jobMissing: give a job file (see examples/job.yaml)${path ? `; ${path} doesn't exist` : ""}`);
  const job = YAML.parse(readFileSync(path, "utf8"));
  for (const k of ["slug", "company", "role", "url"]) if (!job[k]) throw new Error(`jobIncomplete: ${path} has no ${k}`);
  if (!/^[A-Za-z0-9]+$/.test(job.slug)) throw new Error(`jobSlugInvalid: slug "${job.slug}" must be letters and numbers only`);
  return job;
}

function python() {
  for (const p of [process.env.LOG_APPLY_PYTHON, "python", "python3", "py"].filter(Boolean)) {
    if (spawnSync(p, ["--version"], { encoding: "utf8" }).status === 0) return p;
  }
  return null;
}

async function main() {
  const f = flags(process.argv.slice(2));
  const [cmd, arg] = f._;
  if (!cmd || cmd === "help" || f.help) return console.log(USAGE);

  if (cmd === "setup") {
    const target = resolve("profile.yaml");
    if (existsSync(target)) return console.log(`profile.yaml already exists at ${target}`);
    copyFileSync(join(ROOT, "profile.example.yaml"), target);
    return console.log(`wrote ${target}: fill it in, then run log-apply doctor`);
  }

  if (cmd === "doctor") {
    const py = python();
    const latex = spawnSync("pdflatex", ["--version"], { encoding: "utf8" }).status === 0;
    const pyMods = py ? spawnSync(py, ["-c", "import yaml, pypdf"], { encoding: "utf8" }).status === 0 : false;
    let profile = "missing";
    try {
      loadProfile(f.profile);
      profile = "ok";
    } catch (e) {
      profile = e.message;
    }
    const rows = [
      ["profile", profile === "ok", profile === "ok" ? profilePath(f.profile) : profile],
      ["chrome driver", Boolean(findChrome()), findChrome() || "no Chrome, Edge or Brave found (set LOG_APPLY_CHROME)"],
      ["aside driver", asideAvailable(), asideAvailable() ? "aside CLI found" : "optional: install Aside to use --driver aside"],
      ["mail (chrome driver)", imapConfigured(), imapConfigured() ? "IMAP set" : "set LOG_APPLY_IMAP_USER and LOG_APPLY_IMAP_PASS (a Gmail app password) for Workday and Greenhouse codes"],
      ["pdflatex", latex, latex ? "found" : "install MiKTeX, MacTeX or TeX Live"],
      ["python", Boolean(py) && pyMods, py ? (pyMods ? `${py} with yaml and pypdf` : `${py}: pip install pyyaml pypdf`) : "install Python 3"],
    ];
    for (const [name, ok, note] of rows) console.log(`${ok ? "ok  " : "--  "} ${name.padEnd(22)} ${note}`);
    return;
  }

  if (cmd === "browser") {
    const r = await launchBrowser("https://accounts.google.com");
    return console.log(`${r.started ? "opened" : "already open"}: the log apply browser on port ${r.port} (profile ${PROFILE_DIR}). Sign in to Google there once; Workday's "Sign in with Google" uses it.`);
  }

  const profile = loadProfile(f.profile);

  if (cmd === "docs") {
    const job = readJob(arg);
    const py = python();
    if (!py) throw new Error("pythonMissing: install Python 3 with pyyaml and pypdf");
    const r = spawnSync(py, [join(ROOT, "docs", "render.py"), profilePath(f.profile), resolve(arg)], { encoding: "utf8" });
    if (r.stderr) process.stderr.write(r.stderr);
    const out = JSON.parse((r.stdout || "{}").trim().split("\n").pop() || "{}");
    if (out.ok) record(profile, job, { status: "prepared" });
    console.log(JSON.stringify(out, null, 2));
    process.exitCode = r.status || 0;
    return;
  }

  if (cmd === "apply") {
    const job = readJob(arg);
    const url = f.url || job.applyUrl || job.url;
    const site = siteOf(url).site;
    console.error(`${job.company}: ${site || "unknown site"} via ${f.driver || process.env.LOG_APPLY_DRIVER || "chrome"}${f.submit ? ", will submit" : ", dry run (no --submit)"}`);
    const result = await apply(profile, job, url, { driver: f.driver, submit: Boolean(f.submit), keepOpen: Boolean(f.keepOpen), ...(f.google ? { google: true } : {}), onLog: (l) => console.error(`  ${l}`) });
    if (result.status === "submitted") record(profile, job, { status: "applied", date: new Date().toISOString().slice(0, 10), evidence: `Submitted via ${site} by log apply (${result.driver}). ${result.detail || ""}`.trim() });
    else if (["closed", "alreadyApplied"].includes(result.status)) record(profile, job, { status: result.status === "closed" ? "rejected" : "applied", evidence: result.detail });
    const { logs, ...shown } = result;
    console.log(JSON.stringify(shown, null, 2));
    process.exitCode = result.status === "submitted" || (result.status === "filled" && !f.submit) ? 0 : 1;
    return;
  }

  if (cmd === "track") {
    const job = readJob(arg);
    const status = f.status;
    if (!["applied", "interview", "rejected", "prepared"].includes(status)) throw new Error("statusInvalid: --status is applied, interview, rejected or prepared");
    const row = record(profile, job, { status, ...(status === "applied" ? { date: f.date || new Date().toISOString().slice(0, 10) } : {}), ...(f.evidence ? { evidence: f.evidence } : {}) });
    return console.log(JSON.stringify(row, null, 2));
  }

  if (cmd === "ledger") {
    const r = buildLedger(profile, f.out);
    return console.log(`built the ledger in ${r.dir}: ${r.count} applications, ${r.files} with documents. Deploy that folder (e.g. vercel deploy ${r.dir}).`);
  }

  console.log(USAGE);
  process.exitCode = 1;
}

main().catch((e) => {
  console.error(`log-apply: ${e.message}`);
  process.exitCode = 1;
});
