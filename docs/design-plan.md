# WiserFiles design plan (for review — no restyling applied yet)

## 1. Palette — six named values, plus a monochrome scale

The current system has sixteen Tailwind families in play (slate ×782, cyan ×186, down to a single
fuchsia). Collapse to a small, intentional set. Reasoning: the product is a *serious academic/PDF tool*;
the accent should read "quietly trustworthy", not "startup gradient".

| Token | Hex | Role |
|---|---|---|
| `--ink` | `#0B1120` | text / darkest surface (replaces slate-900 as the workhorse) |
| `--paper` | `#FFFFFF` | light-mode surface |
| `--canvas` | `#F5F7FA` | page background / wells (replaces slate-50/100) |
| `--line` | `#DCE1E8` | borders / dividers (replaces slate-200/300) |
| `--muted` | `#5B6472` | secondary text (replaces slate-500/600) |
| `--accent` | `#0E7C5F` | primary action / focus (a single teal-green; replaces the cyan/teal/emerald spread) |
| `--accent-deep` | `#0A5C47` | hover / pressed accent |

Derived states (focus ring, danger, success, warning) stay semantic and are NOT part of the palette:
danger `#DC2626`, success `#16A34A`, warning `#D97706`. Everything else is a tint/shade of the six above.

The two most prominent accents today — the purple→pink primary CTA (`layout.tsx` line 182) and the
`cyan-600` skip link — must both become `--accent`. The skip link gets `--accent` and an outline ring;
the CTA loses the gradient and `hover:scale-105` (scale-on-hover fights reduced-motion and reads as
consumer, not academic).

## 2. Typefaces — self-hosted, three faces only

Today `globals.css` names "JetBrains Mono"/"Fira Code"/"Cascadia Code" in four places but **none are
loaded**; only DM Sans and Space Grotesk arrive via `next/font`, so the editor falls back to OS monospace
on nearly every machine. Space Grotesk also reads startup, not academic.

| Role | Face | Why |
|---|---|---|
| Display / headings | **Source Serif 4** (or STIX Two Text) | an academic, book-like serif that signals "this is a paper, not a toy". Use for page/tool titles and section headings. |
| Body / UI | **Inter** (or DM Sans, already present) | the neutral workhorse for UI and body copy. DM Sans is acceptable; Inter is the safer default. |
| Mono / editor | **JetBrains Mono** | one mono face, actually loaded, for the LaTeX/code editor and any inline code. |

All three **self-hosted via `next/font/local`** — this removes the build's dependency on Google Fonts
being reachable, which currently breaks `deploy.sh` on a network blip. Weight range kept minimal
(display 600/700, body 400/500/600, mono 400/500).

## 3. Layout concepts

### Project listing (the "Projects" screen)
- A **grid of project cards**, not a table: title, last-compiled date, file count, a small "Compiles"
  status dot (green/amber), and a cover thumbnail if a PDF exists.
- Empty state becomes a single centered **"New project / Import .zip"** split action with the dropzone
  directly beneath it — one obvious path, not a button row.
- The header collapses to: project name (left) · compile status (center) · user/Connections (right).

### Mobile studio (below `md`, single pane)
- One pane with three bottom tabs: **Files · Editor · Preview**.
- Files tab: the tree (long-press for the context menu).
- Editor tab: the CodeMirror editor, full-bleed, no side panels.
- Preview tab: the compiled PDF viewer (or a "not compiled yet" state).
- The command palette and compile button stay reachable via a top bar; compile status becomes a slim
  banner above the active tab rather than a toast.

### Wireframes (text)

**375px — Projects screen:**
```
┌────────────────────────┐
│ WiserFiles        [⏸] │   header: wordmark left, Connections icon right
│ ┌────────────────────┐ │
│ │   Import .zip  +    │ │   dropzone / primary action
│ │   (or New project)  │ │
│ └────────────────────┘ │
│ ┌──────────┐ ┌────────┐│
│ │ CSC111   │ │ Book    ││   project cards, one column
│ │ 43 files │ │ 12 files││
│ │ ● compiles│ │ ○      ││
│ └──────────┘ └────────┘│
└────────────────────────┘
```

**375px — Editor tab (studio):**
```
┌────────────────────────┐
│ CSC111          [▶ Run]│   top bar: name + compile
│ ▸ status: compiling…    │   slim status banner (aria-live)
│ ┌────────────────────┐ │
│ │ \documentclass...   │ │   CodeMirror editor, full width
│ │ …                  │ │
│ └────────────────────┘ │
├────────────────────────┤
│ [Files] [Editor] [Prev]│   bottom tabs
└────────────────────────┘
```

**Desktop — studio:** keep the three-pane Files / Editor / Preview layout, but Files and Preview become
collapsible (the editor is the primary surface), and the outline moves into a tab *inside* the Files
pane rather than a separate strip below it.

## 4. The one signature element

**The "Compile" motion.** When a project compiles successfully, the preview panel "develops" like a
photograph — a one-pulse ink wash over the first page, ~600ms, honouring `prefers-reduced-motion` by
falling back to a static reveal. It ties the product to the moment of proof (your document became a
PDF) and is the single visual the product should be remembered by. Everything else is quiet.

---

*This is a plan only. No restyling has been applied. The palette, type, and layout above are open for
review before any code changes.*
