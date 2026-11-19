---
description: Set up log apply - your profile, browser, mail and LaTeX - so your agent can apply to jobs for you
---

Set up log apply for the user, one step at a time. The CLI is `node ${CLAUDE_PLUGIN_ROOT}/bin/log-apply.mjs` (call it `log-apply` below). Run `npm install --prefix ${CLAUDE_PLUGIN_ROOT}` first if `${CLAUDE_PLUGIN_ROOT}/node_modules` is missing.

1. Ask where their job-search folder should live (default `~/job-search`). It holds their profile, documents and tracker, outside any git repo. `cd` there and run `log-apply setup` to create `profile.yaml`.
2. Fill `profile.yaml` with them, section by section, asking only what you can't read from a resume they give you:
   - contact, links, education (school, degree, dates, GPA, co-op), work authorization and sponsorship, start date and terms
   - experience and projects with real, checkable bullets (never invent a metric or a technology)
   - skills
   - self-identification: ask, and default every field to "Prefer not to say" unless they choose otherwise
   - the transcript path, if their applications need one
3. Run `log-apply doctor` and fix each `--` line with them:
   - browser: Chrome, Edge or Brave works. Run `log-apply browser`, which opens a dedicated log apply profile, and have them sign in to Google there once.
   - mail: for Workday verification links and Greenhouse security codes, set `LOG_APPLY_IMAP_USER` and `LOG_APPLY_IMAP_PASS` (a Gmail app password) in their shell profile. Aside users can skip this.
   - LaTeX: MiKTeX (Windows), MacTeX (macOS) or TeX Live (Linux); Python 3 with `pip install pyyaml pypdf`.
4. Make one test document set: write a `jobs/<Slug>.yaml` for a posting they like (see `${CLAUDE_PLUGIN_ROOT}/examples/job.yaml`), run `log-apply docs jobs/<Slug>.yaml`, and open both PDFs with them.
5. Run one dry fill: `log-apply apply jobs/<Slug>.yaml` (no `--submit`). It leaves the browser tab open on the filled form with `--keep-open`; have them look at it.
6. Ask whether you may submit on their behalf (`--submit`) from now on, or should stop at the filled form each time. Write their answer into the job-search folder as `AUTOSUBMIT` (yes) or nothing (no).

Never print or paste passwords, app passwords or cookies. Workday passwords stay in `~/.log-apply/accounts.json` on their machine.
