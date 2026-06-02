import { expect, test } from "@playwright/test";

const routes = [
  { path: "/chat", heading: "Chat" },
  { path: "/documents", heading: "Documents" },
  { path: "/settings/billing-or-usage", heading: "Billing & Usage" },
];

for (const route of routes) {
  test(`${route.path} renders without console errors`, async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));

    await page.goto(route.path);
    await expect(page.getByRole("heading", { name: route.heading }).first()).toBeVisible();

    expect(errors).toEqual([]);
  });
}

test("usage page displays quota fallbacks when backend omits quota payload", async ({ page }) => {
  await page.route("**/api/v1/analytics/summary", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        total_queries: 0,
        total_documents: 0,
        total_chunks: 0,
        avg_response_time: 0,
        avg_confidence: 0,
        queries_today: 0,
        cache_hits: 0,
        cache_misses: 0,
        cache_entries: 0,
        llm_model_name: "gemini-2.5-flash",
        embedding_model: "test",
        llm_total_tokens: 0,
        usage_tokens_today: 0,
      }),
    });
  });

  await page.goto("/settings/billing-or-usage");

  await expect(page.getByText("0 / 1,000")).toBeVisible();
  await expect(page.getByText("0 / 100")).toBeVisible();
  await expect(page.getByText("0 B / 1.0 GB")).toBeVisible();
});
