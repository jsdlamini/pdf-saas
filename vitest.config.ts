import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    // Unit tests use *.test.ts; Playwright E2E tests use *.spec.ts and run
    // under @playwright/test, so vitest must not pick them up.
    include: ["**/*.test.ts"],
  },
});