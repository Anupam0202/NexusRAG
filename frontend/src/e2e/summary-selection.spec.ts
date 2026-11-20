import { expect, test } from "@playwright/test";

test.skip(!process.env.E2E_SUMMARY_COMPONENT_FIXTURE, "Requires the isolated synthetic component transport, not a hosted origin.");

for (const theme of ["light", "dark"]) test(`${theme}: summary selection recovery requires deliberate selection, preserves a new draft, and exposes exact source text`, async ({ page }, testInfo) => {
  const errors: string[] = [];
  const submissions: Record<string, unknown>[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => {
    if (request.url().endsWith("/api/v1/chat") && request.method() === "POST") submissions.push(request.postDataJSON());
  });
  await page.goto(`/?theme=${theme}`);
  const input = page.getByRole("textbox", { name: "Chat message" });
  const attestation = page.getByRole("checkbox", { name: /This question contains no/ });
  const send = page.getByRole("button", { name: "Send message", exact: true });
  await input.waitFor({ state: "visible", timeout: 15000 }).catch(() => {
    throw new Error(`Chat component did not render; page errors: ${JSON.stringify(errors)}`);
  });
  await input.fill("Summarize this document");
  await attestation.check();
  await send.click();
  await expect(page.getByRole("button", { name: "Choose summary documents" })).toBeVisible();
  expect(submissions).toHaveLength(1);
  await input.fill("A new draft");
  await page.getByRole("button", { name: "Choose summary documents" }).click();
  await expect(input).toHaveValue("A new draft");
  await expect(input).toBeFocused();
  await expect(page.getByRole("checkbox", { name: "Cover_Letter.txt", exact: true })).toBeVisible();
  await expect(send).toBeDisabled();
  expect(submissions).toHaveLength(1);
  await input.fill("");
  await page.getByRole("button", { name: "Choose summary documents" }).click();
  await expect(input).toHaveValue("Summarize this document");
  await page.getByRole("checkbox", { name: "Cover_Letter.txt", exact: true }).check();
  await attestation.check();
  await page.getByRole("button", { name: "Close filters" }).click();
  await send.click();
  await expect(page.getByText("This application describes laboratory collaboration and research plans.", { exact: false }).first()).toBeVisible();
  expect(submissions).toHaveLength(2);
  expect(submissions[1].chat_scope).toBe("documents");
  expect(submissions[1].document_ids).toEqual(["60606060-6060-4060-8060-606060606060"]);
  await expect(page.getByRole("button", { name: "Choose summary documents" })).toHaveCount(0);
  await page.getByRole("button", { name: "1 sources" }).click();
  const sources = page.getByRole("region", { name: "Response sources" });
  await expect(sources.getByText("Cover_Letter.txt", { exact: true })).toBeVisible();
  await expect(sources.getByText(/Dear hiring team/)).toBeVisible();
  await expect(sources.getByText("Resume.txt")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  for (const control of [input, send]) {
    const bounds = await control.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  }
  expect(errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("summary-selection.png"), fullPage: true });
});
