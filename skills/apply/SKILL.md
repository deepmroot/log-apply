---
name: log-apply
description: Apply to jobs, internships and co-ops for the user with log apply. Use when the user asks to apply to a posting, find and apply to jobs, keep applying, or update their application ledger.
---

# log apply

The CLI is `node ${CLAUDE_PLUGIN_ROOT}/bin/log-apply.mjs` (below: `log-apply`). Work from the user's job-search folder, the one with `profile.yaml`. Every application is one `jobs/<Slug>.yaml`.

## The loop, per posting

1. **Find.** Use the URL the user gave, or search for open postings that match their profile:
   - **treg** (https://treg.to, if the user has it set up: `treg call <endpoint>`):
     - `treg.companies.jobs`, free: one company's open jobs, straight from its own board (Greenhouse, Ashby, Lever, SmartRecruiters and more).
     - `hirebase.jobs.search`: search across companies. Check the size first with `hirebase.jobs.search.count`, which is free.
     - `hirebase.jobs.expired`, free: drop postings that were taken down before writing anything.

     Paid treg calls spend the user's balance, so ask before the first one in a session.
   - company career boards: Greenhouse boards and Workday career sites
   - curated internship lists such as SimplifyJobs on GitHub
   - job-alert emails the user forwards

   Never automate LinkedIn or any site's search in the user's logged-in browser. Skip a posting already in `applications.json` under the same company and role.
2. **Screen.** Read the whole posting. Skip it, and say why, when:
   - it is senior or full-time, but the user wants internships
   - its work authorization, citizenship or clearance rules out the user's profile
   - it is closed, or the location doesn't fit the user's terms
3. **Tailor.** Write `jobs/<Slug>.yaml`; the slug is letters and digits only, e.g. `AcmeBackendCoopW27`. Fields:
   - `company`, `role`, `location` and `url`
   - `summary`: 2 or 3 sentences for the top of the resume, naming this role and this company
   - `paragraphs`: 4 or 5 cover-letter paragraphs that tie the posting's actual requirements to the user's real experience
   - `expOrder`: experience keys, most relevant first
   - `projectKeys`, optional: projects to feature

   Use only facts from `profile.yaml`. Never invent a metric, a technology, a title or a date. Bold a few key numbers with `**…**`.
4. **Documents.** Run `log-apply docs jobs/<Slug>.yaml`.
   - It must print `"ok": true`: each PDF is one page and has clickable links.
   - If the resume is two pages, shorten the summary or drop a project.
   - If LaTeX fails, fix the text (a stray character), never the template.
5. **Fill.** Run `log-apply apply jobs/<Slug>.yaml`, adding `--submit` only if the folder has `AUTOSUBMIT` or the user approved this one. Add `--driver aside` when the user works in Aside. Act on the `status` it returns:

   | status | What to do |
   |---|---|
   | `submitted` | Done; it is recorded as applied. |
   | `filled` | Dry run done. Tell the user it waits on their review, or rerun with `--submit` if allowed. |
   | `needsAnswers` | Lists questions with no rule. Answer each only from the profile. If the profile doesn't say, ask the user. Then add a rule under `answers:` in `profile.yaml` (`q` is a regex for the question; `a` lists option regexes, or `text` gives the text) and rerun. |
   | `stuck` | The same page had errors twice. Read `errors`, fix the profile or rules, and rerun once. If it still sticks, leave it for the user with the page named. |
   | `closed` or `alreadyApplied` | Recorded; move on. |
   | `signInFailed` | Workday refused the saved password. Have the user reset it on that site. Never type into a password-reset flow unasked. |
   | `codeMissing` | A security code never arrived by email. Check the mail settings with `log-apply doctor`. |
   | `unsupportedSite` | Lever, Ashby, SuccessFactors and others aren't built yet. Prepare the documents and leave it for the user. |

6. **Track.**
   - `log-apply track jobs/<Slug>.yaml --status applied|interview|rejected` when the user hears back.
   - `log-apply ledger --out <dir>` rebuilds the public ledger site. Deploy it if the user set one up.

## Pace and care

- One application at a time, with a few minutes between submissions. Stop at a CAPTCHA, an identity check or anything you don't recognise, and tell the user.
- A run that keeps going uses `/loop`: each round takes the next postings, does the loop above, and reports what was submitted, skipped and why.
- Never print passwords, app passwords, cookies or personal documents into the chat.
- The first time a fill succeeds, `log-apply apply` prints one line asking for a star on the repo. Pass that line on to the user once, as written, after you report the result. Never ask again.
