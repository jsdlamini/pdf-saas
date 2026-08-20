// Generates the fixed PDF fixtures for the behavioural baseline.
// fixture-a: multi-page, mixed page sizes, one page with a non-zero /Rotate.
// fixture-b: a distinct second PDF for multi-file tools (merge, compare).
import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "fixtures");
mkdirSync(outDir, { recursive: true });

async function makePdf(path, pages) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const p of pages) {
    const page = doc.addPage([p.width, p.height]);
    if (p.rotate) page.setRotation(degrees(p.rotate));
    page.drawText(p.title, { x: 72, y: p.height - 90, size: 16, font, color: rgb(0, 0, 0) });
    for (let i = 0; i < (p.lines || 8); i += 1) {
      page.drawText(`${p.title} line ${i + 1} body text.`, {
        x: 72,
        y: p.height - 130 - i * 20,
        size: 11,
        font,
        color: rgb(0, 0, 0),
      });
    }
  }
  writeFileSync(path, await doc.save());
}

// fixture-a: 5 pages — Letter, A4(rotated 90), Letter, A4, Letter-landscape
await makePdf(join(outDir, "fixture-a.pdf"), [
  { width: 612, height: 792, title: "Fixture A page 1 (Letter)" },
  { width: 595.28, height: 841.89, title: "Fixture A page 2 (A4 rotated)", rotate: 90 },
  { width: 612, height: 792, title: "Fixture A page 3 (Letter)" },
  { width: 595.28, height: 841.89, title: "Fixture A page 4 (A4)" },
  { width: 792, height: 612, title: "Fixture A page 5 (landscape)" },
]);

// fixture-b: 3 distinct pages, all Letter
await makePdf(join(outDir, "fixture-b.pdf"), [
  { width: 612, height: 792, title: "Fixture B page 1", lines: 5 },
  { width: 612, height: 792, title: "Fixture B page 2", lines: 5 },
  { width: 612, height: 792, title: "Fixture B page 3", lines: 5 },
]);

// fixture-encrypted: fixture-a encrypted with a known password, for unlock-pdf.
{
  const src = await PDFDocument.load(readFileSync(join(outDir, "fixture-a.pdf")));
  src.encrypt({ userPassword: "secret123", ownerPassword: "secret123" });
  writeFileSync(join(outDir, "fixture-encrypted.pdf"), await src.save());
}

console.log("fixtures written to", outDir);
