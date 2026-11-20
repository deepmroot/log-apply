// log-apply watch: catch new internship/co-op postings soon after they are posted.
// Sources, each optional:
//   - lists:    SimplifyJobs and community GitHub lists (findJobs)
//   - boards:   public job-board APIs of companies you name (Greenhouse, Lever, Ashby), polled directly
//   - linkedin: your LinkedIn job-alert emails, read from your own mailbox (Aside's Gmail or IMAP).
//               LinkedIn itself is never opened; each alert is matched to the company's own board.
// New postings are deduped against everything already seen, written to a queue file, and announced.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ImapFlow } from "imapflow";
import { asideAvailable, asideCli } from "./drivers/aside.mjs";
import { findJobs, keyOf } from "./find.mjs";
import { imapConfigured } from "./mail/imap.mjs";

const UA = { "User-Agent": "log-apply" };

async function getJson(url) {
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

export function norm(s) {
  return String(s || "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim();
}

// Board slugs to try for a company name: "Clio" -> clio; "Global Relay Communications" -> globalrelay, global-relay, globalrelaycommunications ...
export function slugGuesses(company) {
  const words = norm(company).replace(/\b(inc|ltd|llc|corp|corporation|co|limited|technologies|technology|group|canada|the)\b/g, " ").split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const out = [words.join(""), words.join("-"), words[0], words.slice(0, 2).join(""), norm(company).replace(/\s+/g, "")];
  return [...new Set(out.filter((s) => s.length >= 2))];
}

// Titles match when most words of the alert title appear in the board title.
export function titleMatch(a, b) {
  const wa = norm(a).split(" ").filter((w) => w.length > 2 && !/^(the|and|for|with)$/.test(w));
  const wb = new Set(norm(b).split(" "));
  if (!wa.length) return false;
  return wa.filter((w) => wb.has(w)).length / wa.length >= 0.6;
}

async function boardJobs(ats, slug) {
  if (ats === "greenhouse") {
    const d = await getJson(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`);
    return (d.jobs || []).map((j) => ({ title: j.title, location: j.location?.name || "", url: j.absolute_url, updated: j.updated_at }));
  }
  if (ats === "lever") {
    const d = await getJson(`https://api.lever.co/v0/postings/${slug}?mode=json`);
    return (d || []).map((j) => ({ title: j.text, location: j.categories?.location || "", url: j.hostedUrl, updated: j.createdAt ? new Date(j.createdAt).toISOString() : "" }));
  }
  if (ats === "ashby") {
    const d = await getJson(`https://api.ashbyhq.com/posting-api/job-board/${slug}`);
    return (d.jobs || []).map((j) => ({ title: j.title, location: j.location || "", url: j.jobUrl, updated: j.publishedAt || "" }));
  }
  return [];
}

// Find the posting on the company's own board. Returns { url, ats, slug } or null.
export async function resolveOnBoards(company, title, hint = []) {
  const tries = [];
  for (const b of hint) if (norm(b.company) === norm(company)) tries.push([b.ats, b.slug]);
  for (const s of slugGuesses(company)) for (const ats of ["greenhouse", "lever", "ashby"]) tries.push([ats, s]);
  for (const [ats, slug] of tries) {
    let jobs;
    try {
      jobs = await boardJobs(ats, slug);
    } catch {
      continue;
    }
    const hit = jobs.find((j) => titleMatch(title, j.title));
    if (hit) return { url: hit.url, ats, slug, location: hit.location };
  }
  return null;
}

// LinkedIn job-alert emails -> [{ title, company, location }]
export function parseAlert(body) {
  const out = [];
  const text = String(body || "");
  // Gmail-to-markdown form (Aside): "[[Software Developer, Co-op][7]\n\nClio · Calgary, AB"
  for (const m of text.matchAll(/\[\[([^\]\n]{3,140})\]\[\d+\]\s*\n\s*\n?([^\n·]{2,80}) · ([^\n\]]{2,80})/g)) out.push({ title: m[1].trim(), company: m[2].trim(), location: m[3].trim() });
  if (out.length) return out;
  // Plain-text form (IMAP): a title line followed by "Company · Location"
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (let i = 1; i < lines.length; i++) {
    const m = lines[i].match(/^([^·]{2,80}) · ([^·]{2,80})$/);
    if (m && lines[i - 1].length < 140 && !/·/.test(lines[i - 1])) out.push({ title: lines[i - 1], company: m[1].trim(), location: m[2].trim() });
  }
  return out;
}

function alertsViaAside(hours) {
  const code = `const r = await gmail.search(0, 'newer_than:${Math.max(1, hours)}h from:jobalerts-noreply@linkedin.com'); const out = []; for (const x of r.results.slice(0, 40)) { const th = await gmail.getThread(0, x.threadId); const m = th.messages[th.messages.length - 1]; out.push({ id: x.threadId, subject: String(x.subject || ''), body: String(m.body || '') }); } console.log('JSONOUT' + JSON.stringify(out));`;
  const r = spawnSync(asideCli(), ["repl", code], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const line = (r.stdout || "").split("\n").find((l) => l.startsWith("JSONOUT"));
  if (!line) throw new Error(`asideMailFailed: ${(r.stderr || r.stdout || "").slice(0, 200)}`);
  return JSON.parse(line.slice(7));
}

async function alertsViaImap(hours) {
  const client = new ImapFlow({ host: process.env.LOG_APPLY_IMAP_HOST || "imap.gmail.com", port: 993, secure: true, auth: { user: process.env.LOG_APPLY_IMAP_USER, pass: process.env.LOG_APPLY_IMAP_PASS }, logger: false });
  await client.connect();
  try {
    await client.mailboxOpen("INBOX");
    const since = new Date(Date.now() - hours * 3600_000);
    const uids = (await client.search({ since, from: "jobalerts-noreply@linkedin.com" })) || [];
    const out = [];
    for (const uid of uids.slice(-40)) {
      const msg = await client.fetchOne(uid, { source: true, envelope: true }, { uid: true });
      const raw = msg.source.toString("utf8").replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
      out.push({ id: String(uid), subject: msg.envelope?.subject || "", body: raw.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|td|tr|a|span)>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&middot;/g, "·") });
    }
    return out;
  } finally {
    await client.logout().catch(() => {});
  }
}

export async function linkedinAlerts(hours = 24) {
  const mails = imapConfigured() ? await alertsViaImap(hours) : asideAvailable() ? alertsViaAside(hours) : null;
  if (!mails) return { jobs: [], note: "no mailbox: set LOG_APPLY_IMAP_USER/PASS or install Aside" };
  const jobs = [];
  for (const m of mails) for (const j of parseAlert(m.body)) jobs.push({ ...j, source: "linkedin-alert", mail: m.id });
  return { jobs, note: `${mails.length} alert emails` };
}

// Pull every posting from the boards you listed in profile watch.boards: [{ company, ats, slug }]
export async function pollBoards(boards = []) {
  const out = [];
  for (const b of boards) {
    try {
      for (const j of await boardJobs(b.ats, b.slug)) out.push({ company: b.company || b.slug, title: j.title, location: j.location, url: j.url, source: `${b.ats}:${b.slug}` });
    } catch {}
  }
  return out;
}

function readState(path) {
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : { seen: {}, firstRun: true };
}

// URLs already handled anywhere: tracker rows plus any file you point at (e.g. your ledger page).
export function knownKeys(trackerUrls, knownFiles = []) {
  const keys = new Set(trackerUrls.map(keyOf));
  const names = [];
  for (const f of knownFiles) {
    if (!f || !existsSync(f)) continue;
    const t = readFileSync(f, "utf8");
    for (const u of t.match(/https?:\/\/[^\s"'<>)]+/g) || []) keys.add(keyOf(u));
    for (const m of t.matchAll(/company: "([^"]+)", role: "([^"]+)"/g)) names.push([norm(m[1]).split(" ")[0], m[2]]);
  }
  return { keys, names };
}

async function notify(lines) {
  const topic = process.env.LOG_APPLY_NTFY_TOPIC;
  if (!topic || !lines.length) return false;
  try {
    await fetch(`https://ntfy.sh/${topic}`, { method: "POST", body: lines.slice(0, 15).join("\n"), headers: { Title: `log apply: ${lines.length} new posting${lines.length > 1 ? "s" : ""}` } });
    return true;
  } catch {
    return false;
  }
}

// One watch cycle. opts: { stateDir, queuePath, hours, sources: ['lists','boards','linkedin'], boards, find, trackerUrls, knownFiles, log }
export async function watchOnce(opts) {
  const log = opts.log || (() => {});
  const statePath = join(opts.stateDir, "watch-state.json");
  mkdirSync(opts.stateDir, { recursive: true });
  const state = readState(statePath);
  const f = opts.find || {};
  const loc = new RegExp(f.location || "Canada|Remote|, ?(ON|BC|AB|QC|MB|SK|NS|NB|NL|PE)\\b|Toronto|Vancouver|Montr|Ottawa|Calgary|Waterloo|Edmonton|Victoria|Kitchener|Mississauga|Markham|Burnaby|Halifax|Winnipeg|Saskatoon|Regina", "i");
  const kind = /intern|co-?op|student|stage|stagiaire/i;
  const include = new RegExp(f.include || "software|developer|data|machine learning|\\bml\\b|\\bai\\b|engineer|\\bit\\b|information|cloud|devops|security|analy|full.?stack|backend|front.?end|web|product|qa|test|platform|automation|systems", "i");
  const exclude = new RegExp(f.exclude || "phd|master|mba|mechanical|electrical|civil|hardware|firmware|embedded|asic|fpga|nurs|accounting|tax|marketing|legal|sales|digital design|design verification|\bsoc\b|silicon|layout|thermal|process engineering|robotics|mining|geology|medicine|physician|summer 2026|fall 2026|winter 2026", "i");
  const { keys, names } = knownKeys(opts.trackerUrls || [], opts.knownFiles || []);
  const sources = opts.sources || ["lists", "boards", "linkedin"];
  const found = [];
  if (sources.includes("boards")) found.push(...(await pollBoards(opts.boards)));
  if (sources.includes("lists")) {
    try {
      found.push(...(await findJobs({ ...f, known: [] })));
    } catch (e) {
      log(`lists failed: ${e.message}`);
    }
  }
  if (sources.includes("linkedin")) {
    try {
      const { jobs, note } = await linkedinAlerts(opts.hours || 24);
      log(`linkedin: ${note}, ${jobs.length} jobs in them`);
      for (const j of jobs) {
        const k = "li|" + norm(j.company) + "|" + norm(j.title);
        if (state.seen[k]) continue;
        state.seen[k] = new Date().toISOString();
        const hit = await resolveOnBoards(j.company, j.title, opts.boards || []);
        found.push({ ...j, url: hit ? hit.url : null, resolvedVia: hit ? `${hit.ats}:${hit.slug}` : null, location: j.location || hit?.location || "" });
      }
    } catch (e) {
      log(`linkedin failed: ${e.message}`);
    }
  }
  const fresh = [];
  for (const j0 of found) {
    const j = { ...j0, company: String(j0.company || '').replace(/&amp;/g, '&'), title: String(j0.title || '').replace(/&amp;/g, '&') };
    if (!kind.test(j.title) || !include.test(j.title) || exclude.test(j.title) || (j.location && !loc.test(j.location))) continue;
    const k = j.url ? keyOf(j.url) : "li|" + norm(j.company) + "|" + norm(j.title);
    const nk = norm(j.company).split(" ")[0] + "|" + norm(j.title);
    if (keys.has(k) || state.seen["u|" + k] || names.some(([c, role]) => c === norm(j.company).split(" ")[0] && (titleMatch(j.title, role) || titleMatch(role, j.title)))) continue;
    state.seen["u|" + k] = new Date().toISOString();
    if (fresh.some((x) => (x.url && x.url === j.url) || norm(x.company).split(" ")[0] + "|" + norm(x.title) === nk)) continue;
    fresh.push({ ...j, foundAt: new Date().toISOString(), needsYou: !j.url ? "not found on a public board: look it up on the company's careers site" : null });
  }
  // First run only records what exists, so you are not flooded with old postings (unless --backfill).
  const wasFirst = Boolean(state.firstRun);
  const announce = wasFirst && !opts.backfill ? [] : fresh;
  state.firstRun = false;
  writeFileSync(statePath, JSON.stringify(state, null, 2));
  if (announce.length && opts.queuePath) {
    const q = existsSync(opts.queuePath) ? JSON.parse(readFileSync(opts.queuePath, "utf8")) : [];
    q.push(...announce);
    writeFileSync(opts.queuePath, JSON.stringify(q, null, 2) + "\n");
  }
  const pushed = await notify(announce.map((j) => `${j.company}: ${j.title}${j.location ? ` (${j.location})` : ""}${j.url ? "" : " [find on careers site]"}`));
  return { checked: found.length, fresh: announce, baseline: wasFirst && !opts.backfill ? fresh.length : 0, pushed };
}
