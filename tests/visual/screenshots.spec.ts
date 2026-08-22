import { expect, test } from "@playwright/test";

// Visual pass: screenshot every public route at 375px + 1440px, light and dark,
// committed so the palette/type rollout can be reviewed in one pass. Signed-in
// routes (research-studio, dashboard) are covered by the Clerk-ticket setup in
// studio-upload.spec.ts; add them here once the harness is extended.

const ROUTES = [
  "/",
  "/tools/merge-pdf",
  "/tools/pdf-to-word",
  "/faq",
  "/privacy",
  "/terms",
];

const WIDTHS = [375, 1440];
const THEMES = ["light", "dark"] as const;

for (const route of ROUTES) {
  const slug = route === "/" ? "home" : route.replace(/\//g, "-").replace(/^-/, "");
  test(`${route} screenshots (light/dark, mobile/desktop)`, async ({ page }) => {
    for (const width of WIDTHS) {
      for (const theme of THEMES) {
        await page.setViewportSize({ width, height: 900 });
        await page.addInitScript((t) => {
          document.documentElement.setAttribute("data-theme", t);
        }, theme);
        await page.goto(route, { waitUntil: "load" });
        // Give self-hosted fonts a beat to apply before the shot.
        await page.waitForTimeout(400);
        // No horizontal overflow at mobile is a hard requirement.
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth
        );
        expect(overflow, `${route} @ ${width}px overflows horizontally by ${overflow}px`).toBeLessThanOrEqual(0);
        await page.screenshot({
          path: `tests/visual/screenshots/${slug}-${width}-${theme}.png`,
          fullPage: false,
        });
      }
    }
  });
}
