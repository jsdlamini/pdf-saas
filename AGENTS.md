# AGENTS.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

PaperTrail is a Next.js 16 (App Router) + React 19 + TypeScript app that exposes an iLovePDF-style directory of ~30 PDF tools, each with its own workspace. Styling is Tailwind CSS v4.

## Commands

- `npm run dev` — start the dev server (http://localhost:3000).
- `npm run build` — production build.
- `npm run start` — serve the production build.
- `npm run lint` — ESLint (flat config, `eslint-config-next` core-web-vitals + typescript).
- `npm run test` — run the Vitest suite once.
- Run a single test file: `npx vitest run app/api/ocr-pdf/route.test.ts`.
- Watch a test while iterating: `npx vitest app/api/ocr-pdf/route.test.ts`.

There is no separate typecheck script; `npm run build` performs type checking. Vitest uses the `node` environment and resolves the `@` alias to the repo root (mirrors `tsconfig.json`'s `@/*`).

## Architecture

### Tool registry is the single source of truth
`lib/tools.ts` defines `TOOL_ITEMS`, an array of `{ slug, name, description, category, runtime }`. Everything is slug-driven and derived from this list:
- `app/page.tsx` renders the directory grid.
- `app/layout.tsx` builds category nav and quick actions from it.
- `app/tools/[slug]/page.tsx` resolves a tool via `getToolBySlug`, calls `generateStaticParams` over `TOOL_ITEMS`, and renders `ToolWorkbench`.

To add or change a tool, edit `TOOL_ITEMS` first, then wire its behavior in `ToolWorkbench`. `runtime` (`"client"` | `"server"`) declares where processing happens.

### Client tools: one big workbench
`app/tools/tool-workbench.tsx` is a large `"use client"` component that handles every client-runtime tool. Its `runTool()` is a long `if (tool.slug === ...)` dispatch; per-tool UI affordances are similarly gated by slug-derived booleans (e.g. `isMergeTool`, `usesThumbnailEditor`, `isEditTool`). All PDF work happens in-browser via `pdf-lib`, `jspdf`, `pdfjs-dist`, `jszip`, `mammoth`, `xlsx`, `pptxgenjs`, and `docx`. Output is staged through `stageOutput` (builds an object URL + preview) and only written to disk on explicit download. When adding a client tool, add a new slug branch in `runTool()` rather than creating a new route/component.

Note: `pdfjs-dist` is loaded dynamically and its worker is wired via `configurePdfJsWorker` using the `legacy/build` entry points — keep that import path when touching PDF rendering.

Many "convert" tools (PDF→Word/PPT/Excel, Word/PPT/Excel/HTML→PDF) are text-extraction approximations, not faithful layout conversions. Several tools listed in the registry are UI/placeholder only; see the README "Runtime behavior" section for what is actually implemented client-side vs. server-side.

### Server tools: subprocess-backed API routes
Server-runtime tools live under `app/api/*`. The only fully implemented one is OCR at `app/api/ocr-pdf/route.ts`:
- Runs `ocrmypdf` as a child process via `execFile`; the route is `runtime = "nodejs"` and `dynamic = "force-dynamic"`.
- Core logic is `handleOcrPost(request, dependencies)` with an injected `OcrRouteDependencies` (fs + `execFileAsync`). Tests call `handleOcrPost` directly with mocked deps — preserve this dependency-injection seam when editing.
- A missing `ocrmypdf` binary (`ENOENT`) is mapped to HTTP 503; OCRmyPDF stderr/stdout is surfaced as 500.

### Shared client/server contract
`lib/ocr.ts` holds constants used by BOTH the browser and the API route: `MAX_OCR_UPLOAD_BYTES` (50 MB) and `OCR_LANGUAGE_OPTIONS` / `SUPPORTED_OCR_LANGUAGES`. The upload-size and language validations are enforced client-side (in `ToolWorkbench`) and re-checked server-side as a backstop. Adding an OCR language requires updating `OCR_LANGUAGE_OPTIONS` here AND installing the matching `tesseract-ocr-*` package in the `Dockerfile`.

## System dependencies & deployment
OCR requires `ocrmypdf`, `tesseract-ocr` (+ per-language packs), `ghostscript`, and `qpdf` on the host. These are not npm packages — locally, OCR returns 503 unless they are installed. The `Dockerfile` (multi-stage, Node 22) installs them and is the intended way to run server tools; `docker-compose.yml` builds and exposes port 3000.

## Notes
- `tmp-tests/` contains throwaway manual test artifacts (sample PDFs, captured response headers), not part of the automated suite.
- `app/.env` and `app/.env.local` exist but env files are gitignored; do not commit secrets.
