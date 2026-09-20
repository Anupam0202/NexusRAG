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
      maxDiffPixelRatio: 0.005,
      scale: "css",
    });
  });
}