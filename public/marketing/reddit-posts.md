# Reddit Post — Optimized for r/InternetIsBeautiful

## Primary post (r/InternetIsBeautiful)

**Title:** I built 30 free PDF tools plus a full research studio — AI peer review, live collaboration, computed figures — all in your browser

**Body:**

After getting frustrated with PDF tools that watermark your documents, cap you at 2 files per day, or make you sign up just to download, I built the tool I wanted to use myself.

[WiserFiles](https://pdf.idealsoftwaresolutions.com) — 30 PDF tools, all free, plus a Research Studio that I'm genuinely proud of:

**PDF tools:**
• Merge, split, compress, OCR, sign, redact, convert, compare, rotate, and 21 more
• Voice search — just say "compress my PDF" and it finds the tool
• Works offline (installable as a PWA)
• Files encrypted in transit and auto-deleted after processing

**Research Studio (for students & researchers):**
• Full LaTeX editor with syntax highlighting, BibTeX autocomplete, and journal templates
• **Python and C++ editing with live code execution** — write a paper and its analysis code in one place
• **AI writing assistant** — summarize, rewrite, expand, or improve any selection
• **AI peer review** — get a simulated reviewer's critique (strengths, weaknesses, score) before you submit
• **Live collaboration** — invite co-authors, see their cursors and edits in real time
• **Computed figures** — generate a matplotlib plot from Python and auto-embed it in your paper
• **Version history with visual diffs** — never lose a draft
• **Export to Word or Markdown** — for journals that want .docx
• Import citations by DOI, CSV-to-LaTeX tables, and live journal word-limit tracking

**What it doesn't do:**
• Store your files
• Read your documents
• Limit how many you process
• Require an account (for PDF tools)
• Show ads
• Cost anything

Built with Next.js, pdf-lib, jspdf, and DeepSeek for the AI features. The Research Studio started as a LaTeX editor for my own thesis and grew into a full reproducible-research workspace.

Happy to answer questions. Would love feedback from anyone who writes papers or processes documents regularly.

---

## Cross-post versions

### r/college
**Title:** Built a completely free PDF tool suite + research studio for students — no account, files auto-deleted

**Body:**

[WiserFiles](https://pdf.idealsoftwaresolutions.com) is a free toolkit I built. It has 30 PDF tools (merge, split, OCR, sign, compress, convert) plus a research studio with:

• LaTeX + Python + C++ editing with live code execution
• AI writing help (summarize, rewrite, improve grammar)
• AI peer review before you submit your paper
• Live collaboration with co-authors
• Export to Word for professors who want .docx

No account needed for the PDF tools. Files auto-delete. Everything's free.

### r/PhD
**Title:** Free LaTeX editor with AI peer review, live collaboration, and computed figures

**Body:**

I built a free research studio because Overleaf's free tier is limiting and I wanted my analysis code next to my paper.

Features: LaTeX + Python + C++ in one workspace, AI writing assistant, simulated peer review, real-time collaboration (cursors + live edits), version history with diffs, computed matplotlib figures embedded in the paper, DOI citation import, and Word/Markdown export.

[Try it](https://pdf.idealsoftwaresolutions.com/research-studio) — no credit card, no watermarks.

### r/webdev
**Title:** I built a PDF toolkit + research studio — Next.js, PostgreSQL, DeepSeek, real-time collaboration

**Body:**

Sharing my project [WiserFiles](https://pdf.idealsoftwaresolutions.com) — a Next.js app with:

• Client-side PDF processing (pdf-lib/jspdf) for privacy
• Server-side OCR (Tesseract) and conversions (LibreOffice)
• A research studio with LaTeX/Python/C++ editing, AI writing (DeepSeek), real-time collaboration (PostgreSQL LISTEN/NOTIFY + SSE), and computed figures
• Clerk auth with guest quotas

All free, all open to feedback.
