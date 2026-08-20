// CI check for the Option B renderer: rendering is deterministic — the same
// fixture must produce a byte-identical pixel hash across two renders on the
// same machine. (The absolute pixel hash is machine-dependent because standard
// font glyph rendering varies, so we do not pin a cross-machine golden hash.)
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderPdfGrayscale, hashPixels } from "./render-pixels.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = ["fixture-a", "fixture-b"];

let failed = false;
for (const name of fixtures) {
  const bytes = new Uint8Array(readFileSync(join(here, "fixtures", `${name}.pdf`)));
  const first = await renderPdfGrayscale(bytes, 2);
  const second = await renderPdfGrayscale(bytes, 2);
  const firstHash = hashPixels(first);
  const secondHash = hashPixels(second);
  const ok = firstHash === secondHash;
  console.log(`${ok ? "OK  " : "FAIL"} ${name} ${firstHash.slice(0, 16)}`);
  if (!ok) failed = true;
}

process.exit(failed ? 1 : 0);
