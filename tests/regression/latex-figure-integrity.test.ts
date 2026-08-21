import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import {
  decodeAssetContent,
  diagnoseMissingFigures,
  stripDataUrlPrefix,
} from "@/lib/latex-diagnostics";

// Real 32x32 solid-color PNGs (generated deterministically) with their
// SHA-256 identities. The fixture is built in-memory so CI needs no LaTeX
// install: the assertion is that the zip → base64 → decode pipeline never
// changes a single byte.
const RED_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAK0lEQVR4nO3OIQEAAAwEoetfeovxBoGnq1tKQEBAQEBAQEBAQEBAQEBgHXhUDfhqRFDd3gAAAABJRU5ErkJggg==";
const RED_SHA256 = "92352ae0133129c4cba2085c5118c1858471329e7440e612bfd1d62e7236876c";
const BLUE_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAKklEQVR4nO3OIQEAAAACIP+f1hkWAp0k7ZeAgICAgICAgICAgICAgMA5MFuV+GrdUsdsAAAAAElFTkSuQmCC";
const BLUE_SHA256 = "e5df67a569b79908323d8ea1b5fe510996c51aa27261d01156dd449879a80342";

const sha256 = (bytes: Uint8Array | Buffer) =>
  createHash("sha256").update(bytes).digest("hex");

const MAIN_TEX = `\\documentclass{beamer}
\\usepackage{graphicx}
\\begin{document}
\\begin{frame}{Figures}
  \\includegraphics[width=0.3\\textwidth]{logo.png}
  \\includegraphics[width=0.3\\textwidth]{images/ch1/fig.png}
\\end{frame}
\\end{document}
`;

const REFS_BIB = `@book{knuth1984,
  author  = {Knuth, Donald E.},
  title   = {The TeXbook},
  year    = {1984},
}
`;

async function buildFixtureZip(): Promise<JSZip> {
  const zip = new JSZip();
  zip.file("main.tex", MAIN_TEX);
  zip.file("logo.png", RED_B64, { base64: true });
  zip.file("images/ch1/fig.png", BLUE_B64, { base64: true });
  zip.file("refs.bib", REFS_BIB);
  return zip;
}

describe("LaTeX figure byte-identity regression (zip → decode)", () => {
  it("keeps every image byte-identical through import and server decode", async () => {
    const zip = await buildFixtureZip();
    const expected: Record<string, string> = {
      "logo.png": RED_SHA256,
      "images/ch1/fig.png": BLUE_SHA256,
    };

    for (const [path, want] of Object.entries(expected)) {
      const raw = await zip.file(path)!.async("arraybuffer");
      // The bytes stored in the zip are the source of truth.
      expect(sha256(Buffer.from(raw))).toBe(want);

      const b64 = Buffer.from(raw).toString("base64");

      // Raster images travel as a data: URL after client-side import.
      const dataUrl = `data:image/png;base64,${b64}`;
      expect(stripDataUrlPrefix(dataUrl)).toBe(b64);
      expect(sha256(decodeAssetContent(path, dataUrl))).toBe(want);

      // PDF figures travel as plain base64 (no prefix).
      expect(sha256(decodeAssetContent(path, b64))).toBe(want);
    }
  });

  it("decodes the data: URL without shifting bytes (the prefix corruption bug)", () => {
    const raw = Buffer.from(RED_B64, "base64");
    const dataUrl = `data:image/png;base64,${RED_B64}`;

    // Decoding WITHOUT stripping the prefix corrupts the bytes: the data:
    // characters are themselves valid base64, so every byte shifts.
    const corrupt = Buffer.from(dataUrl, "base64");
    expect(sha256(corrupt)).not.toBe(RED_SHA256);

    // The fixed path restores the exact bytes.
    expect(sha256(decodeAssetContent("logo.png", dataUrl))).toBe(RED_SHA256);
    expect(sha256(raw)).toBe(RED_SHA256);
  });

  it("reports a Beamer first pass without flagging .nav/.toc/.snm/.out", () => {
    const log = [
      "No file main.nav.",
      "No file main.toc.",
      "No file main.snm.",
      "No file main.out.",
      "Missing input file 'logo.png'",
    ];
    expect(diagnoseMissingFigures(log)).toEqual(["logo.png"]);
  });
});
