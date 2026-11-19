import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const ORDINAL = { 1: ["1st", "First"], 2: ["2nd", "Second"], 3: ["3rd", "Third"], 4: ["4th", "Fourth"], 5: ["5th", "Fifth"] };
const REQUIRED = ["contact.firstName", "contact.lastName", "contact.email", "contact.phone", "contact.city", "contact.country", "education.school", "education.degree", "education.end.year", "documents.filePrefix"];

export function profilePath(given) {
  return resolve(given || process.env.LOG_APPLY_PROFILE || join(process.cwd(), "profile.yaml"));
}

export function get(obj, path) {
  return path.split(".").reduce((v, k) => (v == null ? undefined : v[k]), obj);
}

function yesNo(value) {
  return value ? "^Yes" : "^No";
}

function monthName(m) {
  const n = Number(m);
  return Number.isInteger(n) && n >= 1 && n <= 12 ? MONTHS[n - 1] : String(m || "");
}

export function derive(raw) {
  const p = structuredClone(raw);
  p.work = p.work || {};
  p.education = p.education || {};
  p.selfId = p.selfId || {};
  p.experience = p.experience || [];
  p.projects = p.projects || [];
  const w = p.work;
  const e = p.education;
  w.sponsorAnswer = yesNo(Boolean(w.needsSponsorship));
  w.authorizedAnswer = (w.authorizedCountries || []).includes(p.contact.country) ? "^Yes" : "^No";
  w.relocateAnswer = yesNo(w.willingToRelocate !== false);
  w.frenchAnswer = /none|no/i.test(String(w.languages?.french || "none")) ? "^No" : "^Yes";
  w.englishFirstAnswer = /native|first/i.test(String(w.languages?.english || "")) ? "^Yes" : "^Yes";
  w.citizenshipText = (w.citizenship || []).join(", ");
  w.termsText = (w.terms || []).join(", ");
  const langLine = (p.skills || []).map(String).find((x) => /languages/i.test(x)) || "";
  w.languagesText = w.programmingLanguages || langLine.replace(/\textbf\{[^}]*\}:?\s*/g, "").replace(/^[^:]*:\s*/, "").replace(/[\{}]/g, "").trim();
  if (w.startDate) w.startDate.monthName = monthName(w.startDate.month);
  e.coopAnswer = yesNo(Boolean(e.coopProgram));
  e.hasCompletedTermAnswer = yesNo(Number(e.workTermsCompleted || 0) > 0);
  const ord = ORDINAL[Number(e.yearOfStudy)] || [String(e.yearOfStudy || ""), String(e.yearOfStudy || "")];
  e.yearOrdinal = ord[0];
  e.yearWord = ord[1];
  e.degreeLevel = e.degreeLevel || "Bachelor";
  e.schoolSearch = e.schoolSearch || e.school;
  return p;
}

export function fill(template, p) {
  return String(template).replace(/\{\{([^}]+)\}\}/g, (_, path) => {
    const v = get(p, path.trim());
    return v == null ? "" : String(v);
  });
}

function fillRules(rules, p) {
  return {
    choices: (rules.choices || []).map((r) => ({ q: r.q, a: (r.a || []).map((x) => fill(x, p)).filter((x) => x && x !== "^" && x !== "^$") })),
    checks: (rules.checks || []).map((c) => fill(c, p)),
    texts: (rules.texts || []).map((t) => ({ q: t.q, text: fill(t.text, p) })).filter((t) => t.text.trim()),
    dates: rules.dates || [],
  };
}

export function loadProfile(given) {
  const path = profilePath(given);
  if (!existsSync(path)) throw new Error(`profileMissing: no profile at ${path}. Copy profile.example.yaml to profile.yaml and fill it in (log-apply setup).`);
  const raw = YAML.parse(readFileSync(path, "utf8")) || {};
  const missing = REQUIRED.filter((k) => get(raw, k) == null || get(raw, k) === "");
  if (missing.length) throw new Error(`profileIncomplete: ${path} is missing ${missing.join(", ")}`);
  const p = derive(raw);
  const defaults = YAML.parse(readFileSync(join(ROOT, "rules", "defaults.yaml"), "utf8"));
  const own = {
    choices: (raw.answers || []).filter((a) => a.a).map((a) => ({ q: a.q, a: a.a })),
    texts: (raw.answers || []).filter((a) => a.text).map((a) => ({ q: a.q, text: a.text })),
    checks: raw.checks || [],
  };
  const merged = {
    choices: [...own.choices, ...defaults.choices],
    texts: [...own.texts, ...defaults.texts],
    checks: [...own.checks, ...defaults.checks],
    dates: defaults.dates,
  };
  p.rules = fillRules(merged, p);
  p.dir = dirname(path);
  return p;
}

export function datesFor(p) {
  const e = p.education.end || {};
  const s = p.work.startDate || {};
  const pad = (v) => String(v || "").padStart(2, "0");
  const endMonth = MONTHS.findIndex((m) => m.toLowerCase() === String(e.month || "").toLowerCase()) + 1;
  return {
    graduation: [pad(endMonth || 4), "30", String(e.year || "")],
    start: [pad(s.month || 1), pad(s.day || 1), String(s.year || "")],
  };
}
