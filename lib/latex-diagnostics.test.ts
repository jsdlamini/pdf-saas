import { describe, expect, it } from "vitest";
import {
  diagnoseMissingFigures,
  isBinaryAssetName,
  looksLikeBase64,
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
