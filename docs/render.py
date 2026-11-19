import datetime
import json
import os
import re
import shutil
import subprocess
import sys

import yaml

RESUME = r"""\documentclass[letterpaper,11pt]{article}
\usepackage[empty]{fullpage}
\usepackage{titlesec}
\usepackage{enumitem}
\usepackage[hidelinks]{hyperref}
\usepackage{fancyhdr}
\usepackage{tabularx}
\input{glyphtounicode}
\pagestyle{fancy}
\fancyhf{}
\renewcommand{\headrulewidth}{0pt}
\renewcommand{\footrulewidth}{0pt}
\addtolength{\oddsidemargin}{-0.5in}
\addtolength{\evensidemargin}{-0.5in}
\addtolength{\textwidth}{1in}
\addtolength{\topmargin}{-.65in}
\addtolength{\textheight}{1.25in}
\urlstyle{same}
\raggedright
\raggedbottom
\setlength{\tabcolsep}{0in}
\titleformat{\section}{\vspace{-4pt}\scshape\raggedright\large}{}{0em}{}[\titlerule \vspace{-6pt}]
\pdfgentounicode=1
\newcommand{\resumeItem}[1]{\item \small{#1 \vspace{-1pt}}}
\newcommand{\resumeSubheading}[4]{\item
  \begin{tabular*}{0.97\textwidth}[t]{l@{\extracolsep{\fill}}r}
    \textbf{#1} & #2 \\
    \textit{\small #3} & \textit{\small #4}
  \end{tabular*}\vspace{-6pt}}
\newcommand{\resumeSubHeadingListStart}{\begin{itemize}[leftmargin=0.15in, label={}, topsep=0pt]}
\newcommand{\resumeSubHeadingListEnd}{\end{itemize}\vspace{-2pt}}
\newcommand{\resumeItemListStart}{\begin{itemize}[leftmargin=0.2in, topsep=0pt, itemsep=0pt]}
\newcommand{\resumeItemListEnd}{\end{itemize}\vspace{-6pt}}
\begin{document}
%%HEADER%%
\section{Summary}
\begin{itemize}[leftmargin=0.15in, label={}, topsep=0pt, itemsep=0pt]
\item \small{%%SUMMARY%%}
\end{itemize}
\section{Education}
\resumeSubHeadingListStart
%%EDUCATION%%
\resumeSubHeadingListEnd
\section{Experience}
\resumeSubHeadingListStart
%%EXPERIENCE%%
\resumeSubHeadingListEnd
%%PROJECTSECTION%%
\vspace{-4pt}
\section{Technical Skills}
\vspace{2pt}
\small{%%SKILLS%%}
\end{document}
"""

COVER = r"""\documentclass[letterpaper,11pt]{article}
\usepackage[empty]{fullpage}
\usepackage[hidelinks]{hyperref}
\usepackage{fancyhdr}
\input{glyphtounicode}
\pagestyle{fancy}
\fancyhf{}
\renewcommand{\headrulewidth}{0pt}
\renewcommand{\footrulewidth}{0pt}
\addtolength{\oddsidemargin}{-0.5in}
\addtolength{\evensidemargin}{-0.5in}
\addtolength{\textwidth}{1in}
\addtolength{\topmargin}{-.65in}
\addtolength{\textheight}{1.25in}
\urlstyle{same}
\raggedright
\raggedbottom
\setlength{\parindent}{0pt}
\setlength{\parskip}{9pt}
\pdfgentounicode=1
\begin{document}
%%HEADER%%
\vspace{4pt}
\hrule
\vspace{14pt}
%%DATE%%

\vspace{8pt}
Hiring Team \\
%%COMPANY%% \\
%%LOCATION%%

\vspace{8pt}
\textbf{Re: %%ROLE%%}

\vspace{10pt}
Dear Hiring Team,

\vspace{4pt}
%%PARAGRAPHS%%

\vspace{16pt}
Sincerely, \\
\vspace{6pt}
\textbf{%%NAME%%}
\end{document}
"""

SPECIAL = {"&": r"\&", "%": r"\%", "$": r"\$", "#": r"\#", "_": r"\_", "{": r"\{", "}": r"\}", "~": r"\textasciitilde{}", "^": r"\textasciicircum{}"}


