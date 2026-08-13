# Product Hunt Launch

## Tagline
30 free PDF tools + an AI research studio for writing papers, running code, and collaborating — all in your browser.

## Description

WiserFiles is a privacy-first PDF toolkit and research studio.

**PDF tools (30, all free):**
Merge, split, compress, OCR, sign, redact, convert, compare, rotate — plus voice search to find any tool instantly. Files are encrypted in transit and auto-deleted after processing. No account, no watermarks, no daily limits.

**Research Studio (for students & researchers):**
- LaTeX + Python + C++ editing with live code execution
- AI writing assistant — summarize, rewrite, expand, improve
- AI peer review — a simulated reviewer's critique before you submit
- Live collaboration — real-time cursors and edits with co-authors
- Computed figures — generate matplotlib plots and auto-embed them in your paper
- Version history with visual diffs
- DOI citation import, CSV-to-LaTeX tables, journal word-limit tracking
- Export to Word or Markdown

**Why it's different:**
Most PDF tools upload your files to a server. WiserFiles processes most conversions entirely in your browser, so your documents never leave your device. And the Research Studio combines writing, code, and AI in one reproducible-research workspace — something Overleaf and CoCalc don't do together.

## First comment

Thanks for checking out WiserFiles! I built this after getting frustrated with PDF tools that watermark documents and cap daily usage. The Research Studio started as a LaTeX editor for my own thesis and grew from there.

Free plan: everything above. AI features have a fair daily quota (higher for registered users). Happy to answer questions!

## Maker's note

The AI features run on DeepSeek, collaboration uses PostgreSQL LISTEN/NOTIFY + Server-Sent Events (no WebSocket server needed), and PDF processing uses pdf-lib/jspdf client-side. Ask me anything about the stack.
