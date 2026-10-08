import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/client", () => ({ hasPublicSupabaseConfig: () => false, createSupabaseBrowserClient: vi.fn() }));
import { getApiHeaders, setStoredWorkspaceId } from "./api-context";
describe("explicit workspace authority", () => {
  beforeEach(() => { localStorage.clear(); setStoredWorkspaceId("old-workspace"); });
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
