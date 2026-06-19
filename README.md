# WiserFiles (PDF SaaS Tool Suite)

WiserFiles is a Next.js App Router project that exposes a full iLovePDF-style tool directory with per-tool workspaces.

## Included tool functions

The dashboard includes all major expected PDF workflow functions in one searchable interface:

- Organize: Merge PDF, Split PDF, Organize PDF, Rotate PDF, Remove Pages, Extract Pages
- Optimize: Compress PDF, Repair PDF, OCR PDF, PDF to PDF-A
- Convert: PDF to Word, PDF to PowerPoint, PDF to Excel, Word to PDF, PowerPoint to PDF, Excel to PDF, PDF to JPG, JPG to PDF, HTML to PDF
- Security: Protect PDF, Unlock PDF, Redact PDF
- Edit: Watermark PDF, Page Numbers, Edit PDF, Crop PDF
- Sign: Sign PDF, Compare PDF, Scan to PDF

## Runtime behavior

- Client-executed now: Merge PDF, Split PDF, Rotate PDF, JPG to PDF, Watermark PDF, Page Numbers
- Server-executed now: OCR PDF, which runs OCRmyPDF and returns a searchable PDF with an embedded text layer
- Other server pipeline placeholders: conversion, encryption, signature, and deep editing operations that require backend services

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## Quality checks

```bash
npm run lint
npm run build
```

## OCR requirements

- The OCR route depends on OCRmyPDF plus `tesseract-ocr`, `ghostscript`, and `qpdf` on the server.
- The provided Dockerfile installs those packages for the production container.
- The UI currently exposes English, German, French, Spanish, Italian, Portuguese, Dutch, and Polish OCR profiles and passes the selected language to OCRmyPDF with `-l`.
- OCR uploads larger than 1 GB are rejected in the UI before processing and by the API route as a server-side backstop.

## LaTeX compile requirements

- Research Studio server compile (`/api/latex-compile`) now tries `texliveonfly` first, then falls back to `tectonic` and `latexmk`.
- The compile route attempts `tlmgr` auto-install for missing `.sty` dependencies; on Debian/Ubuntu it detects TeX Live year mismatch and retries with the matching historic TeX Live repository (for example `.../texlive/2023/tlnet-final`).
- If `tlmgr` still fails, it tries an `apt-get` install using known package mappings (for example `siunitx.sty` -> `texlive-science`) and retries compile.
- `apt-get` auto-install is attempted only when the server process runs as root (common in containers). If the process is non-root, `apt-get` fallback is skipped and the response includes the exact reason plus a manual install hint.
- The provided Dockerfile installs `texlive-extra-utils` (for `texliveonfly`), `latexmk`, `texlive-latex-base`, `texlive-latex-recommended`, and `texlive-fonts-recommended`.
- For local (non-Docker) development on Debian/Ubuntu, install:

```bash
sudo apt-get update
sudo apt-get install -y texlive-extra-utils latexmk texlive-latex-base texlive-latex-recommended texlive-fonts-recommended
```

- If you are running via Docker, rebuild and restart after dependency changes:

```bash
docker compose build --no-cache
docker compose up -d
```

## DeepSeek AI compile suggestions

- Research Studio can request AI-assisted compile-log fixes from `/api/latex-fix-suggestions` and render suggestions in the preview pane.
- Configure server environment variables before using this feature:

```bash
DEEPSEEK_API_KEY=your_api_key
# Optional overrides
DEEPSEEK_MODEL=deepseek-chat
DEEPSEEK_API_URL=https://api.deepseek.com/chat/completions
```

- The API sends the current compile log plus editable project files to DeepSeek and expects structured JSON fix suggestions.

### Docker Compose env wiring

- `docker-compose.yml` forwards DeepSeek vars into the `web` service using `${...}` substitution.
- Create a root `.env` file (gitignored) before `docker compose up`.
- A template is provided at `env.compose.example`:

```bash
cp env.compose.example .env
docker compose up -d --build
```

- You can also override at runtime without editing files:

```bash
DEEPSEEK_API_KEY=your_key docker compose up -d --build
```

## Notes

- The tool hub is fully accessible from the home dashboard via search, category filters, and direct links.
- Production hardening should add auth, storage, queue workers, and usage limits for server-side tools.
