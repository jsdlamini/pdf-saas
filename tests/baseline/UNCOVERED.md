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

# Known production bug (not a coverage gap)

- **unlock-pdf does not unlock.** It loads with `ignoreEncryption: true` and
  re-saves, which parses without decrypting — the output is still encrypted.
  Verified end-to-end against the live tool: a user-password PDF stays locked
  (`PasswordError`), and an owner-password-only PDF is **corrupted**
  (`unable to find /Root dictionary`). Needs a code fix before it can be
  baseline'd. The password input is not used by the unlock path.