def tex(s):
    s = str(s or "")
    parts = re.split(r"(\*\*[^*]+\*\*|\\textbf\{[^}]*\})", s)
    out = []
    for part in parts:
        if part.startswith("**") and part.endswith("**"):
            out.append(r"\textbf{" + escape(part[2:-2]) + "}")
        elif part.startswith("\\textbf{"):
            out.append(r"\textbf{" + escape(part[8:-1]) + "}")
        else:
            out.append(escape(part))
    return "".join(out).replace("--", "--").replace("\u2013", "--").replace("\u2014", "---")


def escape(s):
    return "".join(SPECIAL.get(ch, ch) for ch in s)


def header(p):
    c = p["contact"]
    links = c.get("links", {})
    bits = [escape(str(c.get("phoneDisplay") or c["phone"])), r"\href{mailto:%s}{%s}" % (c["email"], escape(c["email"])), escape(f"{c['city']}, {c.get('regionCode') or c.get('region', '')}")]
    if links.get("website"):
        bits.append(r"\href{%s}{%s}" % (links["website"], escape(re.sub(r"^https?://", "", links["website"]).rstrip("/"))))
    if links.get("linkedin"):
        bits.append(r"\href{%s}{LinkedIn}" % links["linkedin"])
    if links.get("github"):
        bits.append(r"\href{%s}{GitHub}" % links["github"])
    name = escape(f"{c['firstName']} {c['lastName']}")
    return "\\begin{center}\n    \\textbf{\\LARGE %s} \\\\ \\vspace{2pt}\n    \\small %s\n\\end{center}" % (name, " $|$ ".join(bits))


def education(p):
    e = p["education"]
    dates = f"{e.get('start', {}).get('year', '')} -- Expected {e.get('end', {}).get('month', '')} {e.get('end', {}).get('year', '')}".strip()
    items = "\n".join(r"      \resumeItem{%s}" % tex(d) for d in e.get("details", []))
    body = f"    \\resumeItemListStart\n{items}\n    \\resumeItemListEnd\n" if items else ""
    return f"  \\resumeSubheading\n    {{{tex(e['school'])}}}{{{tex(e.get('location', ''))}}}\n    {{{tex(e['degree'])}}}{{{tex(dates)}}}\n{body}"


def experience(p, order, limit):
    by_key = {x["key"]: x for x in p.get("experience", [])}
    keys = [k for k in order if k in by_key] + [k for k in by_key if k not in order]
    blocks = []
    for pos, k in enumerate(keys[:limit]):
        x = by_key[k]
        n = 3 if pos < 2 else 2
        items = "\n".join(r"      \resumeItem{%s}" % tex(b) for b in x.get("bullets", [])[:n])
        side = x.get("location") or x.get("stack") or ""
        blocks.append(f"  \\resumeSubheading\n    {{{tex(x['title'])}}}{{{tex(x.get('dates', ''))}}}\n    {{{tex(x['company'])}}}{{{tex(side)}}}\n    \\resumeItemListStart\n{items}\n    \\resumeItemListEnd\n")
    return "\n".join(blocks), set(keys[:limit])


def score(project, text):
    words = set(re.findall(r"[a-z0-9+#.]+", text.lower()))
    terms = [t.lower() for t in project.get("tags", []) + project.get("skills", [])]
    return sum(1 for t in terms if t in words or t in text.lower())


def projects(p, job, exclude, limit=2):
    pool = [x for x in p.get("projects", []) if x["key"] not in exclude]
    wanted = [k for k in job.get("projectKeys", []) if any(x["key"] == k for x in pool)]
    text = " ".join([job.get("role", ""), job.get("summary", "")])
    ranked = sorted(pool, key=lambda x: -score(x, text))
    chosen = [next(x for x in pool if x["key"] == k) for k in wanted] + [x for x in ranked if x["key"] not in wanted]
    blocks = []
    for x in chosen[:limit]:
        links = " $|$ ".join(s for s in [r"\href{%s}{GitHub}" % x["repoUrl"] if x.get("repoUrl") else "", r"\href{%s}{Live}" % x["liveUrl"] if x.get("liveUrl") else ""] if s)
        primary = x.get("liveUrl") or x.get("repoUrl") or p["contact"].get("links", {}).get("website", "")
        title = r"\href{%s}{%s}" % (primary, tex(x["name"])) if primary else tex(x["name"])
        items = "\n".join(r"      \resumeItem{%s}" % tex(b) for b in x.get("bullets", [])[:2])
        blocks.append(f"  \\resumeSubheading\n    {{{title}}}{{{links}}}\n    {{{tex(x.get('role', 'Project'))}}}{{{tex(', '.join(x.get('skills', [])[:4]))}}}\n    \\resumeItemListStart\n{items}\n    \\resumeItemListEnd\n")
    if not blocks:
        return ""
    return "\\section{Projects}\n\\resumeSubHeadingListStart\n" + "\n".join(blocks) + "\\resumeSubHeadingListEnd\n"


