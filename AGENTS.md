# AGENTS.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

WiserFiles is a Next.js 16 (App Router) + React 19 + TypeScript app that exposes an iLovePDF-style directory of ~30 PDF tools, each with its own workspace. Styling is Tailwind CSS v4.

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

### Edit PDF: VSCode-style editor
All edit-pdf code lives in `app/tools/tool-workbench.tsx` (the `isEditTool` branch):
- Annotation model: `type EditPageLayer` (strokes, textNotes, highlights, shapes, whiteouts, images, stamps — every annotation has an `id`). Per-page state is bound via `editLayersByPage` + `editLayersRef` (ref mirror read by `loadEditPreview` to avoid stale closures on file swap). Document-level state: `editFormFields` (AcroForm values), `editWatermark`, `editBatchScope`, `editSnapToGrid`, `editTextSpansRef` (click-to-edit span cache per page).
- The editor UI is a dark IDE-style panel (toolbar with `EDIT_TOOL_OPTIONS`/`EditToolGlyph`, contextual properties bar, page-thumbnail sidebar with Forms/Document panels, status bar). Tool modes are `EditToolMode` (`"select" | "draw" | "highlight" | "text" | "edit-text" | "rect" | "ellipse" | "line" | "arrow" | "whiteout" | "stamp"`).
- History: per-page undo/redo stacks in `editUndoStacksRef` / `editRedoStacksRef`; every mutation goes through `commitEditLayer` / `applyEditLayerToPage` (never mutate layer state directly) or it won't be undoable/persisted. `commitEditLayer` also calls `applyEditBatchClones` — batch-apply (this page / all pages / range) clones only the *added* annotation ids onto target pages, scaled via `scaleEditLayerForPage`.
- Forms: `extractPdfFormFields` (pdf-lib `instanceof PDFTextField/PDFCheckBox/PDFRadioGroup/PDFDropdown/PDFOptionList` — note `PDFDropdown.getSelected()` returns `string[]`). Export re-applies values to the loaded doc and calls `form.updateFieldAppearances(font)`; the AcroForm is kept (not flattened).
- Click-to-edit text: `renderEditPagePreview` extracts word spans via pdfjs `getTextContent` + `Util.transform(viewport.transform, item.transform)` (viewport scale is a fixed 1.2). Clicking in `edit-text` mode whiteouts the span bbox + adds a text note at the span's baseline/font size.
- Export: in `runTool()`, the `pageLayers` merge + pdf-lib draw loop in z-order highlights → whiteouts → text → shapes → images → stamps → strokes; the document watermark is drawn on every page after annotations. Canvas coords are scaled per page via `editCanvasSizesRef`, falling back to `editCanvasSize`.
- Rotation sign convention: canvas `rotate(θ)` is clockwise on screen; pdf-lib `rotate: degrees(θ)` is counterclockwise. Centered/rotated content uses `pdfRotatedImageAnchor` / `pdfRotatedTextAnchor` with `degrees(-visualAngle)`. Stamps export via `page.pushOperators` (pdf-lib 1.17 has no `borderRadius` on `drawRectangle`, so the pill is a manual quadratic-curve path).

Note: `pdfjs-dist` is loaded dynamically and its worker is wired via `configurePdfJsWorker` using the `legacy/build` entry points — keep that import path when touching PDF rendering.

Many "convert" tools (PDF→Word/PPT/Excel, Word/PPT/Excel/HTML→PDF) are text-extraction approximations, not faithful layout conversions. Several tools listed in the registry are UI/placeholder only; see the README "Runtime behavior" section for what is actually implemented client-side vs. server-side.

