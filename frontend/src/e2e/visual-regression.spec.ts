import { expect, test } from "@playwright/test";

const pages = [
  { name: "home", path: "/" },
  { name: "evidence-os", path: "/evidence-os" },
] as const;

for (const target of pages) {
  test(`${target.name} visual baseline`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(target.path, { waitUntil: "networkidle" });
    await expect(page).toHaveScreenshot(`${target.name}.png`, {
      animations: "disabled",
      caret: "hide",
      fullPage: true,
      // Chromium uses the same bundled Inter files in preview and CI, but
      // Linux rasterizers can differ slightly at glyph edges.
      threshold: 0.35,
      maxDiffPixelRatio: 0.03,
      scale: "css",
    });
  });
}