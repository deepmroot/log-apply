import assert from "node:assert/strict";
import { mkdtempSync, copyFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { siteOf } from "../src/apply.mjs";
import { firstMatch, ruleFor, wantsCheck } from "../src/fillers/kit.mjs";
import { datesFor, derive, fill, loadProfile, ROOT } from "../src/profile.mjs";

function exampleProfile(extra = "") {
  const dir = mkdtempSync(join(tmpdir(), "logApplyTest"));
  const path = join(dir, "profile.yaml");
  copyFileSync(join(ROOT, "profile.example.yaml"), path);

  return path;
}

test("the example profile loads and its own answers come before the defaults", () => {
  const p = loadProfile(exampleProfile());
  assert.equal(p.rules.choices[0].q, "previously (worked|been employed)|former employee");
  assert.ok(p.rules.choices.length > 40);
  assert.ok(p.rules.texts.some((t) => t.text === "https://github.com/alex"));
});

test("derived answers follow the profile", () => {
  const p = derive({ contact: { country: "Canada" }, work: { authorizedCountries: ["Canada"], needsSponsorship: false, willingToRelocate: true, languages: { french: "None" } }, education: { yearOfStudy: 3, coopProgram: true, workTermsCompleted: 1 } });
  assert.equal(p.work.sponsorAnswer, "^No");
  assert.equal(p.work.authorizedAnswer, "^Yes");
  assert.equal(p.education.yearOrdinal, "3rd");
  assert.equal(p.education.coopAnswer, "^Yes");
  assert.equal(p.work.frenchAnswer, "^No");
});

test("templates fill from the profile and empty ones drop out", () => {
  assert.equal(fill("{{education.end.month}} {{education.end.year}}", { education: { end: { month: "April", year: 2028 } } }), "April 2028");
  assert.equal(fill("{{nothing.here}}", {}), "");
});

test("dates come out as month, day, year", () => {
  const d = datesFor(derive({ contact: {}, work: { startDate: { month: "1", day: "4", year: "2027" } }, education: { end: { month: "April", year: 2028 } } }));
  assert.deepEqual(d.start, ["01", "04", "2027"]);
  assert.deepEqual(d.graduation, ["04", "30", "2028"]);
});

test("sites are told apart by their host", () => {
  assert.equal(siteOf("https://acme.wd3.myworkdayjobs.com/en-US/Careers/job/Toronto/Dev_R1").site, "workday");
  assert.equal(siteOf("https://job-boards.greenhouse.io/acme/jobs/123").site, "greenhouse");
  assert.equal(siteOf("https://www.acme.com/careers?gh_jid=123").site, "greenhouse");
  assert.equal(siteOf("https://jobs.lever.co/acme/123").site, null);
});

test("the first rule that matches a question wins, and options match in order", () => {
  const rules = [{ q: "sponsor", a: ["^No"] }, { q: "authori", a: ["^Yes"] }];
  assert.deepEqual(ruleFor(rules, "Will you require visa sponsorship?"), rules[0]);
  assert.equal(ruleFor(rules, "Favourite colour"), null);
  assert.equal(firstMatch(["Select One", "No", "Yes"], ["^Yes", "^No"]), "Yes");
  assert.equal(firstMatch(["A", "B"], ["[unclosed", "^B"]), "B");
  assert.ok(wantsCheck(["terms and conditions"], "Consent :: I accept the terms and conditions"));
});
