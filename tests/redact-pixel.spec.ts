import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

type GrayscalePage = { width: number; height: number; gray: Uint8Array };

// The redact-pdf tool rasterises every page and paints a default middle band
// black (see the runTool "redact-pdf" branch). This is the single pixel test
// that proves the redaction band is actually black and the text layer is gone.
test("redact-pdf paints a black redaction band and flattens text", async ({ page }) => {
  const { renderPdfGrayscale, extractPdfText } = (await import(
    "./baseline/render-pixels.mjs"
  )) as {
    renderPdfGrayscale: (bytes: Uint8Array, scale?: number) => Promise<GrayscalePage[]>;
    extractPdfText: (bytes: Uint8Array) => Promise<string>;
  };

  await page.addInitScript(() => {
    localStorage.setItem("wiserfiles-onboarding-seen", "1");
  });

  await page.goto("/tools/redact-pdf", { waitUntil: "networkidle" });
  await page.setInputFiles('input[type="file"]', ["tests/baseline/fixtures/fixture-a.pdf"]);

  // redact-pdf auto-runs on upload with a default middle band.
  const downloadBtn = page.locator('button:has-text("Download output")');
  await downloadBtn.waitFor({ state: "visible", timeout: 120_000 });
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    downloadBtn.click(),
  ]);

  const bytes = new Uint8Array(await readFile(await download.path()));

  // The original text must be unrecoverable (flattened to an image).
  const text = await extractPdfText(bytes);
  expect(text).toBe("");

  // The default redaction band (~80% width, around mid-page) must be solid black.
  const pages = await renderPdfGrayscale(bytes, 1);
  expect(pages.length).toBeGreaterThan(0);
  const { width, height, gray } = pages[0];
  const bandY = Math.floor(height * 0.48);
  let black = 0;
  for (let x = 0; x < width; x += 1) {
    if (gray[bandY * width + x] < 16) black += 1;
  }
  expect(black / width).toBeGreaterThan(0.7);
});