### Server tools: subprocess-backed API routes
Server-runtime tools live under `app/api/*`. Fully implemented server tools include OCR (`app/api/ocr-pdf/route.ts`):
- Runs `ocrmypdf` as a child process via `execFile`; the route is `runtime = "nodejs"` and `dynamic = "force-dynamic"`.
- Core logic is `handleOcrPost(request, dependencies)` with an injected `OcrRouteDependencies` (fs + `execFileAsync`). Tests call `handleOcrPost` directly with mocked deps — preserve this dependency-injection seam when editing.
- A missing `ocrmypdf` binary (`ENOENT`) is mapped to HTTP 503; OCRmyPDF stderr/stdout is surfaced as 500.

PDF→Word (`app/api/pdf-to-word/route.ts`) tries `pdf2docx` first, then falls back to LibreOffice:
- Runs `python3 scripts/pdf2word-convert.py <in.pdf> <out.docx>` (thin wrapper over `pdf2docx.Converter`), resolved via `join(process.cwd(), "scripts", "pdf2word-convert.py")`.
- On a non-zero exit or `ENOENT` from that step it falls back to `libreoffice --headless --convert-to docx`.
- Same injected-deps seam as OCR (`handlePdfToWordPost(request, dependencies)`); tests live in `app/api/pdf-to-word/route.test.ts`.

### Auth & middleware
Next.js 16 middleware convention is `proxy.ts` (the `middleware.ts` convention is deprecated — it warns, and having both files breaks the build). The repo's `proxy.ts` wraps `clerkMiddleware` and is the home for route auth/redirect rules: it currently lets `PUBLIC_PATHS` through and redirects logged-out visitors from `/` to `/research-studio`. The logged-out `/` redirect deliberately skips requests carrying Clerk's own query params (`__clerk*`, `suffixed_cookies` — see `lib/clerk-query-params.ts`) so Clerk's sign-in/sign-up handshake, OAuth/email-link return, and ticket flows can complete instead of being bounced. When adding auth redirects or route protection, edit `proxy.ts`, not a new `middleware.ts`.

### Courses & teacher gating
- `app/api/courses/route.ts` (action-dispatch: `create`/`list`/`get`/`regenerate-join-code`/`revoke-join`) wires `wiserfiles_courses` + one `wiserfiles_cohorts` row per course + `wiserfiles_enrollments`. The join-link token lives on `wiserfiles_cohorts.join_code` (now nullable for revoke); regenerate/revoke UPDATE that cohort row only and never touch `wiserfiles_enrollments`, so existing members keep their `cohort_id` and submissions stay intact. Joining reuses `POST /api/cohorts` action=`join` (no new endpoint).
- Teacher = admin OR verified email matching `lecturer_email_domains` (`lib/user-roles.ts` `isLecturerOrAdmin`, default `uneswa.ac.sz`, settable via `/api/admin-settings` + the dashboard Settings tab). `isCourseTeacher` = that OR course owner OR lecturer enrollment; assistants are NOT course teachers. `courses` `create` is gated by `isLecturerOrAdmin`; `regenerate-join-code`/`revoke-join` by `isCourseTeacher`. `POST /api/cohorts` `create` is teacher-gated. `POST /api/groups` group CRUD + `assign-staff`/`unassign-staff`/`list-staff` are gated by `isCourseTeacher` for the group's course (resolved from `wiserfiles_groups.course_id`); student `join`/`switch` and `GET /api/groups` are course-scoped by `courseId`.
- CSC111 one-time seed is idempotent SQL in `lib/db.ts` MIGRATIONS: creates the course + `slug='csc111'` cohort and enrols current `wiserfiles_group_members` (student number → Clerk id via existing enrollment/roster mapping) plus all `role='assistant'` users. Its enrollment upserts use `ON CONFLICT ... DO NOTHING` — never `DO UPDATE` here, because the student seed's SELECT can emit duplicate `(user_id, cohort_id)` keys and `DO UPDATE` then raises `ON CONFLICT DO UPDATE command cannot affect row a second time` (21000).
- `lib/db.ts` MIGRATIONS run on every `ensureMigrated()` (once per app start) and must stay idempotent/re-run-safe. Never add-then-drop a column: each run leaks one dropped column toward Postgres's 1600-column limit. `ADD COLUMN IF NOT EXISTS` is fine; a matching later `DROP COLUMN IF EXISTS` is not. Idempotency is enforced by `lib/db-migrations.test.ts` (runs MIGRATIONS twice against the CI Postgres service).
- `resolveCohortId` (`lib/challenges.ts`) prefers the most recent active *contest* enrollment (cohort with `course_id IS NULL`) so a course enrollment never silently redirects submissions/leaderboard.
- Courses UI (Phase 2): `app/components/course-panel.tsx` renders "My Courses" on the Research Studio projects board (teacher view = create course + reveal/copy/QR/regenerate/disable join link; student view = join with a code + enrolled courses). A course's projects are nested under its card via a nullable `wiserfiles_research_projects.course_id` (`lib/db.ts` MIGRATIONS + `lib/research-project-store.ts`; set from the New Project dialog). The public join flow is `/join?code=…` (added to `PUBLIC_PATHS` in `proxy.ts`) backed by a public resolver `app/api/join/route.ts` — it maps a join code to a course name pre-sign-in and returns 404 for revoked / 410 for expired-or-fully-used links; the actual enroll reuses `POST /api/cohorts` action=`join`. `GET /api/courses` list also returns `canCreate` (the caller's `isLecturerOrAdmin`).

