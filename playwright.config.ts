import { defineConfig } from "@playwright/test";
import { config as loadEnv } from "dotenv";

// Load .env.local so the test process has CLERK_SECRET_KEY and the Clerk
// publishable key for @clerk/testing (clerkSetup + clerk.signIn).
loadEnv({ path: ".env.local" });
loadEnv();

export default defineConfig({
  testDir: "./tests",
  testMatch: /.*\.spec\.ts/,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: 1,
  use: {
    // localhost (not 127.0.0.1): the Next.js dev middleware proxy targets
    // localhost, and binding the server to 127.0.0.1 makes that proxy fail
    // with a socket-hang-up on IPv6.
    baseURL: process.env.BASE_URL || "http://localhost:3000",
    headless: true,
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
