import { expect, test } from "@playwright/test";

const providerLabels: Record<string, string> = {
  github: "GitHub",
  google: "Google",
};
const providerOrder = ["google", "github"] as const;

const routes = [
  { path: "/auth/login", heading: "Sign in to NexusRAG" },
  { path: "/chat", heading: "Chat" },
  { path: "/documents", heading: "Documents" },
  { path: "/settings/billing-or-usage", heading: "Billing & Usage" },
  { path: "/settings/privacy", heading: "Privacy & Data" },
  { path: "/settings/security", heading: "Account Security" },
  { path: "/evidence-os", heading: "Evidence Intelligence OS" },
  { path: "/findings", heading: "Sign in to your evidence workbench" },
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

test("OAuth gateway presents exactly the configured providers", async ({ page }) => {
  await page.goto("/auth/login");

  const configuredProviders = new Set(
    (process.env.E2E_OAUTH_PROVIDERS || "google,github")
      .split(",")
      .map((provider) => provider.trim().toLowerCase())
      .filter(Boolean)
  );
  const expectedProviders = providerOrder.filter((provider) =>
    configuredProviders.has(provider)
  );
  const providerButtons = page.locator("main").getByRole("button");
  await expect(providerButtons).toHaveCount(expectedProviders.length);
  for (const [index, provider] of expectedProviders.entries()) {
    await expect(providerButtons.nth(index)).toHaveAccessibleName(
      `Continue with ${providerLabels[provider] ?? provider[0].toUpperCase() + provider.slice(1)}`
    );
  }
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
    "/auth/login?next=%2Fdocuments"
  );
});

for (const next of ["/settings/security", "https://attacker.invalid/steal", "/documents/..//attacker.invalid"]) {
  test(`callback recovery retains only a safe destination: ${next}`, async ({ page }) => {
    await page.goto(`/auth/callback?error=access_denied&error_description=synthetic-private-detail&next=${encodeURIComponent(next)}`);
    await expect(page.getByRole("alert").filter({ hasText: "Authentication could not be completed" })).toBeVisible();
    await expect(page).not.toHaveURL(/error_description|access_denied/);
    await expect(page.getByText("synthetic-private-detail")).toHaveCount(0);
    const expected = next === "/settings/security" ? next : "/documents";
    await page.getByRole("link", { name: "Back to sign in" }).click();
    await expect(page).toHaveURL(new RegExp(`/auth/login\\?next=${encodeURIComponent(expected)}$`));
    await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
  });
}

test("layout reflows without horizontal overflow", async ({ page }) => {
  await page.goto("/evidence-os");
  await expect(
    page.getByRole("heading", { name: "Evidence Intelligence OS" })
  ).toBeVisible();
  await expect(page.locator("main")).toHaveCount(1);
  await expect(page.locator("main main")).toHaveCount(0);
  const dimensions = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
});

test("keyboard navigation exposes a visible focus target", async ({ page }) => {
  await page.goto("/evidence-os");
  await page.keyboard.press("Tab");
  await expect(page.locator(":focus")).toBeVisible();
});

test("reduced-motion preference preserves the evidence content", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/evidence-os");
  await expect(
    page.getByRole("heading", { name: "Evidence Intelligence OS" })
  ).toBeVisible();
});


test("navigation has named collapsed links and a mobile focus loop", async ({ page }) => {
  await page.goto("/evidence-os", { waitUntil: "networkidle" });
  if ((page.viewportSize()?.width || 1280) < 1024) {
    const opener = page.getByRole("button", { name: "Open navigation menu" });
    await opener.click();
    const dialog = page.getByRole("dialog", { name: "Navigation menu" });
    await expect(dialog).toBeVisible();
    expect(await page.locator("main").evaluate(element => Boolean(element.closest("[inert]")))).toBe(true);
    await expect(dialog.getByRole("button", { name: "Dismiss navigation menu" })).toBeFocused();
    for (let index = 0; index < 12; index++) {
      await page.keyboard.press("Tab");
      expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(opener).toBeFocused();
    expect(await page.locator("main").evaluate(element => Boolean(element.closest("[inert]")))).toBe(false);
  } else {
    await page.getByRole("button", { name: "Collapse navigation sidebar" }).click();
    await expect(page.getByRole("link", { name: "Documents", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Expand navigation sidebar" }).click();
    await expect(page.getByRole("link", { name: "Documents", exact: true })).toBeVisible();
  }
});
