import { describe, it, expect } from "vitest";
import {
  escapeHtml,
  highlightLatexSource,
  highlightPythonSource,
  highlightCppSource,
  highlightCodeSource,
} from "./highlighters";

describe("escapeHtml", () => {
  it("escapes HTML special characters", () => {
    expect(escapeHtml("<>&\"'")).toBe("&lt;&gt;&amp;&quot;&#39;");
  });

  it("leaves plain text unchanged", () => {
    expect(escapeHtml("hello world")).toBe("hello world");
  });
});

describe("highlightLatexSource", () => {
  it("wraps LaTeX commands in a span", () => {
    const out = highlightLatexSource("\\documentclass{article}");
    expect(out).toContain("studio-hl-cmd");
    expect(out).toContain("documentclass");
  });

  it("escapes HTML in source", () => {
    const out = highlightLatexSource("<hello>");
    expect(out).toContain("&lt;hello&gt;");
  });
});

describe("highlightPythonSource", () => {
  it("highlights keywords", () => {
    const out = highlightPythonSource("def main(): return None");
    expect(out).toContain("studio-hl-kw");
    expect(out).toContain("def");
  });

  it("highlights comments", () => {
    const out = highlightPythonSource("# a comment");
    expect(out).toContain("studio-hl-cmt");
  });

  it("does not corrupt HTML with nested spans", () => {
    const out = highlightPythonSource("print('hello')");
    // must not contain the literal string 'class=' from a broken span
    expect(out).not.toContain('class="class');
  });
});

describe("highlightCppSource", () => {
  it("highlights preprocessor directives", () => {
    const out = highlightCppSource("#include <iostream>");
    expect(out).toContain("studio-hl-pp");
  });

  it("escapes angle brackets", () => {
    const out = highlightCppSource("#include <vector>");
    expect(out).toContain("&lt;vector&gt;");
  });

  it("does not corrupt HTML", () => {
    const out = highlightCppSource("int main() { return 0; }");
    expect(out).not.toContain('class="class');
  });
});

describe("highlightCodeSource", () => {
  it("dispatches to the right highlighter by mode", () => {
    expect(highlightCodeSource("def x(): pass", "python")).toContain("studio-hl-kw");
    expect(highlightCodeSource("#include <iostream>", "cpp")).toContain("studio-hl-pp");
    expect(highlightCodeSource("\\section{Hi}", "latex")).toContain("studio-hl-cmd");
  });
});
