import { expect, test } from "@playwright/test";

// Run against Wrangler local or the approved deployed Worker, not Next's SSR server.
const id = "00000000-0000-4000-8000-000000000001";
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