import { expect, test } from "@playwright/test";

const pages = [
  { name: "home", path: "/" },
  { name: "evidence-os", path: "/evidence-os" },
] as const;

for (const target of pages) {
  test(`${target.name} visual baseline`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(target.path, { waitUntil: "networkidle" });
    if (target.name === "home") {
      // Signed out: the page asks the visitor to sign in, with nothing to attest before a question can be sent.
      await expect(page.getByRole("link", { name: "Sign in" }).first()).toBeVisible();
      await expect(
        page.getByRole("checkbox", {
          name: /This question contains no personal, confidential, regulated, or other sensitive information/i,
        })
      ).toHaveCount(0);
    }
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
