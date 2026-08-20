// CI check for the Option B renderer: every fixture must render to the same
// deterministic pixel hash as the committed expectation, and rendering twice
// must be byte-identical. Run with: node tests/baseline/render-check.mjs
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderPdfGrayscale, hashPixels } from "./render-pixels.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const expected = JSON.parse(
  readFileSync(join(here, "fixture-pixel-hashes.json"), "utf8")
);

let failed = false;
for (const [name, spec] of Object.entries(expected)) {
  const bytes = new Uint8Array(readFileSync(join(here, "fixtures", `${name}.pdf`)));
  const first = await renderPdfGrayscale(bytes, 2);
  const second = await renderPdfGrayscale(bytes, 2);
  const firstHash = hashPixels(first);
  const secondHash = hashPixels(second);
  const ok = firstHash === spec.hash && firstHash === secondHash;
  console.log(
    `${ok ? "OK  " : "FAIL"} ${name} ${firstHash.slice(0, 16)}` +
      (ok ? "" : ` (want ${spec.hash.slice(0, 16)}, rerun ${secondHash.slice(0, 16)})`)
  );
  if (!ok) failed = true;
}

process.exit(failed ? 1 : 0);
