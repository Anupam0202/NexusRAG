import { describe, expect, it, vi } from "vitest";
import { createDocumentStaticWorker, toPublicAddress } from "./static-document-worker";
const id = "00000000-0000-4000-8000-000000000001";
const origin = "https://synthetic.invalid";
describe("static document-detail Worker routing", () => {
  it("maps UUID deep links to the shell without forwarding private query or credentials", async () => {
    const delegate = { fetch: vi.fn() };
    const fetchAsset = vi.fn().mockResolvedValue(new Response("Synthetic static shell"));
    const worker = createDocumentStaticWorker(delegate);
    const response = await worker.fetch(new Request(`${origin}/documents/${id}?scope=private`, {
      headers: { Authorization: "Bearer synthetic", Cookie: "synthetic=session", "X-Nexus-Workspace-Id": "synthetic-workspace", "If-None-Match": '"synthetic-etag"' },
    }), { ASSETS: { fetch: fetchAsset } }, {});
    expect(await response.text()).toBe("Synthetic static shell");
    expect(delegate.fetch).not.toHaveBeenCalled();
    const request = fetchAsset.mock.calls[0][0] as Request;
    expect(request.url).toBe(`${origin}/documents/__static_document__.html`);
    expect(request.headers.get("If-None-Match")).toBe('"synthetic-etag"');
    for (const header of ["Authorization", "Cookie", "X-Nexus-Workspace-Id"]) expect(request.headers.has(header)).toBe(false);
  });
  it("preserves HEAD semantics and supports a trailing slash", async () => {
    const fetchAsset = vi.fn().mockResolvedValue(new Response(null));
    await createDocumentStaticWorker({ fetch: vi.fn() }).fetch(new Request(`${origin}/documents/${id}/`, { method: "HEAD" }), { ASSETS: { fetch: fetchAsset } }, {});
    expect((fetchAsset.mock.calls[0][0] as Request).method).toBe("HEAD");
  });
  it("rejects mutations before contacting assets or OpenNext", async () => {
    const delegate = { fetch: vi.fn() }, fetchAsset = vi.fn();
    const result = await createDocumentStaticWorker(delegate).fetch(new Request(`${origin}/documents/${id}`, { method: "POST" }), { ASSETS: { fetch: fetchAsset } }, {});
    expect(result.status).toBe(405); expect(result.headers.get("Allow")).toBe("GET, HEAD");
    expect(fetchAsset).not.toHaveBeenCalled(); expect(delegate.fetch).not.toHaveBeenCalled();
  });
  it("does not disguise a missing asset binding as a working document route", async () => {
    const result = await createDocumentStaticWorker({ fetch: vi.fn() }).fetch(new Request(`${origin}/documents/${id}`), {}, {});
    expect(result.status).toBe(503); expect(result.headers.get("Cache-Control")).toBe("no-store");
  });
  it("rejects malformed identifiers and nested paths without dynamic rendering", async () => {
    const delegate = { fetch: vi.fn() }, worker = createDocumentStaticWorker(delegate);
    for (const path of ["/documents/not-a-uuid", `/documents/${id}/unrelated`, "/documents/%3Cscript%3E"]) {
      expect((await worker.fetch(new Request(origin + path), {}, {})).status).toBe(404);
    }
    expect(delegate.fetch).not.toHaveBeenCalled();
  });
  it("preserves the full OpenNext delegate for other routes", async () => {
    const delegate = { fetch: vi.fn().mockResolvedValue(new Response("Delegate fixture")) }, worker = createDocumentStaticWorker(delegate);
    const env = {}, ctx = {}, request = new Request(`${origin}/auth/confirm/verify`);
    expect(await (await worker.fetch(request, env, ctx)).text()).toBe("Delegate fixture");
    expect(delegate.fetch).toHaveBeenCalledWith(request, env, ctx);
  });
});

