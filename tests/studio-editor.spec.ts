import { test, expect } from "@playwright/test";

// Proves editing happens exactly at the caret. The old textarea + highlight
// overlay could drift (font-weight/italic mismatch), but CodeMirror renders the
// text and caret in a single layer, so the insertion point always matches the
// caret. This test drives the real editor: it clears the document, types a
// known string, homes the caret to offset 0, and asserts the next keystroke is
// prepended — not dropped above/below/left/right.
test("CodeMirror editor inserts text exactly at the caret", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("wiserfiles-onboarding-seen", "1");
  });

  await page.goto("/research-studio", { waitUntil: "networkidle" });

  // Create a blank LaTeX project (the workspace starts on the projects screen).
  await page.getByRole("button", { name: /New Project/i }).first().click();
  const nameInput = page.locator("#swal-project-name");
  if (await nameInput.count()) await nameInput.fill("Caret Alignment Test");
  await page.getByRole("button", { name: "Create" }).click();

  const cm = page.locator(".cm-content").first();
  await cm.waitFor({ state: "visible", timeout: 30_000 });

  // Reset to a known document: select all, clear, type "hello world".
  await cm.click();
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Backspace");
  await page.keyboard.type("hello world");

  // Move the caret to offset 0 and type one character.
  await page.keyboard.press("Home");
  await page.keyboard.type("X");

  const text = ((await cm.textContent()) ?? "").replace(/\u200b/g, "");
  expect(text.trim()).toMatch(/^Xhello world/);
});
