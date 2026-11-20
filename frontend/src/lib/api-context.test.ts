import { beforeEach, describe, expect, it, vi } from "vitest";
const { configured, getSession } = vi.hoisted(() => ({ configured: vi.fn(), getSession: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ hasPublicSupabaseConfig: configured, createSupabaseBrowserClient: () => ({ auth: { getSession } }) }));
import { getApiHeaders, setStoredWorkspaceId } from "./api-context";
describe("explicit workspace authority", () => {
  beforeEach(() => { configured.mockReturnValue(false); getSession.mockReset(); localStorage.clear(); setStoredWorkspaceId("old-workspace"); });
  it("keeps legacy fallback only for omitted context", async () => {
    expect(await getApiHeaders()).toMatchObject({ "X-Nexus-Workspace-Id": "old-workspace" });
  });
  it.each([null, "", "   "])("never substitutes stale storage for explicit %s", async (workspaceId) => {
    const headers = await getApiHeaders({ workspaceId });
    expect(headers).not.toHaveProperty("X-Nexus-Workspace-Id");
    expect(headers).not.toHaveProperty("X-Workspace-ID");
  });
  it("uses the explicitly selected workspace", async () => {
    expect(await getApiHeaders({ workspaceId: " new-workspace " })).toMatchObject({ "X-Nexus-Workspace-Id": "new-workspace" });
  });
});


describe("initiating account authority", () => {
  beforeEach(() => { configured.mockReturnValue(true); getSession.mockReset(); });
  it("accepts only a matching session identity", async () => {
    getSession.mockResolvedValue({ data: { session: { user: { id: "user-a" }, access_token: "synthetic-token" } } });
    expect(await getApiHeaders({ expectedUserId: "user-a" })).toMatchObject({ Authorization: "Bearer synthetic-token" });
  });
  it("fails closed when an awaited session belongs to a different account", async () => {
    getSession.mockResolvedValue({ data: { session: { user: { id: "user-b" }, access_token: "synthetic-token" } } });
    await expect(getApiHeaders({ expectedUserId: "user-a" })).rejects.toMatchObject({ code: "AUTH_CONTEXT_CHANGED" });
  });
  it.each([null, ""])("rejects explicit missing initiating identity %s", async expectedUserId => {
    await expect(getApiHeaders({ expectedUserId })).rejects.toMatchObject({ code: "AUTH_CONTEXT_CHANGED" });
    expect(getSession).not.toHaveBeenCalled();
  });
  it("fails closed on missing config rather than sending an unauthenticated mutation", async () => {
    configured.mockReturnValue(false);
    await expect(getApiHeaders({ expectedUserId: "user-a" })).rejects.toMatchObject({ code: "AUTH_CONTEXT_CHANGED" });
  });
});
