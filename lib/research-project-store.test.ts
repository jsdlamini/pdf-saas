import { describe, expect, it } from "vitest";
import { parseStoredResearchProject } from "./research-project-store";

const baseProject = {
  id: "p1",
  name: "Report",
  entries: [{ path: "main.tex", kind: "file", content: "\\documentclass{article}" }],
  selectedPath: "main.tex",
  lastCompileAt: "Not compiled yet",
  updatedAt: "2024-01-01T00:00:00.000Z",
};

describe("parseStoredResearchProject", () => {
  it("preserves a numeric courseId", () => {
    const parsed = parseStoredResearchProject({ ...baseProject, courseId: 7 });
    expect(parsed?.courseId).toBe(7);
  });

  it("defaults courseId to null when absent or invalid", () => {
    const absent = parseStoredResearchProject(baseProject);
    expect(absent?.courseId).toBe(null);

    const invalid = parseStoredResearchProject({ ...baseProject, courseId: "7" });
    expect(invalid?.courseId).toBe(null);
  });
});
