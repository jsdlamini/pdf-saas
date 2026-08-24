# Reddit Post — Optimized for r/InternetIsBeautiful

## Primary post (r/InternetIsBeautiful)

**Title:** I built 25 free PDF tools plus a research studio — and fixed PDF → Excel so it gives you actual cells, not a text dump

**Body:**

After getting frustrated with PDF tools that watermark your documents, cap you at 2 files per day, or make you sign up just to download, I built the tool I wanted to use myself.

[WiserFiles](https://pdf.idealsoftwaresolutions.com) — 25 PDF tools, all free, plus a Research Studio:

**PDF tools that actually do the thing:**
• **PDF → Excel** extracts real tables into rows and columns (each table gets its own sheet) — not the usual "here's every page's text in one cell"
• **PDF → PowerPoint** builds real slides with a title and bulleted body per page, plus embedded images
• **PDF → Word** preserves headings, lists, and tables instead of flattening to plain text
• **Redact** permanently removes text so it can't be recovered
• Merge, split, compress, OCR, sign, compare, rotate, and 16 more
• 20 of 25 tools work fully offline — nothing uploaded, nothing stored

**Research Studio (for students & researchers):**
• A real CodeMirror editor for LaTeX, Python, and C++ with a live PDF beside your source
• Instant incremental compile — your PDF updates in a fraction of a second
• Import a full LaTeX/Overleaf project as a zip
• Multi-file C++ and Python projects compile and run
• AI writing assistant + simulated peer review (strengths, weaknesses, score)
• Live collaboration with real-time cursors and edits
• Computed matplotlib figures embedded in your paper
• Version history with visual diffs, DOI citation import, Word/Markdown export

**What it doesn't do:**
• Store your files
• Read your documents
• Limit how many you process
• Require an account (for PDF tools)
• Show ads
• Cost anything

Built with Next.js, CodeMirror, pdf-lib, PyMuPDF, python-pptx, openpyxl, PostgreSQL, and DeepSeek. The Research Studio started as a LaTeX editor for my own thesis.

Happy to answer questions. Would love feedback from anyone who writes papers or processes documents regularly.

---

## Cross-post versions

### r/excel
**Title:** PDF → Excel that gives you real tables, not one giant text cell

**Body:**

Every free "PDF to Excel" converter I tried pasted each page's text into a single cell. So I fixed it: [WiserFiles](https://pdf.idealsoftwaresolutions.com/tools/pdf-to-excel) detects the actual tables in your PDF and writes each one to its own worksheet with real rows and columns.

It's free, runs server-side with PyMuPDF's table detection, and deletes your file right after. If your PDF has no tables it gives you a per-page text sheet instead of a broken workbook.

### r/PhD
**Title:** Free LaTeX editor with a live PDF, instant compile, and AI peer review

**Body:**

I built a free research studio because Overleaf's free tier is limiting and I wanted my analysis code next to my paper.

Features: LaTeX + Python + C++ in one workspace, a real CodeMirror editor with a live PDF beside your source, instant incremental compile, one-click import of an existing Overleaf/LaTeX project, multi-file C++/Python, AI writing assistant, simulated peer review, real-time collaboration (cursors + live edits), version history with diffs, computed matplotlib figures, DOI citation import, and Word/Markdown export.

[Try it](https://pdf.idealsoftwaresolutions.com/research-studio) — no credit card, no watermarks.

### r/webdev
**Title:** I built a PDF toolkit + research studio — Next.js, PyMuPDF, DeepSeek, real-time collaboration

**Body:**

Sharing my project [WiserFiles](https://pdf.idealsoftwaresolutions.com) — a Next.js app with:

• Client-side PDF processing (pdf-lib/jspdf) for privacy
• Server-side table detection for PDF → Excel (PyMuPDF), typography inference for PDF → PowerPoint (python-pptx), and structure-aware PDF → Word
• A research studio with a CodeMirror editor for LaTeX/Python/C++, zip import, multi-file code execution, AI writing (DeepSeek), real-time collaboration (PostgreSQL LISTEN/NOTIFY + SSE), and computed figures
• Clerk auth with guest quotas

All free, all open to feedback.
