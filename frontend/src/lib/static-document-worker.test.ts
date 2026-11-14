import { describe, expect, it, vi } from "vitest";
import { createDocumentStaticWorker } from "./static-document-worker";
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