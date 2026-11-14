import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { BASE_POLICY, SECURITY_HEADERS, withSecurityHeaders } from "./security-headers";
import { createDocumentStaticWorker } from "./static-document-worker";

const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("base64");
const bootstrap = "(self.__next_f=self.__next_f||[]).push([0])";
const page = `<!DOCTYPE html><html><head><script src="/_next/static/chunks/a.js" async=""></script></head><body>Café<script>${bootstrap}</script></body></html>`;
const pagePolicy = `${BASE_POLICY}; script-src 'self' 'sha256-${sha256(bootstrap)}'; connect-src 'self'`;
const connect = ["https://gateway.invalid", "https://supabase.invalid"];
const html = { "Content-Type": "text/html; charset=utf-8" };

describe("security headers (NX-28)", () => {
  it("forbid framing, plugins, foreign base URLs, form targets and scripts from other origins", () => {
    expect(SECURITY_HEADERS["Content-Security-Policy"]).toBe(
      "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'; script-src 'self'",
    );
    expect(SECURITY_HEADERS["Content-Security-Policy"]).not.toMatch(/unsafe-inline|unsafe-eval|\*/);
    expect(SECURITY_HEADERS["X-Frame-Options"]).toBe("DENY");
    expect(SECURITY_HEADERS["X-Content-Type-Options"]).toBe("nosniff");
    expect(SECURITY_HEADERS["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(SECURITY_HEADERS["Strict-Transport-Security"]).toBe("max-age=31536000; includeSubDomains");
  });

  it("give a page a policy that allows exactly its inline scripts, and leave the page unchanged", async () => {
    const response = await withSecurityHeaders(new Response(page, { status: 404, statusText: "Not Found", headers: html }));
    expect(response.headers.get("Content-Security-Policy")).toBe(pagePolicy);
    expect(response.status).toBe(404);
    expect(response.statusText).toBe("Not Found");
    expect(await response.text()).toBe(page);
  });

  it("let a page connect only to its own origin and the origins it was built with", async () => {
    const response = await withSecurityHeaders(new Response(page, { headers: html }), connect);
    expect(response.headers.get("Content-Security-Policy")).toBe(
      `${BASE_POLICY}; script-src 'self' 'sha256-${sha256(bootstrap)}'; connect-src 'self' https://gateway.invalid https://supabase.invalid`,
    );
    const json = await withSecurityHeaders(new Response("{}", { headers: { "Content-Type": "application/json" } }), connect);
    expect(json.headers.get("Content-Security-Policy")).toBe(SECURITY_HEADERS["Content-Security-Policy"]);
  });

  it("replace the policy the static assets add to the document shell with the page's own", async () => {
    const shell = new Response(page, { headers: { ...html, "content-security-policy": SECURITY_HEADERS["Content-Security-Policy"] } });
    expect((await withSecurityHeaders(shell)).headers.get("Content-Security-Policy")).toBe(pagePolicy);
  });

  it("send no policy with a response that has no body, so a 304 cannot change the policy of a stored page", async () => {
    for (const original of [
      new Response(null, { status: 304, headers: { ETag: '"synthetic"', "content-security-policy": SECURITY_HEADERS["Content-Security-Policy"] } }),
      new Response(null, { status: 200, headers: html }),
    ]) {
      const response = await withSecurityHeaders(original);
      expect(response.status).toBe(original.status);
      expect(response.headers.has("Content-Security-Policy")).toBe(false);
      expect(response.headers.get("X-Frame-Options")).toBe("DENY");
    }
  });

  it("keep a response's own headers and give other content the base policy", async () => {
    const original = new Response('{"ok":true}', { headers: { "Content-Type": "application/json", "X-Frame-Options": "SAMEORIGIN" } });
    const response = await withSecurityHeaders(original);
    expect(await response.text()).toBe('{"ok":true}');
    expect(response.headers.get("Content-Type")).toBe("application/json");
    expect(response.headers.get("X-Frame-Options")).toBe("SAMEORIGIN");
    expect(response.headers.get("Content-Security-Policy")).toBe(SECURITY_HEADERS["Content-Security-Policy"]);
  });

  it("reach every response the Worker produces", async () => {
    const origin = "https://synthetic.invalid";
    const worker = createDocumentStaticWorker({ fetch: vi.fn().mockImplementation(async () => new Response(page, { headers: html })) }, connect);
    const fetchAsset = vi.fn().mockImplementation(async () => new Response(page, { headers: html }));
    const pages = [
      await worker.fetch(new Request(`${origin}/research`), {}, {}),
      await worker.fetch(new Request(`${origin}/documents/00000000-0000-4000-8000-000000000001`), { ASSETS: { fetch: fetchAsset } }, {}),
    ];
    const refusals = [
      await worker.fetch(new Request(`${origin}/documents/not-a-uuid`), {}, {}),
      await worker.fetch(new Request(`${origin}/documents/00000000-0000-4000-8000-000000000001`, { method: "POST" }), {}, {}),
    ];
    for (const response of [...pages, ...refusals]) {
      for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
        if (name !== "Content-Security-Policy") expect(response.headers.get(name)).toBe(value);
      }
    }
    for (const response of pages) expect(response.headers.get("Content-Security-Policy")).toBe(`${pagePolicy} ${connect.join(" ")}`);
    for (const response of refusals) expect(response.headers.get("Content-Security-Policy")).toBe(SECURITY_HEADERS["Content-Security-Policy"]);
  });

  it("are the same in the _headers file that covers files served without the Worker", () => {
    const file = readFileSync(join(__dirname, "../../public/_headers"), "utf8");
    const lines = file.split("\n").filter((line) => line.trim() && !line.trim().startsWith("#"));
    expect(lines[0]).toBe("/*");
    const declared = Object.fromEntries(lines.slice(1).map((line) => {
      const separator = line.indexOf(":");
      return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
    }));
    expect(declared).toEqual(SECURITY_HEADERS);
  });
});
