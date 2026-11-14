import { expect, test, type Page } from "@playwright/test";

// Run against Wrangler local or the approved deployed Worker, not Next's SSR server.
const id = "00000000-0000-4000-8000-000000000001";
test("Obligation Evidence route serves its public sign-in shell from the built Worker", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.name));
  const response = await page.goto("/evidence-api");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Sign in to inspect obligation evidence" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in", exact: true }).last())
    .toHaveAttribute("href", "/auth/login?next=%2Fevidence-api");
  expect(errors).toEqual([]);
});
test("Radar route serves its public sign-in shell from the built Worker", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.name));
  const response = await page.goto("/radar");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Sign in to your terms and quota workspace" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in", exact: true }).last())
    .toHaveAttribute("href", "/auth/login?next=%2Fradar");
  expect(errors).toEqual([]);
});
test("UUID document deep links serve the public shell and preserve the sign-in destination", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.name));
  const response = await page.goto(`/documents/${id}`);
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Sign in to view this document" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in", exact: true }).last())
    .toHaveAttribute("href", `/auth/login?next=${encodeURIComponent(`/documents/${id}`)}`);
  expect(new URL(page.url()).pathname).toBe(`/documents/${id}`);
  expect(errors).toEqual([]);
});

test("document route methods and malformed identifiers fail closed", async ({ request }) => {
  const malformed = await request.get("/documents/not-a-real-uuid");
  expect(malformed.status()).toBe(404);
  const mutation = await request.post(`/documents/${id}`, { data: { synthetic: true } });
  expect(mutation.status()).toBe(405);
  expect(mutation.headers().allow).toBe("GET, HEAD");
  const head = await request.head(`/documents/${id}/`);
  expect(head.status()).toBe(200);
  expect(await head.body()).toHaveLength(0);
});

test("missing assets and unknown routes return 404 instead of crashing the server adapter", async ({ request }) => {
  for (const path of ["/favicon.ico", "/__nexusrag_readonly_missing_route"]) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(404);
    expect(await response.text()).not.toContain("Unexpected loadManifest");
    const head = await request.head(path);
    expect(head.status(), path).toBe(404);
    expect(await head.body()).toHaveLength(0);
  }
  const icon = await request.get("/favicon.svg");
  expect(icon.status()).toBe(200);
  expect(icon.headers()["content-type"]).toContain("image/svg+xml");
});

test("ordinary unsupported methods reach the dynamic adapter without a manifest exception", async ({ request }) => {
  for (const method of ["GET", "HEAD"]) {
    const response = await request.fetch("/auth/confirm/verify", { method });
    expect(response.status()).toBe(405);
    const body = await response.text();
    expect(body).not.toContain("Unexpected loadManifest");
    expect(body).not.toContain("Worker threw exception");
    if (method === "HEAD") expect(body).toBe("");
  }
});

test("the dynamic legacy auth verifier rejects cross-origin posts without an adapter crash", async ({ request }) => {
  const response = await request.post("/auth/confirm/verify", {
    headers: { Origin: "https://cross-origin.synthetic.invalid" },
    form: { type: "email", token_hash: "synthetic-untrusted" },
    maxRedirects: 0,
  });
  expect(response.status()).toBe(303);
  const destination = new URL(response.headers().location);
  expect(destination.pathname).toBe("/auth/callback");
  expect(destination.searchParams.has("token_hash")).toBe(false);
  expect(destination.searchParams.has("error_description")).toBe(true);
});

// NX-28: every page runs under its own policy, which allows scripts from the app's origin and the page's inline scripts
// by hash, and connections to the gateway and Supabase this build uses (the environment of the build is the
// environment of this test). A blocked inline script stops hydration, so each page must hydrate with no policy
// violation. Some pages send a signed-out visitor on (the home page to Chat, account pages to sign-in), which also
// needs their scripts.
const pages = ["/", "/auth/login", "/auth/signup", "/auth/forgot-password", "/onboarding", "/chat", "/documents",
  "/research", "/findings", "/radar", "/evidence-api", "/workspaces", "/settings/api-keys", "/settings/privacy",
  `/documents/${id}`, "/__nexusrag_readonly_missing_route"];
const opens: Record<string, string> = { "/": "/chat", "/auth/signup": "/auth/login", "/auth/forgot-password": "/auth/login",
  "/onboarding": "/auth/login", "/workspaces": "/auth/login" };
const connectPolicy = `connect-src 'self' ${[...new Set([process.env.NEXT_PUBLIC_API_URL?.trim() || "http://localhost:8000",
  process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()].filter((url): url is string => Boolean(url)).map(url => new URL(url).origin))].join(" ")}`;
const hydrated = (page: Page) =>
  page.evaluate(() => Object.keys(document.body).some(key => key.startsWith("__reactFiber$"))).catch(() => false);
test("every page hydrates under a script policy that allows only its own scripts", async ({ page }) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    const seen: string[] = [];
    Object.assign(window, { __policyViolations: seen });
    document.addEventListener("securitypolicyviolation", event => seen.push(`${event.effectiveDirective} ${event.blockedURI}`));
  });
  const reported: string[] = [];
  page.on("console", message => {
    if (/content[- ]security[- ]policy/i.test(message.text())) reported.push(message.text());
  });
  for (const path of pages) {
    const response = await page.goto(path);
    const policy = response?.headers()["content-security-policy"] ?? "";
    const directives = policy.split("; ");
    expect(directives.filter(directive => /^script-src 'self'( 'sha256-[A-Za-z0-9+/]{43}=')+$/.test(directive)), path).toHaveLength(1);
    expect(directives, path).toContain(connectPolicy);
    expect(policy, path).not.toMatch(/unsafe-inline|unsafe-eval/);
    if (opens[path]) await page.waitForURL(url => url.pathname === opens[path], { waitUntil: "load", timeout: 15_000 });
    await expect.poll(() => hydrated(page), { message: `${path} hydrates` }).toBe(true);
    expect(await page.evaluate(() => (window as unknown as { __policyViolations: string[] }).__policyViolations), path).toEqual([]);
  }
  expect(reported).toEqual([]);
});

test("a page revalidated with 304 keeps the policy it was stored with", async ({ request }) => {
  for (const path of ["/radar", `/documents/${id}`]) {
    const first = await request.get(path);
    expect(first.headers()["content-security-policy"], path).toContain("'sha256-");
    const again = await request.get(path, { headers: { "If-None-Match": first.headers().etag } });
    expect(again.status(), path).toBe(304);
    expect(again.headers()["content-security-policy"], path).toBeUndefined();
  }
});

test("pages are not published as static files that would skip the Worker's policy", async ({ request }) => {
  for (const path of ["/index.html", "/radar.html", "/auth/login.html", "/404.html"]) {
    expect((await request.get(path)).status(), path).toBe(404);
  }
});
