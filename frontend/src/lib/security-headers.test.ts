import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { SECURITY_HEADERS, withSecurityHeaders } from "./security-headers";
import { createDocumentStaticWorker } from "./static-document-worker";

describe("security headers (NX-28)", () => {
  it("forbid framing, plugins, foreign base URLs and form targets without restricting scripts", () => {
    expect(SECURITY_HEADERS["Content-Security-Policy"]).toBe("frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'");
    expect(SECURITY_HEADERS["Content-Security-Policy"]).not.toMatch(/script-src|default-src|connect-src/);
    expect(SECURITY_HEADERS["X-Frame-Options"]).toBe("DENY");
    expect(SECURITY_HEADERS["X-Content-Type-Options"]).toBe("nosniff");
    expect(SECURITY_HEADERS["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(SECURITY_HEADERS["Strict-Transport-Security"]).toBe("max-age=31536000; includeSubDomains");
  });

  it("are added to a response without changing its body, status or own headers", async () => {
    const original = new Response("<html></html>", { status: 404, statusText: "Not Found", headers: { "Content-Type": "text/html", "X-Frame-Options": "SAMEORIGIN" } });
    const response = withSecurityHeaders(original);
    expect(response.status).toBe(404);
    expect(response.statusText).toBe("Not Found");
    expect(await response.text()).toBe("<html></html>");
    expect(response.headers.get("Content-Type")).toBe("text/html");
    expect(response.headers.get("X-Frame-Options")).toBe("SAMEORIGIN");
    expect(response.headers.get("Content-Security-Policy")).toBe(SECURITY_HEADERS["Content-Security-Policy"]);
  });

  it("reach every response the Worker produces", async () => {
    const origin = "https://synthetic.invalid";
    const worker = createDocumentStaticWorker({ fetch: vi.fn().mockResolvedValue(new Response("page")) });
    const fetchAsset = vi.fn().mockResolvedValue(new Response("shell"));
    const responses = [
      await worker.fetch(new Request(`${origin}/research`), {}, {}),
      await worker.fetch(new Request(`${origin}/documents/00000000-0000-4000-8000-000000000001`), { ASSETS: { fetch: fetchAsset } }, {}),
      await worker.fetch(new Request(`${origin}/documents/not-a-uuid`), {}, {}),
      await worker.fetch(new Request(`${origin}/documents/00000000-0000-4000-8000-000000000001`, { method: "POST" }), {}, {}),
    ];
    for (const response of responses) {
      for (const [name, value] of Object.entries(SECURITY_HEADERS)) expect(response.headers.get(name)).toBe(value);
    }
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
