import { describe, expect, it } from "vitest";
import { classifyUpload, joinUploadPath, sanitizeUploadName } from "./project-upload";

describe("sanitizeUploadName", () => {
  it("replaces characters outside the safe set with underscores", () => {
    expect(sanitizeUploadName("my figure (1).png")).toBe("my_figure__1_.png");
  });
});

describe("joinUploadPath", () => {
  it("joins a folder with a trailing slash", () => {
    expect(joinUploadPath("images/ch1/", "logo.png")).toBe("images/ch1/logo.png");
  });
  it("joins a folder without a trailing slash", () => {
    expect(joinUploadPath("images/ch1", "logo.png")).toBe("images/ch1/logo.png");
  });
  it("yields just the file name for the project root", () => {
    expect(joinUploadPath("", "UNESWA_logo.png")).toBe("UNESWA_logo.png");
  });
  it("treats a bare slash as root", () => {
    expect(joinUploadPath("/", "a.png")).toBe("a.png");
  });
});

describe("classifyUpload", () => {
  it("classifies raster images, PDFs, and text", () => {
    expect(classifyUpload("a.png")).toBe("image");
    expect(classifyUpload("a.JPG")).toBe("image");
    expect(classifyUpload("a.pdf")).toBe("pdf");
    expect(classifyUpload("main.tex")).toBe("text");
    expect(classifyUpload("refs.bib")).toBe("text");
  });
});
