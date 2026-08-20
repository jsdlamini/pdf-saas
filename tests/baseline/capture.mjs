// Behavioural-baseline capture: drives each client-side tool in a real browser,
// uploads fixed fixtures, sets fixed options, runs, and downloads the output.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const FIX = join(here, "fixtures");
const OUT = process.env.CAPTURE_DIR || join(here, "captures");
const BASE = process.env.BASE_URL || "http://localhost:3000";

// cases: { slug, name, files, run?, setup? }
//   files: fixture filenames; run: force a click on Run (else rely on auto-run or click only when not auto-ran)
//   setup: async (page) => void — set non-default options before running
const CASES = [
  // --- Organize ---
  { slug: "merge-pdf", name: "two", files: ["fixture-a.pdf", "fixture-b.pdf"], run: true },
  { slug: "merge-pdf", name: "one", files: ["fixture-a.pdf"], run: true },
  { slug: "split-pdf", name: "default", files: ["fixture-a.pdf"], run: true },
  { slug: "split-pdf", name: "range", files: ["fixture-a.pdf"], run: true, setup: (p) => p.fill("#ranges", "2-4") },
  { slug: "extract-pages", name: "default", files: ["fixture-a.pdf"], run: true },
  { slug: "remove-pages", name: "default", files: ["fixture-a.pdf"], run: true },
  { slug: "organize-pdf", name: "default", files: ["fixture-a.pdf"], run: true },
  { slug: "rotate-pdf", name: "default", files: ["fixture-a.pdf"], run: true },
  { slug: "rotate-pdf", name: "deg180", files: ["fixture-a.pdf"], run: true, setup: (p) => p.click('button:has-text("180°")') },
  // --- Optimize ---
  { slug: "compress-pdf", name: "default", files: ["fixture-a.pdf"] },
  { slug: "compress-pdf", name: "grayscale", files: ["fixture-a.pdf"], setup: (p) => p.click("text=Grayscale") },
  { slug: "repair-pdf", name: "default", files: ["fixture-a.pdf"] },
  { slug: "pdf-to-pdfa", name: "default", files: ["fixture-a.pdf"] },
  // --- Convert (client-side) ---
  { slug: "pdf-to-powerpoint", name: "default", files: ["fixture-a.pdf"] },
  { slug: "pdf-to-excel", name: "default", files: ["fixture-a.pdf"] },
  { slug: "pdf-to-latex", name: "default", files: ["fixture-a.pdf"] },
  { slug: "pdf-to-jpg", name: "default", files: ["fixture-a.pdf"] },
  // --- Security ---
  { slug: "protect-pdf", name: "password", files: ["fixture-a.pdf"], run: true, setup: (p) => p.fill("#password", "secret123") },
  { slug: "unlock-pdf", name: "default", files: ["fixture-a.pdf"] },
  { slug: "redact-pdf", name: "default", files: ["fixture-a.pdf"] },
  // --- Edit ---
  { slug: "page-numbers", name: "default", files: ["fixture-a.pdf"] },
  { slug: "crop-pdf", name: "default", files: ["fixture-a.pdf"], run: true },
  { slug: "crop-pdf", name: "margin30", files: ["fixture-a.pdf"], run: true, setup: (p) => p.fill('input[placeholder="Example: 20"]', "30") },
  { slug: "edit-pdf", name: "default", files: ["fixture-a.pdf"], run: true },
  // --- Sign ---
  { slug: "sign-pdf", name: "default", files: ["fixture-a.pdf"], run: true },
  { slug: "compare-pdf", name: "two", files: ["fixture-a.pdf", "fixture-b.pdf"], run: true },
];

async function captureOne(page, c) {
  const slugDir = join(OUT, c.slug);
  mkdirSync(slugDir, { recursive: true });
  const outPath = join(slugDir, `${c.name}.out`);

  await page.goto(`${BASE}/tools/${c.slug}`, { waitUntil: "networkidle" });

  const files = c.files.map((f) => join(FIX, f));
  await page.setInputFiles('input[type="file"]', files);

  // give upload processing a moment to hydrate
  await page.waitForTimeout(1200);

  if (c.setup) await c.setup(page);

  const runBtn = page.locator('button:has-text("Run")').first();
  const downloadBtn = page.locator('button:has-text("Download output")');

  // Non-auto-run tools need an explicit Run; auto-run tools just need to wait.
  if (c.run) {
    await runBtn.waitFor({ state: "visible", timeout: 15000 });
    await runBtn.click();
  }

  await downloadBtn.waitFor({ state: "visible", timeout: 180000 });
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    downloadBtn.click(),
  ]);
  await download.saveAs(outPath);
  return outPath;
}

async function main() {
  const filter = process.argv[2];
  const cases = filter ? CASES.filter((c) => c.slug === filter || c.name.includes(filter)) : CASES;
  const browser = await chromium.launch();
  const page = await browser.newPage();
  // Dismiss the onboarding modal on every page load.
  await page.addInitScript(() => {
    localStorage.setItem("wiserfiles-onboarding-seen", "1");
  });
  for (const c of cases) {
    try {
      const p = await captureOne(page, c);
      console.log(`OK   ${c.slug}/${c.name} -> ${p}`);
    } catch (err) {
      console.log(`FAIL ${c.slug}/${c.name} -> ${err.message}`);
    }
  }
  await browser.close();
}

main();
