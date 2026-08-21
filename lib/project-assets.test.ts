import { describe, expect, it } from "vitest";
import { mergeAssetContents, unrecoverableAssetPaths } from "./project-assets";

describe("mergeAssetContents (rehydration)", () => {
  it("fills empty image content from stored files keyed by path", () => {
    const entries = [
      { path: "main.tex", kind: "file", content: "\\documentclass{article}" },
      { path: "logo.png", kind: "file", content: "" },
      { path: "images/ch1/fig.png", kind: "file", content: "" },
    ];
    const files = [
      { path: "logo.png", content: "AA==" },
      { path: "images/ch1/fig.png", content: "BB==" },
    ];
    const merged = mergeAssetContents(entries, files);
    expect(merged.find((e) => e.path === "logo.png")?.content).toBe("AA==");
    expect(merged.find((e) => e.path === "images/ch1/fig.png")?.content).toBe("BB==");
    expect(merged.find((e) => e.path === "main.tex")?.content).toBe("\\documentclass{article}");
  });

  it("leaves text entries and unrecoverable images untouched", () => {
    const entries = [
      { path: "main.tex", kind: "file", content: "x" },
      { path: "missing.png", kind: "file", content: "" },
    ];
    const merged = mergeAssetContents(entries, []);
    expect(merged.find((e) => e.path === "missing.png")?.content).toBe("");
  });

  it("does not overwrite an image that already has content", () => {
    const entries = [{ path: "logo.png", kind: "file", content: "already" }];
    const merged = mergeAssetContents(entries, [{ path: "logo.png", content: "new" }]);
    expect(merged[0].content).toBe("new");
  });
});

describe("unrecoverableAssetPaths", () => {
  it("lists image paths that remain empty", () => {
    const entries = [
      { path: "a.png", kind: "file", content: "" },
      { path: "b.png", kind: "file", content: "x" },
      { path: "c.tex", kind: "file", content: "" },
    ];
    expect(unrecoverableAssetPaths(entries)).toEqual(["a.png"]);
  });
});
