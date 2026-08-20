import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: /.*\.spec\.ts/,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: 1,
  use: {
    // Use a numeric host to avoid localhost/IPv6 DNS resolution quirks in CI.
    baseURL: process.env.BASE_URL || "http://127.0.0.1:3000",
    headless: true,
  },
  webServer: {
    command: "npm run dev -- -H 127.0.0.1",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
