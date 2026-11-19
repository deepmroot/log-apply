# log apply

**Your agent applies to jobs for you.** For each posting it:
- writes a one-page LaTeX resume and cover letter tailored to that job
- fills the application on Workday, Greenhouse, Ashby, Lever or BambooHR in your own browser
- keeps a public ledger of every application, with the documents it sent

Built for a real job search: as many applications as you want in a day, each with its own resume and cover letter. Part of [log](https://github.com/matthewdonsemail-lab/log) by ListeningKit.

If log apply saves you an evening of forms, **[star the repo](https://github.com/deepmroot/log-apply)**. It is free and open source, and stars are how other job seekers find it.

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
| Find | `log-apply find`: new intern and co-op postings from SimplifyJobs and community GitHub lists, with redirector links resolved to the employer's own form and anything already in your tracker dropped. Or postings you give it, or [treg](https://treg.to): every open job on a company's own board (Greenhouse, Ashby, Lever and more), cross-company search, and a check that drops postings already taken down. It never automates LinkedIn. |
| Tailor | Claude writes a summary and cover letter for the job, only from facts in your `profile.yaml` |
| Documents | `docs/render.py`: real `pdflatex`, one page, clickable links, and a refusal when the result isn't exactly one page |
| Fill | Workday (sign in or account, every wizard page, screening questions, self-ID, Review), Greenhouse (form, files, custom questions, security code from mail), and Ashby, Lever and BambooHR (one-page forms: files, location and school pickers, yes/no buttons, date pickers, custom questions). If a site shows a CAPTCHA at submit, the run stops and leaves the filled tab for you to finish. |
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
log-apply find   [--out jobs.json]
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

## Built with

- **[log](https://github.com/matthewdonsemail-lab/log)** by [ListeningKit](https://log.listeningkit.com): the agent stack it's part of.
- **[treg](https://treg.to)**: finds the jobs. One key for company job boards and job search, and it drops closed postings.
- **[Aside](https://aside.com)**: a browser it can drive in your signed-in profile, with Gmail built in.
- **[Claude Code](https://claude.com/claude-code)**: the agent that runs it all, as a plugin.
- **[AutoInternship](https://github.com/pqthangv/AutoInternshipClaude)**: the form-filling and screening approach it grew from.

The resume layout is based on [Jake's Resume](https://github.com/jakegut/resume) (MIT).

## Care

It applies as you, so it only says what's true in your profile. It works one application at a time, stops at CAPTCHAs and identity checks, and keeps Workday passwords only in `~/.log-apply/accounts.json` on your machine.

MIT licensed.
