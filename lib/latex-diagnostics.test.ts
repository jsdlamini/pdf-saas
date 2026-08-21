import { describe, expect, it } from "vitest";
import {
  decodeAssetContent,
  diagnoseLatexErrors,
  diagnoseMissingFigures,
  isBinaryAssetName,
  looksLikeBase64,
  stripDataUrlPrefix,
  validMagicBytes,
} from "./latex-diagnostics";

describe("isBinaryAssetName", () => {
  it("flags raster + PDF figures as binary", () => {
    for (const p of ["a.png", "b.jpg", "c.jpeg", "d.gif", "e.bmp", "f.webp", "g.ico", "h.pdf"]) {
      expect(isBinaryAssetName(p)).toBe(true);
    }
  });

  it("does not flag text graphics or source", () => {
    for (const p of ["a.svg", "b.eps", "c.tex", "d.bib", "e.png.tex"]) {
      expect(isBinaryAssetName(p)).toBe(false);
    }
  });
});

describe("looksLikeBase64", () => {
  it("detects base64 runs", () => {
    expect(looksLikeBase64("aGVsbG8gd29ybGQ=")).toBe(true);
    expect(looksLikeBase64("iVBORw0KGgoAAAANSUhEUg==")).toBe(true);
  });

  it("treats XML/SVG as text", () => {
    expect(looksLikeBase64('<svg xmlns="http://www.w3.org/2000/svg"></svg>')).toBe(false);
    expect(looksLikeBase64('<?xml version="1.0"?>')).toBe(false);
  });

  it("treats PostScript/EPS as text", () => {
    expect(looksLikeBase64("%!PS-Adobe-3.0 EPSF-3.0")).toBe(false);
  });

  it("treats empty content as text", () => {
    expect(looksLikeBase64("")).toBe(false);
  });
});

describe("diagnoseLatexErrors", () => {
  it("extracts file:line and bang-form errors, deduped and capped", () => {
    const log = [
      "No file CH1.nav.",
      "./CH1.tex:187: Package fontawesome5 Error: The requested icon shield was not found.",
      "! Package fontawesome5 Error: The requested icon shield was not found.",
      "./CH1.tex:389: LaTeX Error: Environment timeline undefined.",
      "LaTeX Font Info: Trying to load font information",
    ].join("\n");
    const errors = diagnoseLatexErrors(log);
    expect(errors).toContain("Package fontawesome5 Error: The requested icon shield was not found.");
    expect(errors).toContain("LaTeX Error: Environment timeline undefined.");
    // The bang form and file:line form of the same error collapse to one entry.
    expect(errors.filter((e) => e.includes("shield")).length).toBe(1);
    expect(errors.some((e) => e.includes("nav"))).toBe(false);
  });
});

describe("diagnoseMissingFigures", () => {
  it("extracts missing input files and File-not-found refs", () => {
    const details = [
      "Latexmk: Missing input file 'images/ch1/computer_programming.png' (or dependence on it)",
      "LaTeX Warning: File `images/ch1/cs_overview.png' not found on input line 159.",
    ];
    const missing = diagnoseMissingFigures(details);
    expect(missing).toContain("images/ch1/computer_programming.png");
    expect(missing).toContain("images/ch1/cs_overview.png");
  });

  it("never reports generated aux files (.nav, .aux, .toc, .out, .snm, .bbl)", () => {
    const details = [
      "No file CH1.nav.",
      "No file CH1.toc.",
      "Missing input file 'CH1.aux'",
      "Missing input file 'CH1.out'",
      "Missing input file 'CH1.snm'",
      "Missing input file 'CH1.bbl'",
      "Missing input file 'images/ch1/foo.png'",
    ];
    expect(diagnoseMissingFigures(details)).toEqual(["images/ch1/foo.png"]);
  });

  it("deduplicates repeated refs", () => {
    const details = [
      "Missing input file 'a.png'",
      "Missing input file 'a.png'",
    ];
    expect(diagnoseMissingFigures(details)).toEqual(["a.png"]);
  });

  it("ignores a literal 100\\% width warning before a ref", () => {
    const details = [
      "Overfull \\hbox (10pt too wide) in paragraph at lines 5--6",
      "LaTeX Warning: File `fig.png' not found on input line 10.",
    ];
    const missing = diagnoseMissingFigures(details);
    expect(missing).toEqual(["fig.png"]);
    expect(missing).not.toContain("hbox");
  });

  it("handles paths with spaces", () => {
    const details = ["Missing input file 'images/ch1/my figure.png'"];
    expect(diagnoseMissingFigures(details)).toEqual(["images/ch1/my figure.png"]);
  });
});

describe("stripDataUrlPrefix", () => {
  it("strips a data: URL prefix", () => {
    expect(stripDataUrlPrefix("data:image/png;base64,iVBORw0KGgo=")).toBe("iVBORw0KGgo=");
  });

  it("passes plain base64 through untouched", () => {
    expect(stripDataUrlPrefix("iVBORw0KGgo=")).toBe("iVBORw0KGgo=");
  });
});

describe("decodeAssetContent (byte-identity)", () => {
  // A minimal but valid PNG (1x1 transparent).
  const PNG_BYTES = Buffer.from(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6260000000010000030000050001ab85a3fc0000000049454e44ae426082",
    "hex"
  );

  it("round-trips base64 back to the original bytes", () => {
    const decoded = decodeAssetContent("a.png", PNG_BYTES.toString("base64"));
    expect(decoded.equals(PNG_BYTES)).toBe(true);
  });

  it("round-trips a data: URL back to the original bytes", () => {
    const decoded = decodeAssetContent("a.png", `data:image/png;base64,${PNG_BYTES.toString("base64")}`);
    expect(decoded.equals(PNG_BYTES)).toBe(true);
  });

  it("rejects a corrupt image (wrong magic)", () => {
    const junk = Buffer.from("not a png at all, just ascii text padding", "utf8").toString("base64");
    expect(() => decodeAssetContent("a.png", junk)).toThrow(/Corrupt image/);
  });
});

describe("validMagicBytes", () => {
  it("accepts PNG/JPEG/GIF/PDF signatures", () => {
    expect(validMagicBytes("a.png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0]))).toBe(true);
    expect(validMagicBytes("a.jpg", Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBe(true);
    expect(validMagicBytes("a.gif", Buffer.from("GIF89a..."))).toBe(true);
    expect(validMagicBytes("a.pdf", Buffer.from("%PDF-1.7"))).toBe(true);
  });

  it("rejects a wrong PNG signature", () => {
    expect(validMagicBytes("a.png", Buffer.from("data:image/png"))).toBe(false);
  });
});
