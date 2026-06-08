import { expect, test } from "@playwright/test";

const routes = [
  { path: "/auth/login", heading: "Sign in to NexusRAG" },
  { path: "/auth/signup", heading: "Create a NexusRAG account" },
  { path: "/auth/forgot-password", heading: "Reset your password" },
  { path: "/auth/update-password", heading: "Update Password" },
  { path: "/chat", heading: "Chat" },
  { path: "/documents", heading: "Documents" },
  { path: "/settings/billing-or-usage", heading: "Billing & Usage" },
  { path: "/settings/privacy", heading: "Privacy & Data" },
  { path: "/settings/security", heading: "Account Security" },
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

test("usage page handles signed-out and quota fallback states", async ({ page }) => {
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

  const signedOutPrompt = page.getByRole("heading", { name: "Sign in to view usage" });
  const signedOut = await signedOutPrompt
    .waitFor({ state: "visible", timeout: 1_500 })
    .then(() => true)
    .catch(() => false);

  if (signedOut) {
    await expect(signedOutPrompt).toBeVisible();
    await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
    return;
  }

  await expect(page.getByText("0 / 1,000")).toBeVisible();
  await expect(page.getByText("0 / 100")).toBeVisible();
  await expect(page.getByText("0 B / 1.0 GB")).toBeVisible();
});

test("auth callback shows a recoverable error state", async ({ page }) => {
  await page.goto("/auth/callback?error_description=This+link+has+expired");

  await expect(page.getByText("Sign-in could not be completed")).toBeVisible();
  await expect(
    page.getByText("This sign-in link is invalid or expired. Request a new one.")
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Request a new sign-in link" })).toHaveAttribute(
    "href",
    "/auth/login"
  );
});

test("email confirmation is prefetch-safe and requires an explicit user action", async ({ page }) => {
  let verificationRequests = 0;
  page.on("request", (request) => {
    if (request.url().includes("/auth/confirm/verify")) verificationRequests += 1;
  });

  await page.goto("/auth/confirm?token_hash=test-token&type=email&next=%2Fdocuments");

  await expect(page.getByRole("heading", { name: "Confirm your secure sign-in" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirm and sign in" })).toBeVisible();
  await expect(page.locator('meta[name="referrer"]')).toHaveAttribute("content", "no-referrer");
  expect(verificationRequests).toBe(0);
});

test("password recovery confirmation is prefetch-safe and requires an explicit user action", async ({
  page,
}) => {
  let verificationRequests = 0;
  page.on("request", (request) => {
    if (request.url().includes("/auth/confirm/verify")) verificationRequests += 1;
  });

  await page.goto(
    "/auth/confirm?token_hash=test-token&type=recovery&next=%2Fauth%2Fupdate-password"
  );

  await expect(page.getByRole("heading", { name: "Confirm password recovery" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirm and reset password" })).toBeVisible();
  await expect(page.locator('meta[name="referrer"]')).toHaveAttribute("content", "no-referrer");
  expect(verificationRequests).toBe(0);
});

test("invalid email confirmation links fail safely", async ({ page }) => {
  await page.goto("/auth/confirm?type=email");

  await expect(
    page.getByRole("heading", { name: "This authentication link is invalid" })
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Request a new sign-in link" })).toHaveAttribute(
    "href",
    "/auth/login"
  );
});
