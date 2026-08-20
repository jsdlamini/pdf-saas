import { describe, expect, it } from "vitest";
import { TOOL_ITEMS, type ToolProcessing } from "./tools";

const VALID_PROCESSING: ToolProcessing[] = ["local", "server", "conditional"];

describe("TOOL_ITEMS registry", () => {
  it("is non-empty and every tool has a processing field", () => {
    expect(TOOL_ITEMS.length).toBeGreaterThan(0);
    for (const tool of TOOL_ITEMS) {
      expect(
        tool.processing,
        `${tool.slug} is missing a processing field`
      ).toBeDefined();
    }
  });

  it("every processing field is 'local', 'server', or 'conditional'", () => {
    for (const tool of TOOL_ITEMS) {
      expect(
        VALID_PROCESSING,
        `${tool.slug} has invalid processing: ${String(tool.processing)}`
      ).toContain(tool.processing);
    }
  });
});
