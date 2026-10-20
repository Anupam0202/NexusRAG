import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import type { ResearchRun } from "../lib/research-run";

test.skip(!process.env.E2E_RESEARCH_COMPONENT_FIXTURE, "Requires isolated UI/Gateway/queue/provider peers, not hosted users or the system clipboard.");
const fields = { COMPARE: "comparison", TIMELINE: "timeline", CONTRADICTION_ANALYSIS: "contradiction", DEEP_RESEARCH: "deep" } as const;
for (const theme of ["light", "dark"]) for (const mode of Object.keys(fields) as Array<keyof typeof fields>) {
  test(`${theme}: copy the complete saved ${mode} record after reload`, async ({ page }, testInfo) => {
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    let completed: ResearchRun | undefined, capturing = false;
    const recordErrors: string[] = [];
    page.on("response", async response => {
      if (!capturing || !/\/api\/v2\/research\/plans\/[^/]+\/runs\/[^/?]+(?:\?|$)/.test(response.url()) || response.status() !== 200) return;
      try { const value = await response.json(); if (value.state === "completed" && value.results?.length) completed = value; }
      catch (error) { recordErrors.push(error instanceof Error ? error.message : "Saved run JSON was unavailable."); }
    });
    const rejectOnce = mode === "COMPARE" && theme === "light";
    await page.addInitScript(({ rejectOnce }) => {
      let rejected = false;
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
        writeText: async (text: string) => {
          if (rejectOnce && !rejected) { rejected = true; throw new Error("Synthetic ordinary clipboard rejection"); }
          (window as unknown as { syntheticCopiedText: string }).syntheticCopiedText = text;
        },
      } });
    }, { rejectOnce });
    const question = `Synthetic copied mass context ${randomUUID()}`;
    await page.goto(`/?actor=${randomUUID()}&theme=${theme}`);
    await page.getByRole("combobox", { name: "Mode", exact: true }).selectOption(mode);
    await page.getByRole("textbox", { name: "Question", exact: true }).fill(question);
    await page.getByRole("textbox", { name: "Completion criteria", exact: true }).fill("Review original evidence, complete saved scope and copied limitations.");
    await page.getByRole("checkbox", { name: "Synthetic policy.txt", exact: true }).check();
    await page.getByRole("checkbox", { name: "Synthetic second policy.txt", exact: true }).check();
    await page.getByRole("button", { name: "Save plan", exact: true }).click();
    await page.getByRole("checkbox", { name: /I confirm that all questions/ }).check();
    await page.getByRole("button", { name: "Start research", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Execution finished" })).toContainText("1 of 1");
    await page.reload();
    await page.getByRole("button", { name: `Open research plan: ${question}`, exact: true }).click();
    completed = undefined; capturing = true;
    await page.getByRole("button", { name: /Open execution/ }).click();
    await expect(page.getByRole("button", { name: "Copy results", exact: true })).toBeEnabled();
    await expect.poll(() => completed?.state).toBe("completed");
    const result = completed!.results[0], structure = result[fields[mode]];
    expect(structure).toBeDefined();
    if (mode === "COMPARE" && theme === "dark") {
      await page.evaluate(() => { Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined }); });
      await page.getByRole("button", { name: "Copy results", exact: true }).click();
      await expect(page.getByRole("alert")).toContainText("The clipboard was unavailable.");
      await page.evaluate(() => { Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
        writeText: async (text: string) => { (window as unknown as { syntheticCopiedText: string }).syntheticCopiedText = text; },
      } }); });
    }
    if (rejectOnce) {
      await page.getByRole("button", { name: "Copy results", exact: true }).click();
      await expect(page.getByRole("alert")).toContainText("The clipboard was unavailable.");
    }
    await page.getByRole("button", { name: "Copy results", exact: true }).click();
    await expect(page.getByRole("button", { name: "Copied", exact: true })).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
    const copied = await page.evaluate(() => (window as unknown as { syntheticCopiedText: string }).syntheticCopiedText);
    expect(copied).toContain(question); expect(copied).toContain(JSON.stringify(structure, null, 2));
    for (const source of result.sources) expect(copied).toContain(source.original_content_hash);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(recordErrors).toEqual([]); expect(errors).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`saved-${mode}-${theme}-copied.png`), fullPage: true });
  });
}