### Practical groups are course-scoped (Phase 3)
- `wiserfiles_groups.course_id` (nullable FK → `wiserfiles_courses`) scopes groups to a course; the six seeded groups are backfilled to CSC111 (idempotent migration + `ensureGroupsSeeded` in `lib/groups-store.ts`). The groups UI lives in `app/components/course-groups-panel.tsx`, rendered inside `course-panel.tsx` only for the CSC111 course (`course.code === "CSC111"`). The old inline groups dialog in `research-studio/page.tsx` is now dead code (the hero button was removed) — prune it rather than extend it.
- Staff assignment: `wiserfiles_group_staff (group_id, user_id, role)` with `role` teacher|assistant. An assistant/lecturer may assess ONLY their assigned groups (admin assesses everything); enforced in `app/api/groups/assess/route.ts` + `assess/export/route.ts`. Whole-class assess stays admin-only and is course-scoped (pass `courseId`). PDF/Excel `group=all` exports are course-scoped via `getRosterWithMarks(null, courseId)`.

### Practical-group assessment
`app/api/groups/assess/route.ts` + `lib/assess-store.ts` back the per-group "Assess" dialog in `course-groups-panel.tsx`. The route supports per-group (`?group=<id>`) and whole-class (`?group=__all__`, the `CLASS_ASSESS_GROUP` sentinel in `lib/groups.ts`) modes. Whole-class is admin-only and course-scoped. Whole-class returns the same `assessData` shape (students/practicals/tests/exams/marks) but addresses columns by deterministic virtual ids (`encodeClassItemId`/`decodeClassItemId` in `lib/assess-store.ts`); `saveAssessmentForClass(marks, courseId)` resolves each student's virtual id to their own group's session before upserting.

The "Assess whole class" button's visibility is controlled by the dashboard's Studio Button Visibility table (`lib/studio-buttons.ts` `assessClass` key, default admin-only) and is gated in `app/components/course-groups-panel.tsx` by `buttons.assessClass` — no hard-coded role gate. The whole-class API stays admin-only regardless of that visibility config, so granting the button to non-admins only reveals it (the API still 403s them); do not silently open whole-class data to non-admins.

Admin student editing: `app/api/groups/route.ts` `POST { action: "update-member" }` (admin-only, 403 otherwise) updates a member's name/surname/student_id/programme via `updateGroupMember` in `lib/groups-store.ts`. It updates the existing `wiserfiles_group_members` row in place — never a new membership or Clerk change — and, when the student number changes, migrates that group's `wiserfiles_assessment_marks` rows (keyed by the student number) to the new number. The edit control is an "Edit" action per student in the per-group Assess dialog in `app/components/course-groups-panel.tsx`, gated by `isAdmin`.

