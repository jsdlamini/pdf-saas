import { expect, test } from "@playwright/test";
import { clerkSetup, clerk } from "@clerk/testing/playwright";
import { createClerkClient } from "@clerk/backend";
import { join } from "node:path";

// Signed-in folder-upload test. Requires:
//   - .env.local with CLERK_SECRET_KEY + NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
//     (a Clerk DEVELOPMENT instance — test mode)
//   - a local Postgres (DATABASE_URL) and PROJECT_ASSETS_DIR pointing at a
//     writable dir (both set in .env.local)
//   - `npm run dev` running (playwright's webServer starts it)
// The test creates a throwaway user in the dev instance and signs in via a
// Clerk test ticket — no password, no real account.

const TEST_EMAIL = "wiserfiles-e2e@example.com";

test.beforeAll(async () => {
  await clerkSetup();
  const client = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY! });
  const existing = await client.users.getUserList({ emailAddress: [TEST_EMAIL] });
  if (!existing.data?.length) {
    // The dev instance requires a password on user creation.
    await client.users.createUser({
      emailAddress: [TEST_EMAIL],
      password: "WiserfilesE2E123!",
    });
  }
});

test("right-click upload lands a PNG at the correct path", async ({ page }) => {
  // Skip the onboarding overlay so it doesn't intercept clicks.
  await page.addInitScript(() => {
    localStorage.setItem("wiserfiles-onboarding-seen", "1");
  });

  // Sign in via a Clerk test ticket (email-based, no password).
  await page.goto("/");
  await clerk.signIn({ page, emailAddress: TEST_EMAIL });
  await page.goto("/research-studio", { waitUntil: "networkidle" });

  // Create a blank project so there is an editor and a tree.
  await page.getByRole("button", { name: /New Project/i }).first().click();
  const nameInput = page.locator("#swal-project-name");
  if (await nameInput.count()) await nameInput.fill("Upload E2E");
  await page.getByRole("button", { name: "Create" }).click();
  await page.locator(".cm-content").first().waitFor({ state: "visible", timeout: 30_000 });

  // Right-click the editor surface → the project-root context menu.
  await page.locator(".studio-editor-area").click({ button: "right" });

  // Choose "Upload file"; the native file picker opens.
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByRole("menuitem", { name: "Upload file" }).click(),
  ]);
  await chooser.setFiles(join(process.cwd(), "tests/fixtures/upload-logo.png"));

  // The file lands at the project root (the empty folder = bare filename).
  await expect(page.getByText("upload-logo.png", { exact: true })).toBeVisible();
});
