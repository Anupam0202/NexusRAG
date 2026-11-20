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
