import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { ROOT } from "./profile.mjs";

export function trackerPath(profile) {
  return resolve(profile.dir, "applications.json");
}

export function readTracker(profile) {
  const p = trackerPath(profile);
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : [];
}

function writeTracker(profile, rows) {
  writeFileSync(trackerPath(profile), JSON.stringify(rows, null, 2) + "\n");
}

export function record(profile, job, patch) {
  const rows = readTracker(profile);
  const i = rows.findIndex((r) => r.slug === job.slug);
  const base = i >= 0 ? rows[i] : { slug: job.slug, company: job.company, role: job.role, location: job.location || "", url: job.url || "", status: "prepared", addedAt: new Date().toISOString().slice(0, 10) };
  const next = { ...base, ...patch };
  if (i >= 0) rows[i] = next;
  else rows.push(next);
  writeTracker(profile, rows);
  return next;
}

export function buildLedger(profile, outDir) {
  const rows = readTracker(profile);
  const out = resolve(outDir || join(profile.dir, "ledger"));
  mkdirSync(join(out, "documents"), { recursive: true });
  const docsDir = resolve(profile.dir, profile.documents.outDir || "out");
  const published = rows.map((r) => {
    const copy = (kind) => {
      const name = `${profile.documents.filePrefix}_${r.slug}_${kind}.pdf`;
      const src = join(docsDir, name);
      if (!existsSync(src)) return null;
      copyFileSync(src, join(out, "documents", name));
      return `documents/${name}`;
    };
    return { ...r, resume: copy("Resume"), cover: copy("Cover_Letter") };
  });
  writeFileSync(join(out, "applications.json"), JSON.stringify(published, null, 2));
  const page = readFileSync(join(ROOT, "ledger", "index.html"), "utf8").replace("%%NAME%%", `${profile.contact.firstName} ${profile.contact.lastName}`);
  writeFileSync(join(out, "index.html"), page);
  return { dir: out, count: published.length, files: published.filter((r) => r.resume).length, page: basename(join(out, "index.html")) };
}
