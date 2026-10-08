import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const { cache, getSession, getCurrentWorkspace, setAuth, setWorkspace, unsubscribe, onAuthStateChange } = vi.hoisted(() => ({ cache: { workspace: null as string | null }, getSession: vi.fn(), getCurrentWorkspace: vi.fn(), setAuth: vi.fn(), setWorkspace: vi.fn(), unsubscribe: vi.fn(), onAuthStateChange: vi.fn() }));
vi.mock("@/lib/api", () => ({ getCurrentWorkspace }));
vi.mock("@/lib/supabase/client", () => ({ hasPublicSupabaseConfig: () => true, createSupabaseBrowserClient: () => ({ auth: { getSession, onAuthStateChange } }) }));
vi.mock("@/lib/api-context", () => ({ getStoredWorkspaceId: () => cache.workspace, setStoredWorkspaceId: vi.fn() }));
import { useStore } from "@/hooks/useStore";
import { AuthProvider } from "./AuthProvider";
describe("authentication discovery", () => {
  beforeEach(() => {
    cache.workspace = null;
    [getSession, getCurrentWorkspace, setAuth, setWorkspace, unsubscribe, onAuthStateChange].forEach(mock => mock.mockReset());
    onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe } } });
    useStore.setState({ authMode: "loading", authUser: null, workspaceId: null, setAuthState: setAuth, setWorkspaceId: setWorkspace });
  });
  it("fails closed on session error without an unhandled rejection", async () => {
    getSession.mockRejectedValue(new Error("Synthetic auth outage")); render(<AuthProvider />);
    await waitFor(() => expect(setAuth).toHaveBeenCalledWith("signed_out", null)); expect(getCurrentWorkspace).not.toHaveBeenCalled();
  });
  it("does not restore an unmounted pending session", async () => {
    let finish!: (value: unknown) => void; getSession.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const { unmount } = render(<AuthProvider />); unmount();
    await act(async () => finish({ data: { session: { user: { id: "old-user" } } } }));
    expect(setAuth).not.toHaveBeenCalled(); expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
  it("discards a confirmed foreign cached workspace and discovers authorized membership", async () => {
    cache.workspace = "foreign-cache"; useStore.setState({ workspaceId: cache.workspace });
    setWorkspace.mockImplementation(id => { cache.workspace = id; useStore.setState({ workspaceId: id }); });
    getSession.mockResolvedValue({ data: { session: { user: { id: "user-a" } } } });
    getCurrentWorkspace.mockRejectedValueOnce(Object.assign(new Error("Denied"), { code: "FORBIDDEN" }))
      .mockResolvedValueOnce({ workspace_id: "authorized-workspace" });
    render(<AuthProvider />);
    await waitFor(() => expect(setWorkspace).toHaveBeenCalledWith("authorized-workspace"));
    expect(getCurrentWorkspace.mock.calls.map(call => call[0])).toEqual([
      { workspaceId: "foreign-cache", expectedUserId: "user-a" }, { workspaceId: null, expectedUserId: "user-a" }
    ]);
  });
  it("does not erase cached selection or invent a new workspace on transient discovery failure", async () => {
    cache.workspace = "selected-workspace"; useStore.setState({ workspaceId: cache.workspace });
    getSession.mockResolvedValue({ data: { session: { user: { id: "user-a" } } } });
    getCurrentWorkspace.mockRejectedValue(new Error("Synthetic network outage")); render(<AuthProvider />);
    await waitFor(() => expect(getCurrentWorkspace).toHaveBeenCalledTimes(1));
    expect(setWorkspace).not.toHaveBeenCalledWith(null); expect(getCurrentWorkspace).toHaveBeenCalledWith({ workspaceId: "selected-workspace", expectedUserId: "user-a" });
  });
  it("binds discovery to its session and preserves a newer explicit selection", async () => {
    let finish!: (value: unknown) => void; getSession.mockResolvedValue({ data: { session: { user: { id: "user-a", email: null } } } });
    getCurrentWorkspace.mockImplementation(() => new Promise(resolve => { finish = resolve; })); render(<AuthProvider />);
    await waitFor(() => expect(getCurrentWorkspace).toHaveBeenCalledWith({ workspaceId: null, expectedUserId: "user-a" }));
    act(() => useStore.setState({ workspaceId: "selected-workspace" }));
    await act(async () => finish({ workspace_id: "discovered-workspace" })); expect(setWorkspace).not.toHaveBeenCalled();
  });
});
