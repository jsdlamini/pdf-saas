import { expect, test } from "@playwright/test";

// ---------------------------------------------------------------------------
// SKIPPED — needs a real signed-in Clerk session, which is not available
// overnight (no staging, no Cloudflare bypass, no test account).
//
// To unskip in the morning, provision:
//   - a Clerk test-mode instance (or test user) with E2E credentials, and
//   - either a Cloudflare bypass for the deployed app, or run against the local
//     dev server with `CLERK_SECRET_KEY` + `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`.
// Then replace the sign-in step below with the real Clerk login (or a test
// session token) and drop the `test.skip`.
// ---------------------------------------------------------------------------

test.skip("folder context menu: Upload file lands a PNG at the correct path", async ({ page }) => {
  // 1. Sign in (Clerk) — needs E2E test credentials.
  //    await page.goto("/research-studio");
  //    await page.getByRole("button", { name: "Sign in" }).click();
  //    ... complete Clerk login ...

  // 2. Open an existing project (or import one).
  //    await page.getByRole("button", { name: "CSC111" }).click();

  // 3. Right-click a folder, choose "Upload file", pick a PNG.
  //    await page.getByText("images", { exact: true }).click({ button: "right" });
  //    await page.getByRole("menuitem", { name: "Upload file" }).click();
  //    await page.locator('input[type="file"]').setInputFiles("tests/baseline/fixtures/logo.png");

  // 4. Assert the file landed in the tree at the joined path.
  //    await expect(page.getByText("images/ch1/logo.png")).toBeVisible();
  expect(true).toBe(true);
});
