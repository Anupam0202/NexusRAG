import { webcrypto } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
const getApiHeaders = vi.hoisted(() => vi.fn(async () => ({ Authorization: "Bearer synthetic" })));
vi.mock("@/lib/api-context", () => ({ getApiHeaders }));
vi.mock("@/lib/backend-url", () => ({ buildBackendUrl: (path: string) => `https://gateway.invalid${path}` }));
import { createWorkspace, listDocuments, listCurrentWorkspaceMembers } from "./api";
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
describe("complete bounded document inventory", () => {
  it("follows keyset pages with the initiating workspace binding", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ documents: [{ document_id: "a" }], next_after: "a" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ documents: [{ document_id: "b" }], next_after: null })));
    vi.stubGlobal("fetch", fetch);
    expect(await listDocuments({ workspaceId: "workspace-a" })).toEqual({
      documents: [{ document_id: "a" }, { document_id: "b" }], total: 2, total_is_exact: true, next_after: null,
    });
    expect(fetch.mock.calls[1][0]).toBe("https://gateway.invalid/api/v1/documents?after=a");
    expect(getApiHeaders).toHaveBeenCalledWith({ workspaceId: "workspace-a" });
  });
  it("does not silently accept duplicate or non-advancing inventories", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ documents: [{ document_id: "a" }], next_after: "a" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ documents: [{ document_id: "a" }], next_after: "a" }))));
    await expect(listDocuments()).rejects.toThrow("inventory changed");
  });
  it("uses ASCII bounded stable workspace-create identities even for international names", async () => {
    vi.stubGlobal("crypto", webcrypto);
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ id: "workspace-a" }))));
    vi.stubGlobal("fetch", fetch);
    await createWorkspace({ name: "研究プロジェクト" });
    await createWorkspace({ name: "研究プロジェクト" });
    const first = fetch.mock.calls[0][1].headers["Idempotency-Key"];
    const second = fetch.mock.calls[1][1].headers["Idempotency-Key"];
    expect(first).toMatch(/^workspace-create:[a-f0-9]{64}$/);
    expect(second).toBe(first);
  });
});

describe("bounded member page API", () => {
  it("encodes the continuation cursor and preserves actor/workspace context", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({members: [], total: 203, total_is_exact: true, next_after: null})));
    vi.stubGlobal("fetch", fetch);
    await listCurrentWorkspaceMembers({workspaceId: "workspace-a", expectedUserId: "user-a"}, {after: "cursor&other=1", limit: 25});
    expect(fetch.mock.calls[0][0]).toBe("https://gateway.invalid/api/v1/workspaces/current/members?after=cursor%26other%3D1&limit=25");
    expect(getApiHeaders).toHaveBeenCalledWith({workspaceId: "workspace-a", expectedUserId: "user-a"});
  });
});
