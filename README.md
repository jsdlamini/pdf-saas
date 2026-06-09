# PaperTrail (PDF SaaS Tool Suite)

PaperTrail is a Next.js App Router project that exposes a full iLovePDF-style tool directory with per-tool workspaces.

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
- Server pipeline placeholders: conversion, OCR, encryption, signature, and deep editing operations that require backend services

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

## Notes

- The tool hub is fully accessible from the home dashboard via search, category filters, and direct links.
- Production hardening should add auth, storage, queue workers, and usage limits for server-side tools.
