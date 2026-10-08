import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ getCurrentWorkspace: vi.fn(), listDocuments: vi.fn(), uploadDocument: vi.fn(), deleteDocument: vi.fn(), reindexDocument: vi.fn(), getIngestionJob: vi.fn() }));
vi.mock("@/lib/api", async importOriginal => ({ ...await importOriginal<object>(), ...api }));
import { useStore } from "@/hooks/useStore";
import { useDocuments } from "./useDocuments";
const document = { document_id: "doc-a", filename: "fixture.txt", status: "ready" };
describe("document request account fences", () => {
  const setDocuments = vi.fn(), addDocument = vi.fn(), removeDocument = vi.fn();
  beforeEach(() => {
    Object.values(api).forEach(mock => mock.mockReset()); [setDocuments, addDocument, removeDocument].forEach(mock => mock.mockReset());
    api.listDocuments.mockResolvedValue({ documents: [], total: 0 });
    api.getCurrentWorkspace.mockResolvedValue({ workspace_id: "workspace-a", user_id: "user-a", role: "owner" });
    useStore.setState({ authMode: "authenticated", authUser: { id: "user-a", email: null }, workspaceId: "workspace-a", documents: [], setDocuments, addDocument, removeDocument });
  });
  afterEach(() => { vi.useRealTimers(); });
  it("waits for workspace selection and binds inventory to the originating actor", async () => {
    useStore.setState({ workspaceId: null }); renderHook(() => useDocuments()); expect(api.listDocuments).not.toHaveBeenCalled();
    act(() => useStore.setState({ workspaceId: "workspace-a" }));
    await waitFor(() => expect(api.listDocuments).toHaveBeenCalledWith({ workspaceId: "workspace-a", expectedUserId: "user-a" }));
  });
  it("never publishes a pending old-account inventory", async () => {
    let finish!: (value: unknown) => void; api.listDocuments.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    renderHook(() => useDocuments());
    api.listDocuments.mockImplementationOnce(() => new Promise(() => {}));
    act(() => useStore.setState({ authUser: { id: "user-b", email: null } }));
    await act(async () => finish({ documents: [document], total: 1 })); expect(setDocuments).not.toHaveBeenCalled();
  });
  it("does not fabricate upload success from an existing same-named document", async () => {
    api.uploadDocument.mockRejectedValue(new Error("Unknown upload outcome"));
    api.listDocuments.mockResolvedValue({ documents: [document], total: 1 });
    const { result } = renderHook(() => useDocuments()); await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await expect(result.current.upload(new File(["synthetic"], "fixture.txt"), "non_sensitive")).rejects.toThrow("Unknown upload outcome"); });
    expect(addDocument).not.toHaveBeenCalled(); expect(result.current.error).toBe("Unknown upload outcome");
  });
  it("does not publish old-account upload completion or continue its polling", async () => {
    let finish!: (value: unknown) => void; api.uploadDocument.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const { result } = renderHook(() => useDocuments()); await waitFor(() => expect(result.current.loading).toBe(false));
    let pending!: Promise<unknown>; act(() => { pending = result.current.upload(new File(["synthetic"], "fixture.txt"), "non_sensitive"); });
    await waitFor(() => expect(api.uploadDocument).toHaveBeenCalledWith(expect.any(File), "non_sensitive", { workspaceId: "workspace-a", expectedUserId: "user-a" }));
    act(() => useStore.setState({ authUser: { id: "user-b", email: null } }));
    await act(async () => { finish({ success: true, document, job_id: "job-a", job: { status: "queued" } }); await pending; });
    expect(addDocument).not.toHaveBeenCalled(); expect(api.getIngestionJob).not.toHaveBeenCalled();
  });
  it("does not remove documents when the API reports incomplete cleanup", async () => {
    api.deleteDocument.mockResolvedValue({ success: false, message: "Cleanup pending" });
    const { result } = renderHook(() => useDocuments()); await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => result.current.remove("doc-a")); expect(removeDocument).not.toHaveBeenCalled(); expect(result.current.error).toBe("Cleanup pending");
  });
  it("stops polling before the next request after identity changes", async () => {
    api.reindexDocument.mockResolvedValue({ job_id: "job-a", status: "queued" });
    const { result } = renderHook(() => useDocuments()); await waitFor(() => expect(result.current.loading).toBe(false));
    vi.useFakeTimers(); let pending!: Promise<unknown>;
    await act(async () => { pending = result.current.reindex("doc-a"); await Promise.resolve(); });
    act(() => useStore.setState({ workspaceId: "workspace-b" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); await pending; });
    expect(api.getIngestionJob).not.toHaveBeenCalled();
  });
  it("keeps inventory readable for viewers but rejects every document mutation", async () => {
    api.getCurrentWorkspace.mockResolvedValue({ workspace_id: "workspace-a", user_id: "user-a", role: "viewer" });
    const { result } = renderHook(() => useDocuments());
    await waitFor(() => expect(result.current.mutationDisabledReason).toMatch(/Viewer access/));
    expect(api.listDocuments).toHaveBeenCalled(); expect(result.current.canMutate).toBe(false);
    await act(async () => {
      await expect(result.current.upload(new File(["fixture"], "fixture.txt"), "non_sensitive")).rejects.toThrow("Viewer access");
      await result.current.remove("doc-a"); await result.current.reindex("doc-a");
    });
    expect(api.uploadDocument).not.toHaveBeenCalled(); expect(api.deleteDocument).not.toHaveBeenCalled(); expect(api.reindexDocument).not.toHaveBeenCalled();
  });
  it("revalidates a previous owner role before sending a private file", async () => {
    const { result } = renderHook(() => useDocuments());
    await waitFor(() => expect(result.current.canMutate).toBe(true));
    api.getCurrentWorkspace.mockResolvedValue({ workspace_id: "workspace-a", user_id: "user-a", role: "viewer" });
    await act(async () => {
      await expect(result.current.upload(new File(["fixture"], "fixture.txt"), "non_sensitive")).rejects.toThrow("Viewer access");
    });
    expect(api.uploadDocument).not.toHaveBeenCalled(); expect(result.current.canMutate).toBe(false);
  });
  it("fails closed on foreign authority or role lookup failure without losing read access", async () => {
    api.getCurrentWorkspace.mockResolvedValue({ workspace_id: "workspace-b", user_id: "user-b", role: "owner" });
    const { result } = renderHook(() => useDocuments());
    await waitFor(() => expect(result.current.mutationDisabledReason).toMatch(/could not be verified/));
    api.getCurrentWorkspace.mockRejectedValue(new Error("Synthetic authority outage"));
    await act(async () => result.current.remove("doc-a"));
    expect(api.deleteDocument).not.toHaveBeenCalled();
    expect(api.listDocuments).toHaveBeenCalled(); expect(result.current.canMutate).toBe(false);
  });
  it("does not dispatch a mutation after its authority check crosses an identity change", async () => {
    const { result } = renderHook(() => useDocuments());
    await waitFor(() => expect(result.current.canMutate).toBe(true));
    let finish!: (value: unknown) => void;
    api.getCurrentWorkspace.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    let pending!: Promise<unknown>;
    act(() => { pending = result.current.remove("doc-a"); });
    api.getCurrentWorkspace.mockResolvedValue({ workspace_id: "workspace-a", user_id: "user-b", role: "viewer" });
    act(() => useStore.setState({ authUser: { id: "user-b", email: null } }));
    await act(async () => { finish({ workspace_id: "workspace-a", user_id: "user-a", role: "owner" }); await pending; });
    expect(api.deleteDocument).not.toHaveBeenCalled(); expect(result.current.canMutate).toBe(false);
  });
  it("does not let an older owner lookup overwrite a newer viewer refresh", async () => {
    let finish!: (value: unknown) => void;
    api.getCurrentWorkspace.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const { result } = renderHook(() => useDocuments());
    await waitFor(() => expect(api.getCurrentWorkspace).toHaveBeenCalledOnce());
    api.getCurrentWorkspace.mockResolvedValue({ workspace_id: "workspace-a", user_id: "user-a", role: "viewer" });
    await act(async () => { await result.current.refresh(); });
    await waitFor(() => expect(result.current.mutationDisabledReason).toMatch(/Viewer access/));
    await act(async () => finish({ workspace_id: "workspace-a", user_id: "user-a", role: "owner" }));
    expect(result.current.canMutate).toBe(false);
    expect(result.current.mutationDisabledReason).toMatch(/Viewer access/);
  });
});
