# log apply

**Your agent applies to jobs for you.** For each posting it:
- writes a one-page LaTeX resume and cover letter tailored to that job
- fills the application on Workday or Greenhouse in your own browser
- keeps a public ledger of every application, with the documents it sent

Built for a real job search: as many applications as you want in a day, each with its own resume and cover letter. Part of [log](https://github.com/matthewdonsemail-lab/log) by ListeningKit.

## Install (Claude Code)

```
/plugin marketplace add deepmroot/log-apply
/plugin install log-apply@log-apply
/apply-setup
```

Then just ask: `/apply https://job-boards.greenhouse.io/acme/jobs/1234567`, or `/apply software jobs Vancouver`, or `/loop /apply` to keep it going.

## What it does

| Step | How |
|---|---|
| Find | Postings you give it, company career boards (Greenhouse, Workday) and curated internship lists. It never automates LinkedIn. |
| Tailor | Claude writes a summary and cover letter for the job, only from facts in your `profile.yaml` |
| Documents | `docs/render.py`: real `pdflatex`, one page, clickable links, and a refusal when the result isn't exactly one page |
| Fill | Workday (sign in or account, every wizard page, screening questions, self-ID, Review) and Greenhouse (form, files, custom questions, security code from mail) |
| Submit | Only with `--submit`, or `AUTOSUBMIT` in your folder |
| Track | `applications.json`, and `log-apply ledger` builds a static site of every application |

## Two browsers, one filler

Each site's filler is one function. It runs on either browser:
- **chrome** (default): any Chrome, Edge or Brave. log apply opens a dedicated profile on a debugging port, because Chrome 136+ won't allow that on your everyday profile. Sign in to Google there once with `log-apply browser`.
- **aside**: the [Aside](https://aside.com) browser, through `aside repl`, in your already signed-in profile with Gmail built in. Each step is one REPL call.

## CLI

```
log-apply setup | doctor | browser
log-apply docs  <job.yaml>
log-apply apply <job.yaml> [--driver chrome|aside] [--submit] [--keep-open] [--google]
log-apply track <job.yaml> --status applied|interview|rejected|prepared
log-apply ledger [--out <dir>]
```

## Your answers

`profile.yaml` holds everything personal: contact, education, experience, projects, skills, work authorization and self-ID. Nothing personal lives in the code. Screening questions are matched by regex:
- `rules/defaults.yaml` holds the generic ones, filled from your profile.
- Your own `answers:` in the profile win over them.

When a form asks something no rule covers, `apply` stops with `needsAnswers` and lists the questions. Your agent adds the answer, and every later form gets it right.

## Requirements

- Node 20+
- Python 3 with `pyyaml` and `pypdf`
- `pdflatex` (MiKTeX, MacTeX or TeX Live)
- Chrome, Edge or Brave (or Aside)
- For the chrome driver's verification emails: `LOG_APPLY_IMAP_USER` and `LOG_APPLY_IMAP_PASS`, a Gmail app password

## Care

It applies as you, so it only says what's true in your profile. It works one application at a time, stops at CAPTCHAs and identity checks, and keeps Workday passwords only in `~/.log-apply/accounts.json` on your machine.

MIT licensed.
