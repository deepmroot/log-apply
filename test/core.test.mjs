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
  assert.equal(siteOf("https://jobs.lever.co/acme/123").site, "lever");
});

test("the first rule that matches a question wins, and options match in order", () => {
  const rules = [{ q: "sponsor", a: ["^No"] }, { q: "authori", a: ["^Yes"] }];
  assert.deepEqual(ruleFor(rules, "Will you require visa sponsorship?"), rules[0]);
  assert.equal(ruleFor(rules, "Favourite colour"), null);
  assert.equal(firstMatch(["Select One", "No", "Yes"], ["^Yes", "^No"]), "Yes");
  assert.equal(firstMatch(["A", "B"], ["[unclosed", "^B"]), "B");
  assert.ok(wantsCheck(["terms and conditions"], "Consent :: I accept the terms and conditions"));
});

test("a non-citizen is never answered as a citizen or permanent resident", async () => {
  const { pickOption } = await import("../src/fillers/kit.mjs");
  const avoid = ["^(?!.*(non-|not an? |isn.t|without)).*(citizen|permanent resident)"];
  const opts = ["Select One", "Yes: Canadian Citizen/Lawful Permanent Resident.", "No: Non-Canadian Citizen/Non-Canadian Permanent Resident."];
  assert.equal(pickOption(opts, ["^Yes"], avoid), "No: Non-Canadian Citizen/Non-Canadian Permanent Resident.");
  assert.equal(pickOption(["Yes", "No"], ["^Yes"], avoid), "Yes");
  assert.equal(pickOption(opts, ["^Yes"], []), "Yes: Canadian Citizen/Lawful Permanent Resident.");
});

test("Ashby, Lever and BambooHR postings route to the forms filler", () => {
  assert.equal(siteOf("https://jobs.ashbyhq.com/acme/0b1c2d3e-0000-4000-8000-000000000000").site, "ashby");
  assert.equal(siteOf("https://jobs.lever.co/acme/0b1c2d3e-0000-4000-8000-000000000000/apply").site, "lever");
  assert.equal(siteOf("https://acme.bamboohr.com/careers/101").site, "bamboohr");
  assert.equal(siteOf("https://example.com/careers").site, null);
});

test("find keys postings the same way across URL shapes", async () => {
  const { keyOf } = await import("../src/find.mjs");
  assert.equal(keyOf("https://acme.wd3.myworkdayjobs.com/en-US/X/job/Toronto/Dev-Intern_R12345-1"), "r12345");
  assert.equal(keyOf("https://job-boards.greenhouse.io/acme/jobs/4729021005"), "4729021005");
  assert.equal(keyOf("https://www.acme.com/careers?gh_jid=8212194"), "8212194");
  assert.equal(keyOf("https://jobs.lever.co/acme/3b6d3dfe-5e49-41c9-98a5-f732fa63fdf4/apply"), keyOf("https://jobs.lever.co/acme/3b6d3dfe-5e49-41c9-98a5-f732fa63fdf4"));
});