Admin student deletion: same route/dialog, `action: "delete-member"` via `deleteGroupMember` in `lib/groups-store.ts` — deletes only the one `wiserfiles_group_members (user_id, group_id)` row, that group's `wiserfiles_assessment_marks` rows for the student number (sessions scoped by group), and the `wiserfiles_group_switch_log` rows for that user/student number. Never the Clerk account or other memberships sharing it. A "Delete" button (with confirm dialog) sits beside Edit.

### Shared client/server contract
`lib/ocr.ts` holds constants used by BOTH the browser and the API route: `MAX_OCR_UPLOAD_BYTES` (1 GB) and `OCR_LANGUAGE_OPTIONS` / `SUPPORTED_OCR_LANGUAGES`. The upload-size and language validations are enforced client-side (in `ToolWorkbench`) and re-checked server-side as a backstop. Adding an OCR language requires updating `OCR_LANGUAGE_OPTIONS` here AND installing the matching `tesseract-ocr-*` package in the `Dockerfile`.

## System dependencies & deployment
OCR requires `ocrmypdf`, `tesseract-ocr` (+ per-language packs), `ghostscript`, and `qpdf` on the host. These are not npm packages — locally, OCR returns 503 unless they are installed. PDF→Word additionally needs `python3` + the `pdf2docx` pip package (both installed in the `Dockerfile`) with `libreoffice-writer` as the fallback engine. The `Dockerfile` (multi-stage, Node 22) installs all of these and is the intended way to run server tools; `docker-compose.yml` builds and exposes port 3000.

## Notes
- `tmp-tests/` contains throwaway manual test artifacts (sample PDFs, captured response headers), not part of the automated suite.
- `app/.env` and `app/.env.local` exist but env files are gitignored; do not commit secrets.

## Research Studio Code Mode
- The Research Studio (`app/research-studio/page.tsx`) supports three editor modes: `"latex"`, `"python"`, `"cpp"`.
- Mode is selected via `.studio-mode-selector` tabs in the top bar. State is stored in `editorMode` and persisted in project snapshots (`SavedProjectData.editorMode`).
- When `isCodeMode` (python/cpp), the toolbar shows a Run button (calls `runCode()`) and a Download button for the current file. The LaTeX-specific toolbar (bold, italic, sections, etc.) and PDF preview are hidden.
- Code execution: `runCode()` calls `/api/run-code` (POST `{ code, language }`). The API route (`app/api/run-code/route.ts`) spawns `python3` or compiles + runs with `g++`, with 10s timeout, 100KB output limit, and basic sandbox restrictions.
- Syntax highlighting: `highlightPythonSource()` and `highlightCppSource()` are regex-based highlighters in `page.tsx`; their tokens (`.studio-token-keyword`, `.studio-token-string`, `.studio-token-function`, `.studio-token-number`, `.studio-token-preprocessor`, `.studio-token-decorator`) are styled in `globals.css`.
- Code templates: `"python-script"` and `"cpp-program"` in `lib/research-templates.ts`, each with `main.py`/`main.cpp`, `data/`, and `output/` folders.
- New files created via the file tree (".py" or ".cpp" extension) get language-appropriate templates from `nextTemplateFor()`.
- Editor autocomplete has TWO LaTeX-only sources that must both stay gated to `latex`: the CodeMirror override in `lib/latex-completion.ts` (`latexCompletionSource`/`latexAutocompleteOverride`, wired via `autocompleteCompartment` in `app/components/latex-editor.tsx`) and the custom React dropdown in `app/research-studio/page.tsx` (`LATEX_INTELLISENSE_ITEMS` + `updateIntellisenseFromInput`, gated on `editorMode === "latex"`). Python/C++ keyword completions come from the base `autocompletion()`, so the override must not be installed for code modes.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
