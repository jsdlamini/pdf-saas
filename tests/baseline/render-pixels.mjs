// Option B deterministic renderer: PDF → grayscale pixels via @napi-rs/canvas
// and the real pdf.js (no browser, no ghostscript). Used to hash raster-tool
// outputs exactly (pixel-identical, not SSIM-tolerance), and by the redact
// pixel test to assert the redaction band is actually black.
import { createCanvas } from "@napi-rs/canvas";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const STANDARD_FONTS_URL = pathToFileURL(
  join(here, "..", "..", "node_modules", "pdfjs-dist", "standard_fonts") + "/"
).toString();

async function loadPdf(bytes) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(bytes),
    standardFontDataUrl: STANDARD_FONTS_URL,
    useWorkerFetch: false,
    isEvalSupported: false,
  }).promise;
  return doc;
}

// Renders every page to a grayscale Uint8Array. Deterministic for a given
// input: identical bytes render to identical pixels across runs/machines.
export async function renderPdfGrayscale(bytes, scale = 1) {
  const doc = await loadPdf(bytes);
  const pages = [];
  try {
    for (let i = 1; i <= doc.numPages; i += 1) {
      const page = await doc.getPage(i);
      const viewport = page.getViewport({ scale });
      const width = Math.max(1, Math.floor(viewport.width));
      const height = Math.max(1, Math.floor(viewport.height));
      const canvas = createCanvas(width, height);
      const ctx = canvas.getContext("2d");
      await page.render({ canvas, canvasContext: ctx, viewport }).promise;
      const { data } = ctx.getImageData(0, 0, width, height);
      const gray = new Uint8Array(width * height);
      for (let p = 0, o = 0; p < gray.length; p += 1, o += 4) {
        gray[p] = Math.round(
          0.2126 * data[o] + 0.7152 * data[o + 1] + 0.0722 * data[o + 2]
        );
      }
      pages.push({ width, height, gray });
      if (typeof page.cleanup === "function") page.cleanup();
    }
  } finally {
    if (typeof doc.destroy === "function") await doc.destroy();
  }
  return pages;
}

export function hashPixels(pages) {
  const hash = createHash("sha256");
  for (const page of pages) {
    hash.update(Buffer.from([(page.width >> 8) & 0xff, page.width & 0xff, (page.height >> 8) & 0xff, page.height & 0xff]));
    hash.update(page.gray);
  }
  return hash.digest("hex");
}

// Mean absolute pixel difference over the smaller of the two page sets.
export function meanAbsDiff(pagesA, pagesB) {
  const n = Math.min(pagesA.length, pagesB.length);
  if (!n) return 0;
  let total = 0;
  let count = 0;
  for (let i = 0; i < n; i += 1) {
    const a = pagesA[i];
    const b = pagesB[i];
    const w = Math.min(a.width, b.width);
    const h = Math.min(a.height, b.height);
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        total += Math.abs(a.gray[y * a.width + x] - b.gray[y * b.width + x]);
        count += 1;
      }
    }
  }
  return count ? total / count : 0;
}

// Concatenated text of every page (best-effort), for asserting a rasterised
// output has no recoverable text layer.
export async function extractPdfText(bytes) {
  const doc = await loadPdf(bytes);
  const parts = [];
  try {
    for (let i = 1; i <= doc.numPages; i += 1) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      parts.push(
        content.items
          .map((item) => ("str" in item ? item.str : ""))
          .join(" ")
      );
    }
  } finally {
    if (typeof doc.destroy === "function") await doc.destroy();
  }
  return parts.join("\n").trim();
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const path = process.argv[2];
  const scale = Number(process.argv[3] || "2");
  if (!path) {
    console.error("usage: node render-pixels.mjs <pdf> [scale]");
    process.exit(2);
  }
  const bytes = readFileSync(path);
  const pages = await renderPdfGrayscale(bytes, scale);
  console.log(
    hashPixels(pages),
    `${pages.length} pages`,
    `${pages.reduce((s, p) => s + p.gray.length, 0)} pixels`
  );
}