describe("pages asked for on the Worker's own address", () => {
  const site = "https://nexusrag.pages.dev";
  const own = "https://nexusrag-app.example.workers.dev";
  const page = (url: string, init: RequestInit = {}) =>
    new Request(url, { ...init, headers: { Accept: "text/html,application/xhtml+xml", ...(init.headers ?? {}) } });

  it("go to the public address with their path and query, temporarily and without being stored", async () => {
    const delegate = { fetch: vi.fn() };
    const response = await createDocumentStaticWorker(delegate, [], site).fetch(page(`${own}/research?plan=1`), {}, {});
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(`${site}/research?plan=1`);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Content-Security-Policy")).toBeNull();
    expect(delegate.fetch).not.toHaveBeenCalled();
    const document = await createDocumentStaticWorker(delegate, [], site).fetch(page(`${own}/documents/${id}`, { method: "HEAD" }), {}, {});
    expect(document.headers.get("Location")).toBe(`${site}/documents/${id}`);
  });

  it("are served where they are asked for on the public address, locally, or when the build names no address", () => {
    for (const url of [`${site}/research`, "http://localhost:3003/research", "https://nexusrag.example.com/research"]) {
      expect(toPublicAddress(page(url), site)).toBeNull();
    }
    expect(toPublicAddress(page(`${own}/research`), null)).toBeNull();
  });

  it("leave files, data requests and changes where they are, so release checks and open pages keep working", () => {
    expect(toPublicAddress(new Request(`${own}/_nexus-build.json`), site)).toBeNull();
    expect(toPublicAddress(new Request(`${own}/research`, { headers: { Accept: "*/*", RSC: "1" } }), site)).toBeNull();
    expect(toPublicAddress(page(`${own}/auth/callback`, { method: "POST" }), site)).toBeNull();
  });

  it("are served by the app once they reach the public address", async () => {
    const delegate = { fetch: vi.fn().mockResolvedValue(new Response("Delegate fixture")) };
    const response = await createDocumentStaticWorker(delegate, [], site).fetch(page(`${site}/research`), {}, {});
    expect(await response.text()).toBe("Delegate fixture");
  });
});
describe("revalidation of pages OpenNext answers from the build's output (issue #45)", () => {
  const page = (headers: Record<string, string> = {}) => new Response("<!doctype html><title>Synthetic</title>", {
    headers: { "Content-Type": "text/html; charset=utf-8", ETag: '"synthetic-etag"', "Cache-Control": "s-maxage=31536000", Vary: "rsc", ...headers },
  });
  const ask = (headers: Record<string, string>, method = "GET", answer = page()) =>
    createDocumentStaticWorker({ fetch: vi.fn().mockResolvedValue(answer) }, ["https://gateway.invalid"])
      .fetch(new Request(`${origin}/auth/login`, { method, headers }), {}, {});
  it("answers a matching If-None-Match with 304, no body and no policy, keeping the validators", async () => {
    for (const condition of ['"synthetic-etag"', 'W/"synthetic-etag"', '"other", "synthetic-etag"', "*"]) {
      const response = await ask({ "If-None-Match": condition });
      expect(response.status, condition).toBe(304);
      expect(response.body, condition).toBeNull();
      expect(response.headers.get("Content-Security-Policy"), condition).toBeNull();
      expect(response.headers.get("ETag")).toBe('"synthetic-etag"');
      expect(response.headers.get("Cache-Control")).toBe("s-maxage=31536000");
      expect(response.headers.get("Vary")).toBe("rsc");
      expect(response.headers.get("Content-Type")).toBeNull();
    }
    expect((await ask({ "If-None-Match": '"synthetic-etag"' }, "HEAD")).status).toBe(304);
  });
  it("serves the page with its policy when the condition does not match or does not apply", async () => {
    for (const [headers, method, answer] of [
      [{ "If-None-Match": '"other"' }, "GET", page()],
      [{}, "GET", page()],
      [{ "If-None-Match": '"synthetic-etag"' }, "GET", page({ ETag: "" })],
      [{ "If-None-Match": '"synthetic-etag"' }, "GET", new Response("missing", { status: 404, headers: { "Content-Type": "text/html", ETag: '"synthetic-etag"' } })],
    ] as const) {
      const response = await ask(headers, method, answer);
      expect(response.status).toBe(answer.status);
      expect(await response.text()).not.toBe("");
      expect(response.headers.get("Content-Security-Policy")).toContain("connect-src 'self' https://gateway.invalid");
    }
  });
});
