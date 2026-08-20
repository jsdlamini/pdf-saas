import { describe, expect, it } from "vitest";
import { texLogDiagnostics } from "./tex-lint";

describe("texLogDiagnostics", () => {
  it("parses a LaTeX error with its l.<line> marker", () => {
    const log = [
      "This is pdfTeX, Version 3.141592653-2.6-1.40.26",
      "! Undefined control sequence.",
      "l.42 \\badcommand",
      "? ",
    ].join("\n");

    const issues = texLogDiagnostics(log);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ line: 42, severity: "error" });
    expect(issues[0].message).toContain("Undefined control sequence");
  });

  it("separates errors from warnings", () => {
    const log = [
      "! Missing $ inserted.",
      "l.10 x = ",
      "LaTeX Warning: Reference `foo' on page 1 undefined on input line 10.",
      "Overfull \\hbox (10pt too wide) in paragraph at lines 5--6",
    ].join("\n");

    const issues = texLogDiagnostics(log);
    const errors = issues.filter((i) => i.severity === "error");
    const warnings = issues.filter((i) => i.severity === "warning");
    expect(errors).toHaveLength(1);
    expect(warnings.length).toBeGreaterThanOrEqual(1);
  });

  it("returns no issues for a clean log", () => {
    const log = [
      "Output written on main.pdf (1 page, 1234 bytes).",
      "Transcript written on main.log.",
    ].join("\n");
    expect(texLogDiagnostics(log)).toHaveLength(0);
  });
});