def skills(p):
    return " \\\\\n".join(tex(s) for s in p.get("skills", []))


def compile_pdf(path, out):
    pdflatex = shutil.which("pdflatex")
    if not pdflatex:
        raise SystemExit("latexMissing: pdflatex isn't on PATH (install MiKTeX, MacTeX or TeX Live)")
    for _ in range(2):
        r = subprocess.run([pdflatex, "-interaction=nonstopmode", "-halt-on-error", "-output-directory", out, path], capture_output=True, text=True)
    if r.returncode != 0:
        print(r.stdout[-2500:], file=sys.stderr)
        raise SystemExit(f"latexFailed: pdflatex could not build {path}")
    for ext in (".aux", ".log", ".out"):
        f = path[:-4] + ext
        if os.path.exists(f):
            os.remove(f)


def check(pdf):
    from pypdf import PdfReader

    r = PdfReader(pdf)
    links = sum(len([a for a in (pg.get("/Annots") or [])]) for pg in r.pages)
    return {"pages": len(r.pages), "links": links}


def main():
    profile_path, job_path = sys.argv[1], sys.argv[2]
    p = yaml.safe_load(open(profile_path, encoding="utf-8"))
    job = yaml.safe_load(open(job_path, encoding="utf-8"))
    base = os.path.dirname(os.path.abspath(profile_path))
    out = os.path.join(base, p["documents"].get("outDir", "out"))
    os.makedirs(out, exist_ok=True)
    prefix = f"{p['documents']['filePrefix']}_{job['slug']}"
    head = header(p)
    exp, shown = experience(p, job.get("expOrder", []), int(job.get("experienceCount", 3)))
    resume = (RESUME.replace("%%HEADER%%", head).replace("%%SUMMARY%%", tex(job["summary"])).replace("%%EDUCATION%%", education(p))
              .replace("%%EXPERIENCE%%", exp).replace("%%PROJECTSECTION%%", projects(p, job, shown)).replace("%%SKILLS%%", skills(p)))
    company = job.get("displayCompany") or re.sub(r"\s*\([^)]*\)$", "", job["company"])
    cover = (COVER.replace("%%HEADER%%", head).replace("%%DATE%%", datetime.date.today().strftime("%B %d, %Y")).replace("%%COMPANY%%", tex(company))
             .replace("%%LOCATION%%", tex(job.get("location", ""))).replace("%%ROLE%%", tex(job["role"])).replace("%%PARAGRAPHS%%", "\n\n".join(tex(x) for x in job["paragraphs"]))
             .replace("%%NAME%%", escape(f"{p['contact']['firstName']} {p['contact']['lastName']}")))
    results = {}
    for kind, src in (("resume", resume), ("cover", cover)):
        name = f"{prefix}_{'Resume' if kind == 'resume' else 'Cover_Letter'}"
        path = os.path.join(out, name + ".tex")
        open(path, "w", encoding="utf-8").write(src)
        compile_pdf(path, out)
        pdf = os.path.join(out, name + ".pdf")
        results[kind] = {"pdf": pdf, **check(pdf)}
    problems = [f"{k} is {v['pages']} pages" for k, v in results.items() if v["pages"] != 1] + [f"{k} has no clickable links" for k, v in results.items() if v["links"] == 0]
    print(json.dumps({"ok": not problems, "problems": problems, **results}))
    sys.exit(1 if problems else 0)


if __name__ == "__main__":
    main()
