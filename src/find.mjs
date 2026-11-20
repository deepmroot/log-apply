// Find internship and co-op postings from public GitHub lists (SimplifyJobs and community lists),
// resolve redirector links to the employer's own ATS URL, and drop what is already in the tracker.

const SIMPLIFY = "https://raw.githubusercontent.com/SimplifyJobs/Summer2027-Internships/dev/.github/scripts/listings.json";
const README_LISTS = [
  "negarprh/Canadian-Tech-Internships-2027",
  "coawp-com/Canadian-Tech-Internships-2027",
  "zapplyjobs/Canada-Internships-2027",
  "whoshiringtech/Canada-Tech-Internships-2027",
  "Bobwillrule/Canadian-Internship-List",
];
const REDIRECTORS = /coawp\.com|go\.vansh\.nyc|zapply\.jobs|whoshiringtech\.com|simplify\.jobs\/p\//i;
const ATS = /myworkday(jobs|site)\.com|greenhouse\.io\/[a-z0-9]+\/jobs\/\d+|gh_jid=\d+|jobs\.lever\.co\/[^"'<\s]+|jobs\.ashbyhq\.com\/[^"'<\s]+|\.bamboohr\.com\/careers\/\d+|smartrecruiters\.com\/[^"'<\s]+|apply\.workable\.com\/[^"'<\s]+/i;
const TITLE = /intern|co-?op|student|stage|stagiaire/i;

async function get(url, asJson) {
  const r = await fetch(url, { headers: { "User-Agent": "log-apply" }, redirect: "follow", signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return asJson ? r.json() : r.text();
}

export function keyOf(url) {
  const u = String(url).split("?")[0].replace(/[/]+$/, "").toLowerCase();
  let m = u.match(/myworkday.*_([a-z0-9-]+)$/);
  if (m) return m[1].replace(/-\d+$/, "");
  m = String(url).match(/(?:jobs\/|gh_jid=)(\d{6,})/);
  if (m) return m[1];
  m = u.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f-]{20,})/);
  if (m) return m[1];
  return u.replace(/[/](apply|application)$/, "");
}

function rowsFromReadme(md, source) {
  const out = [];
  let lastCompany = "";
  for (const line of md.split("\n")) {
    if (!line.startsWith("|") || !/https?:/.test(line)) continue;
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    const urls = (line.match(/https?:\/\/[^\s)"'>\]]+/g) || []).filter((u) => !/shields\.io|imgur|\.png|\.svg|simplify\.jobs\/c\//.test(u));
    if (!urls.length) continue;
    const text = cells.map((c) => c.replace(/<[^>]+>/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/\*\*/g, "").trim());
    const title = text.slice(1).find((c) => TITLE.test(c)) || text[1] || "";
    let company = (text[0] || "").replace(/&amp;/g, "&");
    if (/^↳|^↳/.test(company) || !company) company = lastCompany;
    else lastCompany = company;
    out.push({ company, title: title.replace(/&amp;/g, "&"), location: text[2] || "", url: urls[0], source });
  }
  return out;
}

async function resolveLink(url) {
  if (!REDIRECTORS.test(url)) return url;
  try {
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, redirect: "follow", signal: AbortSignal.timeout(25000) });
    if (!REDIRECTORS.test(r.url)) return r.url;
    const html = await r.text();
    const m = html.match(new RegExp("https?://[a-z0-9.-]*(" + ATS.source + ")[^\"'<\\s&]*", "i"));
    return m ? m[0] : null;
  } catch (e) {
    return null;
  }
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) {
      const k = i++;
      out[k] = await fn(items[k]);
    }
  }));
  return out;
}

// opts: { location: RegExp source, include: RegExp source for titles, exclude: RegExp source, known: [urls], lists: [repo] }
export async function findJobs(opts = {}) {
  const loc = new RegExp(opts.location || "Canada|, ?(ON|BC|AB|QC|MB|SK|NS)\\b|Toronto|Vancouver|Montr|Ottawa|Calgary|Waterloo|Edmonton", "i");
  const include = new RegExp(opts.include || "software|developer|data|machine learning|\\bml\\b|\\bai\\b|engineer|it\\b|information|cloud|devops|security|analy|full.?stack|backend|front.?end|web|product|qa|test|platform|automation", "i");
  const exclude = new RegExp(opts.exclude || "phd|master|mba|mechanical|electrical|civil|hardware|firmware|embedded|asic|fpga|rf\\b|nurs|accounting|tax|marketing|legal|sales|summer 2026|fall 2026|winter 2026", "i");
  const rows = [];
  try {
    const sj = await get(SIMPLIFY, true);
    for (const x of sj) if (x.active && (x.locations || []).some((l) => loc.test(l))) rows.push({ company: x.company_name, title: x.title, location: (x.locations || []).join("; "), url: x.url, source: "SimplifyJobs" });
  } catch (e) {}
  for (const repo of opts.lists || README_LISTS) {
    try {
      rows.push(...rowsFromReadme(await get(`https://raw.githubusercontent.com/${repo}/main/README.md`), repo));
    } catch (e) {}
  }
  const known = new Set((opts.known || []).map(keyOf));
  const seen = new Set();
  const candidates = rows.filter((r) => TITLE.test(r.title) && include.test(r.title) && !exclude.test(r.title));
  const resolved = await pool(candidates, 16, async (r) => ({ ...r, url: await resolveLink(r.url) }));
  const out = [];
  for (const r of resolved) {
    if (!r.url || REDIRECTORS.test(r.url)) continue;
    const k = keyOf(r.url);
    const dup = (r.company.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8) + "|" + r.title.toLowerCase().replace(/[^a-z0-9]/g, ""));
    if (known.has(k) || seen.has(k) || seen.has(dup)) continue;
    seen.add(k);
    seen.add(dup);
    out.push(r);
  }
  return out;
}
