import { expect, test } from "@playwright/test";

test.skip(!process.env.E2E_SUMMARY_COMPONENT_FIXTURE, "Requires the isolated production chat component and synthetic transport, not hosted users or the system clipboard.");
for (const theme of ["light", "dark"]) test(`${theme}: retain the returned answer through copy failure, pending output and explicit retry`, async ({ page }, testInfo) => {
  const errors: string[] = [], submissions: unknown[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { if (request.url().endsWith("/api/v1/chat") && request.method() === "POST") submissions.push(request.postDataJSON()); });
  await page.addInitScript(() => { Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
    writeText: async () => { throw new Error("Synthetic ordinary clipboard rejection"); },
  } }); });
  await page.goto(`/?theme=${theme}`);
  await page.getByRole("button", { name: "Selected", exact: true }).click();
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await page.getByRole("checkbox", { name: "Resume.txt", exact: true }).uncheck();
  await page.getByRole("checkbox", { name: "Cover_Letter.txt", exact: true }).check();
  await page.getByRole("button", { name: "Close filters" }).click();
  await page.getByRole("textbox", { name: "Chat message" }).fill("Summarize the cover letter");
  await page.getByRole("checkbox", { name: /This question contains no/ }).check();
  const response = page.waitForResponse(value => value.url().endsWith("/api/v1/chat") && value.request().method() === "POST" && value.status() === 200);
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  const expected = (await (await response).json()).answer as string;
  expect(expected).toContain("[S1]");
  const copy = page.getByRole("button", { name: "Copy response to clipboard" });
  await expect(copy).toBeEnabled(); await copy.focus();
  if (theme === "dark") await page.evaluate(() => { Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined }); });
  await copy.click();
  await expect(page.getByRole("alert")).toHaveText("The clipboard was unavailable.");
  await expect(page.getByText("This application describes laboratory collaboration and research plans.", { exact: false }).first()).toBeVisible();
  await page.evaluate(() => {
    const state = window as unknown as { syntheticWriteAttempts: number; finishSyntheticCopy: () => void; syntheticCopiedText: string };
    state.syntheticWriteAttempts = 0;
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
      writeText: (text: string) => { state.syntheticWriteAttempts++; return new Promise<void>(resolve => {
        state.finishSyntheticCopy = () => { state.syntheticCopiedText = text; resolve(); };
      }); },
    } });
  });
  await copy.click();
  await expect(copy).toBeDisabled(); await expect(copy).toHaveAttribute("aria-busy", "true");
  await expect(copy).toHaveText("Copying...");
  expect(await page.evaluate(() => (window as unknown as { syntheticWriteAttempts: number }).syntheticWriteAttempts)).toBe(1);
  await page.evaluate(() => (window as unknown as { finishSyntheticCopy: () => void }).finishSyntheticCopy());
  await expect(copy).toBeEnabled(); await expect(copy).toHaveText("Copied");
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { syntheticCopiedText: string }).syntheticCopiedText)).toBe(expected);
  expect(submissions).toHaveLength(1); expect(errors).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath(`chat-copy-${theme}.png`), fullPage: true });
});
