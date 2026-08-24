# Product Hunt Launch

## Tagline
25 free PDF tools + a LaTeX/Python/C++ research studio — with conversions that actually work, all in your browser.

## Description

WiserFiles is a privacy-first PDF toolkit and research studio.

**PDF tools (25, all free):**
Merge, split, compress, OCR, sign, redact, convert, compare, rotate — plus voice search to find any tool instantly. Most conversions run entirely in your browser, so your documents never leave your device. No account, no watermarks, no daily limits.

**Conversions that don't feel like a downgrade:**
- **PDF → Excel** extracts real tables into spreadsheet cells (rows and columns), not a single text column
- **PDF → PowerPoint** builds real slides with a title and bulleted body per page, plus embedded images
- **PDF → Word** preserves headings, lists, and tables instead of flattening to plain text
- **Redact** permanently removes sensitive text so it can't be recovered

**Research Studio (for students & researchers):**
- A real code editor (CodeMirror 6) for LaTeX, Python, and C++ — with a live PDF beside your source
- Instant incremental compile — edit, save, and see the PDF update in a fraction of a second
- Import a full LaTeX/Overleaf project as a zip — chapters, figures, and appendices come along
- Multi-file C++ and Python projects compile and run
- AI writing assistant — summarize, rewrite, expand, improve
- AI peer review — a simulated reviewer's critique before you submit
- Live collaboration — real-time cursors and edits with co-authors
- Computed figures — generate matplotlib plots and auto-embed them in your paper
- Version history with visual diffs
- DOI citation import, CSV-to-LaTeX tables, journal word-limit tracking
- Export to Word or Markdown

**Why it's different:**
Most PDF tools upload your files to a server and hand back a text dump. WiserFiles processes most conversions in your browser — so your documents stay on your device — and the server-side conversions actually infer structure: tables for Excel, slide layout for PowerPoint, document styles for Word. The Research Studio combines writing, code, and AI in one reproducible-research workspace, and you can import an existing project and keep going in one click.

## First comment

Thanks for checking out WiserFiles! I built this after getting frustrated with PDF tools that watermark documents and cap daily usage — and with "PDF to Excel" tools that just paste all the text into one cell. The Research Studio started as a LaTeX editor for my own thesis and grew from there.

Free plan: everything above. AI features have a fair daily quota (higher for registered users). Happy to answer questions!

## Maker's note

The editor runs on CodeMirror 6, AI features run on DeepSeek, collaboration uses PostgreSQL LISTEN/NOTIFY + Server-Sent Events (no WebSocket server needed), and PDF processing uses pdf-lib/jspdf client-side. PDF → Excel uses PyMuPDF table detection; PDF → PowerPoint uses typography inference with python-pptx; PDF → Word uses structure-aware extraction. Multi-file C++ and Python projects compile server-side in an isolated sandbox. Ask me anything about the stack.
