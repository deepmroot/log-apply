import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { asideAvailable, runAside } from "./drivers/aside.mjs";
import { runCdp } from "./drivers/cdp.mjs";
import { greenhouse } from "./fillers/greenhouse.mjs";
import { workday } from "./fillers/workday.mjs";
import { datesFor } from "./profile.mjs";

export const STATE_DIR = resolve(process.env.LOG_APPLY_HOME || join(homedir(), ".log-apply"));
const ACCOUNTS = join(STATE_DIR, "accounts.json");

export function siteOf(url) {
  const host = new URL(url).hostname;
  if (/myworkdayjobs\.com$|myworkdaysite\.com$/i.test(host)) return { site: "workday", host, filler: workday };
  if (/greenhouse\.io$/i.test(host) || /[?&]gh_jid=/.test(url)) return { site: "greenhouse", host, filler: greenhouse };
  return { site: null, host, filler: null };
}

function readAccounts() {
  if (!existsSync(ACCOUNTS)) return {};
  return JSON.parse(readFileSync(ACCOUNTS, "utf8"));
}

export function accountFor(host, email) {
  mkdirSync(STATE_DIR, { recursive: true });
  const all = readAccounts();
  if (all[host]) return { email: all[host].email, password: all[host].password, isNew: false };
  const password = "La" + randomBytes(12).toString("base64").replace(/[^A-Za-z0-9]/g, "").slice(0, 14) + "!7";
  all[host] = { email, password, createdAt: new Date().toISOString() };
  writeFileSync(ACCOUNTS, JSON.stringify(all, null, 2));
  try {
    chmodSync(ACCOUNTS, 0o600);
  } catch (e) {}
  return { email, password, isNew: true };
}

export function filesFor(profile, job) {
  const out = resolve(profile.dir, profile.documents.outDir || "out");
  const base = `${profile.documents.filePrefix}_${job.slug}`;
  const resume = join(out, `${base}_Resume.pdf`);
  const cover = join(out, `${base}_Cover_Letter.pdf`);
  const transcript = profile.documents.transcript ? resolve(profile.dir, profile.documents.transcript) : null;
  return {
    resume: existsSync(resume) ? resume : null,
    cover: existsSync(cover) ? cover : null,
    transcript: transcript && existsSync(transcript) ? transcript : null,
  };
}

export function contextFor(profile, job, url, opts) {
  const { site, host } = siteOf(url);
  const c = profile.contact;
  const e = profile.education;
  const files = filesFor(profile, job);
  const ctx = {
    url,
    site,
    host,
    submit: Boolean(opts.submit),
    google: opts.google ?? opts.driver === "aside",
    company: job.displayCompany || job.company,
    me: { firstName: c.firstName, lastName: c.lastName, email: c.email, phone: String(c.phone), phoneCountry: c.phoneCountry || c.country, address: c.address, city: c.city, region: c.region, postalCode: c.postalCode, country: c.country },
    education: { school: e.school, schoolSearch: e.schoolSearch, degreeLevel: e.degreeLevel, field: e.field, gpa: e.gpa, startMonth: e.start?.month, startYear: e.start?.year, endMonth: e.end?.month, endYear: e.end?.year },
    experience: (profile.experience || []).slice(0, 3).map((x) => ({ title: x.title, company: x.company, current: Boolean(x.current), start: x.start || { month: "01", year: "2025" } })),
    rules: profile.rules,
    dates: datesFor(profile),
    source: { typed: profile.work.howDidYouHearTyped || "University", patterns: [profile.work.howDidYouHear || "Job Posting", "Job Posting|Universit|College|Campus|School|Career|Job Board|Other"] },
    filePrefix: profile.documents.filePrefix,
    termMonths: profile.work.termMonths || [4, 8, 12],
    avoid: (profile.work.citizenship || []).some((x) => new RegExp("^" + c.country + "$", "i").test(x)) ? [] : ["^(?!.*(non-|not an? |isn.t|without)).*(citizen|permanent resident)"],
    fileNames: Object.fromEntries(Object.entries(files).map(([k, p]) => [k, p ? basename(p) : null])),
  };
  if (site === "workday") {
    ctx.account = accountFor(host, c.email);
    ctx.applyUrl = /[/]apply/.test(url) ? url : url.replace(/[/]+$/, "") + "/apply/applyManually";
  }
  return { ctx, files };
}

export async function apply(profile, job, url, opts = {}) {
  const { site, filler } = siteOf(url);
  if (!filler) return { status: "unsupportedSite", detail: `log apply has no filler for ${new URL(url).hostname} yet (Workday and Greenhouse so far)` };
  const driver = opts.driver || process.env.LOG_APPLY_DRIVER || "chrome";
  const { ctx, files } = contextFor(profile, job, url, { ...opts, driver });
  if (!files.resume) return { status: "documentsMissing", detail: `no resume for ${job.slug}: run log-apply docs first` };
  if (driver === "aside" && !asideAvailable()) return { status: "driverMissing", detail: "the Aside CLI isn't installed (or set LOG_APPLY_ASIDE)" };
  const run = driver === "aside" ? runAside : runCdp;
  const result = await run(filler, ctx, files, { onLog: opts.onLog, keepOpen: opts.keepOpen });
  return { site, driver, ...result };
}
