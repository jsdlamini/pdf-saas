import { describe, expect, it } from "vitest";
import { BUTTON_KEYS, BUTTON_LABELS, DEFAULT_BUTTON_CONFIG } from "./studio-buttons";

describe("studio button config", () => {
  it("registers the whole-class assess button", () => {
    expect(BUTTON_KEYS).toContain("assessClass");
    expect(BUTTON_LABELS.assessClass).toBe("Assess whole class");
  });

  it("defaults assessClass to admin-only", () => {
    expect(DEFAULT_BUTTON_CONFIG.admin.assessClass).toBe(true);
    expect(DEFAULT_BUTTON_CONFIG.assistant.assessClass).toBe(false);
    expect(DEFAULT_BUTTON_CONFIG.user.assessClass).toBe(false);
  });

  it("every key has a label and a default for every role", () => {
    for (const key of BUTTON_KEYS) {
      expect(BUTTON_LABELS[key]).toBeTruthy();
      expect(DEFAULT_BUTTON_CONFIG.user[key]).toBeDefined();
      expect(DEFAULT_BUTTON_CONFIG.assistant[key]).toBeDefined();
      expect(DEFAULT_BUTTON_CONFIG.admin[key]).toBeDefined();
    }
  });
});
