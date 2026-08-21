#!/usr/bin/env python3
"""Generate the PDF -> Word conversion corpus.

Each PDF exercises a distinct real-world shape so the structured converter can
be checked across the failure modes the captain enumerated: multi-column
papers, footnotes, forms, scanned pages, tables, slides, repeated running
headers, and right-to-left text.

Run from the repo root:

    python3 tests/pdf2word/make-corpus.py

Outputs PDFs into tests/pdf2word/corpus/ and a tests/pdf2word/corpus-manifest.json
mapping each file to the features the automated check must observe.
"""

import json
import subprocess
import sys
from pathlib import Path

import pymupdf

ROOT = Path(__file__).resolve().parent
CORPUS = ROOT / "corpus"
MANIFEST = ROOT / "corpus-manifest.json"

TEX_DIR = ROOT / "tex-src"


def run_latex(name, body, runs=2):
    """Compile a LaTeX document body to CORPUS/<name>.pdf."""
    tex = TEX_DIR / f"{name}.tex"
    tex.write_text(body)
    for _ in range(runs):
        subprocess.run(
            ["pdflatex", "-interaction=nonstopmode", "-halt-on-error", tex.name],
            cwd=TEX_DIR,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
    pdf = TEX_DIR / f"{name}.pdf"
    if not pdf.exists():
        raise RuntimeError(f"LaTeX failed to produce {name}.pdf")
    (CORPUS / f"{name}.pdf").write_bytes(pdf.read_bytes())


def preamble(doc_class="article", extra=""):
    return f"""\\documentclass[11pt]{{{doc_class}}}
\\usepackage[margin=1in]{{geometry}}
\\usepackage{{graphicx}}
\\usepackage{{array}}
{extra}
"""


def build_latex_docs():
    TEX_DIR.mkdir(parents=True, exist_ok=True)

    # 1. Representative report: clear title / headings / lists / table.
    run_latex(
        "report-title-headings",
        preamble()
        + r"""
\begin{document}
\begin{center}{\LARGE\bfseries Annual Technical Review}\end{center}
\begin{center}{\large Prepared by Engineering}\end{center}

\section{Introduction}
This report summarizes the year's engineering work and its outcomes.
\subsection{Scope}
The scope covers design, implementation, and verification.
\subsection{Audience}
The audience is the engineering leadership team.

\section{Highlights}
\begin{itemize}
\item Shipped the structured document converter.
\item Reduced conversion failures by half.
\item Added automated quality checks.
\end{itemize}

\begin{enumerate}
\item Collect requirements.
\item Implement the change.
\item Verify against the corpus.
\end{enumerate}

\section{Measurements}
\begin{tabular}{|l|c|c|}
\hline
\textbf{Quarter} & \textbf{Committed} & \textbf{Delivered} \\
\hline
Q1 & 12 & 11 \\
Q2 & 15 & 15 \\
Q3 & 10 & 9 \\
\hline
\end{tabular}
\end{document}
""",
    )

    # 2. Multi-column academic paper with footnotes and a table.
    run_latex(
        "academic-two-column",
        r"""\documentclass[10pt,twocolumn]{article}
\usepackage[margin=1in]{geometry}
\usepackage{array}
\title{A Study of Structured Conversion}
\author{A. Researcher}
\begin{document}
\maketitle
\begin{abstract}
We examine whether typography can recover document structure lost in PDF.
\end{abstract}

\section{Introduction}
Portable documents discard semantic structure\footnote{This is a footnote
about structure.}. Recovering it requires inference from visual signals.

\section{Method}
We apply a modal font-size analysis and cluster larger sizes into headings.

\section{Results}
Accuracy improves substantially on structured corpora\footnote{A second
footnote.}.

\begin{table}[h]
\begin{tabular}{|l|c|}
\hline
\textbf{Method} & \textbf{F1} \\
\hline
Baseline & 0.61 \\
Proposed & 0.88 \\
\hline
\end{tabular}
\end{table}

\section{Conclusion}
Inference from typography is a viable path to editable output.
\end{document}
""",
    )

    # 3. Footnotes only.
    run_latex(
        "footnotes",
        preamble()
        + r"""
\begin{document}
\section{Notes}
The first paragraph carries a footnote\footnote{Primary note.}.
The second paragraph carries another\footnote{Secondary note.}.
\end{document}
""",
    )

    # 4. Spreadsheet-style table (longtable).
    run_latex(
        "spreadsheet-table",
        preamble(extra=r"\usepackage{longtable}")
        + r"""
\begin{document}
\section{Quarterly Budget}
\begin{longtable}{|l|r|r|r|}
\hline
\textbf{Item} & \textbf{Q1} & \textbf{Q2} & \textbf{Q3} \\
\hline
Hosting & 120 & 130 & 125 \\
Storage & 40 & 45 & 50 \\
Licenses & 300 & 300 & 300 \\
Support & 80 & 90 & 85 \\
\hline
\end{longtable}
\end{document}
""",
    )

    # 5. Slide deck (beamer) with title and lists.
    run_latex(
        "slide-deck",
        r"""\documentclass{beamer}
\title{Structured Conversion}
\author{Presenter}
\begin{document}
\begin{frame}{Motivation}
PDF output that edits poorly frustrates users.
\end{frame}
\begin{frame}{Plan}
\begin{itemize}
\item Infer headings from size.
\item Emit real lists and tables.
\item Verify with a corpus.
\end{itemize}
\end{frame}
\end{document}
""",
    )

    # 6. Running header that repeats the title (the title-deletion trap).
    run_latex(
        "running-header",
        preamble(extra=r"\usepackage{fancyhdr}\pagestyle{fancy}")
        + r"""
\begin{document}
\lhead{The Title Repeats Here}
\rhead{\thepage}
\chead{}
\begin{center}{\LARGE\bfseries The Title Repeats Here}\end{center}
\section{Body}
The running header repeats the document title on every page, which used to
delete the title entirely.
\newpage
\section{More Body}
This second page also carries the repeated header.
\end{document}
""",
    )

    # 7. Nested lists.
    run_latex(
        "nested-lists",
        preamble()
        + r"""
\begin{document}
\section{Lists}
\begin{itemize}
\item First level
\begin{itemize}
\item Nested bullet
\item Another nested bullet
\end{itemize}
\item Second first-level item
\end{itemize}
\begin{enumerate}
\item Step one
\item Step two
\end{enumerate}
\end{document}
""",
    )


def build_pymupdf_docs():
    # 8. A form: labeled fields with ruled lines.
    doc = pymupdf.open()
    page = doc.new_page()
    page.insert_text((72, 72), "Employment Application Form", fontsize=18, fontname="hebo")
    labels = [
        ("Full name", 120),
        ("Date of birth", 160),
        ("Address", 200),
        ("Phone number", 240),
    ]
    for label, y in labels:
        page.insert_text((72, y), label, fontsize=11)
        page.draw_line(pymupdf.Point(200, y + 2), pymupdf.Point(500, y + 2))
    page.insert_text((72, 300), "Signature", fontsize=11)
    page.draw_line(pymupdf.Point(160, 302), pymupdf.Point(400, 302))
    doc.save(str(CORPUS / "form.pdf"))
    doc.close()

    # 9. Scanned page: visible text rendered as pixels, no text layer (should
    # exit 3 and then be recovered by the route's ocrmypdf retry).
    src = pymupdf.open()
    sp = src.new_page()
    sp.insert_text((72, 72), "This scanned page has no text layer.", fontsize=14)
    sp.insert_text((72, 100), "OCR must recover this text for conversion.", fontsize=14)
    sp.insert_text((72, 128), "The structured converter reports exit code 3.", fontsize=14)
    scan_pix = sp.get_pixmap(dpi=120)
    scan_pix.save(str(CORPUS / "_scan.jpg"))
    src.close()

    img_doc = pymupdf.open()
    page = img_doc.new_page()
    page.insert_image(page.rect, filename=str(CORPUS / "_scan.jpg"))
    img_doc.save(str(CORPUS / "scanned.pdf"))
    img_doc.close()
    (CORPUS / "_scan.jpg").unlink()

    # 10. Plain text: paragraphs, no headings or lists.
    doc = pymupdf.open()
    page = doc.new_page()
    y = 72
    body = (
        "This is a plain text document with no structural markup. "
        "It contains several ordinary paragraphs of body text and nothing else. "
        "The converter should still produce a readable document."
    )
    for _ in range(6):
        page.insert_text((72, y), body, fontsize=11)
        y += 40
    doc.save(str(CORPUS / "plain-text.pdf"))
    doc.close()

    # 11. Right-to-left Hebrew text (DejaVu has Hebrew glyphs and a proper
    # ToUnicode map, unlike pymupdf's hebo fallback which extracts as dots).
    doc = pymupdf.open()
    page = doc.new_page()
    hebrew = (
        "זהו מסמך בעברית שנכתב מימין לשמאל. "
        "הממיר צריך לשמור על הטקסט ולא להיכשל."
    )
    hebrew_font = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
    page.insert_font(fontname="DejaVu", fontfile=hebrew_font)
    page.insert_text((72, 72), hebrew, fontsize=12, fontname="DejaVu")
    page.insert_text((72, 120), "A mixed LTR line follows the RTL text.", fontsize=11)
    doc.save(str(CORPUS / "rtl-hebrew.pdf"))
    doc.close()

    # 12. Bold / italic runs inside body text.
    doc = pymupdf.open()
    page = doc.new_page()
    page.insert_text((72, 72), "Important heading", fontsize=16)
    page.insert_text((72, 110), "Regular text, then bold, then italic text.", fontsize=11)
    doc.save(str(CORPUS / "bold-italic.pdf"))
    doc.close()


def main():
    CORPUS.mkdir(parents=True, exist_ok=True)
    build_latex_docs()
    build_pymupdf_docs()

    manifest = {
        "files": [
            {"name": "report-title-headings.pdf", "has_heading": True, "has_list": True, "has_table": True},
            {"name": "academic-two-column.pdf", "has_heading": True, "has_list": False, "has_table": True},
            {"name": "footnotes.pdf", "has_heading": True, "has_list": False, "has_table": False},
            {"name": "spreadsheet-table.pdf", "has_heading": True, "has_list": False, "has_table": True},
            {"name": "slide-deck.pdf", "has_heading": True, "has_list": True, "has_table": False},
            {"name": "running-header.pdf", "has_heading": True, "has_list": False, "has_table": False},
            {"name": "nested-lists.pdf", "has_heading": True, "has_list": True, "has_table": False},
            {"name": "form.pdf", "has_heading": False, "has_list": False, "has_table": False},
            {"name": "scanned.pdf", "expect_exit_3": True},
            {"name": "plain-text.pdf", "has_heading": False, "has_list": False, "has_table": False},
            {"name": "rtl-hebrew.pdf", "has_heading": False, "has_list": False, "has_table": False},
            {"name": "bold-italic.pdf", "has_heading": True, "has_list": False, "has_table": False},
        ]
    }
    MANIFEST.write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"Corpus written to {CORPUS} ({len(manifest['files'])} files)")


if __name__ == "__main__":
    sys.exit(main())
