import { expect, test } from "@playwright/test";

const routes = [
  { path: "/auth/login", heading: "Sign in to NexusRAG" },
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
    await expect(
      page.getByRole("heading", { name: route.heading }).first()
    ).toBeVisible();

    expect(errors).toEqual([]);
  });
}

test("OAuth gateway presents Google first and GitHub second", async ({ page }) => {
  await page.goto("/auth/login");

  const providerButtons = page.locator("main").getByRole("button");
  await expect(providerButtons).toHaveCount(2);
  await expect(providerButtons.nth(0)).toHaveAccessibleName(
    "Continue with Google"
  );
  await expect(providerButtons.nth(1)).toHaveAccessibleName(
    "Continue with GitHub"
  );
});

test("signup intent redirects to the OAuth gateway and preserves a safe destination", async ({
  page,
}) => {
  await page.goto("/auth/signup?next=%2Fworkspaces");

  await expect(page).toHaveURL(
    /\/auth\/login\?intent=signup&next=%2Fworkspaces$/
  );
  await expect(
    page.getByRole("heading", { name: "Create your NexusRAG account" })
  ).toBeVisible();
});

test("signup intent rejects an external destination", async ({ page }) => {
  await page.goto(
    "/auth/signup?next=https%3A%2F%2Fattacker.example%2Fsteal"
  );

  await expect(page).toHaveURL(
    /\/auth\/login\?intent=signup&next=%2Fonboarding$/
  );
});

for (const path of ["/auth/forgot-password", "/auth/update-password"]) {
  test(`${path} redirects to OAuth sign-in`, async ({ page }) => {
    await page.goto(path);

    await expect(page).toHaveURL(/\/auth\/login$/);
    await expect(
      page.getByRole("heading", { name: "Sign in to NexusRAG" })
    ).toBeVisible();
  });
}

test("retired confirmation route preserves only safe internal destinations", async ({
  page,
}) => {
  await page.goto("/auth/confirm?next=%2Fchat");
  await expect(page).toHaveURL(/\/auth\/login\?next=%2Fchat$/);

  await page.goto(
    "/auth/confirm?next=https%3A%2F%2Fattacker.example%2Fsteal"
  );
  await expect(page).toHaveURL(/\/auth\/login\?next=%2Fdocuments$/);
});

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

  const signedOutPrompt = page.getByRole("heading", {
    name: "Sign in to view usage",
  });
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

test("auth callback shows a provider-neutral recoverable error state", async ({
  page,
}) => {
  await page.goto(
    "/auth/callback?error_description=Sensitive+provider+details"
  );

  await expect(page.getByText("Sign-in could not be completed")).toBeVisible();
  await expect(
    page.getByText(
      "Authentication could not be completed. Return to sign in and try again."
    )
  ).toBeVisible();
  await expect(page.getByText(/sensitive provider details/i)).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Back to sign in" })).toHaveAttribute(
    "href",
    "/auth/login"
  );
});
