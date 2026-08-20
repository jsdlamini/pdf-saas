# Explicitly uncovered transforms (not baseline-gated)

The refactor cannot verify these two transforms because they cannot be driven
headlessly with the current Playwright harness. Recorded so the refactor PR can
flag them explicitly rather than silently pass a passthrough hash.

- **edit-pdf — annotation drawing.** The "draw" capture (select Draw tool + mouse
  drag on the canvas) produces the fixture re-saved (`1a3b8f67…`); the canvas
  pointer-event → internal-coordinate mapping (canvas zoom) doesn't register a
  stroke under headless Chromium. Not verified.
- **organize-pdf — page reorder.** HTML5 drag-and-drop (`draggable` + `onDrop`)
  doesn't reorder under Playwright's `dragAndDrop`; the "reorder" capture is a
  passthrough (`1a3b8f67…`). Not verified.

# Pixel coverage (Option B + redact)

- **redact-pdf** is covered twice: the baseline SSIM gate (double-run) and a
  dedicated Playwright pixel test (`tests/redact-pixel.spec.ts`) that renders the
  output with `@napi-rs/canvas` + pdf.js and asserts the default band is solid
  black and the text layer is gone.
- **unlock-pdf** (correct / wrong / owner) is now covered by the baseline after
  the server-side qpdf fix. The previous "unlock-pdf does not unlock" bug is
  fixed and no longer applies.
