import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useStore } from "@/hooks/useStore";
const { status, access } = vi.hoisted(() => ({ status: vi.fn(), access: { authMode: "authenticated", canAccessWorkspaceApi: true } }));
vi.mock("@/lib/api", () => ({ getSystemStatus: status }));
vi.mock("@/hooks/useDocuments", () => ({ useDocuments: () => ({ ...access, documents: [], loading: false, uploading: false, error: null, upload: vi.fn(), remove: vi.fn(), reindex: vi.fn(), refresh: vi.fn(), canMutate: false }) }));
vi.mock("@/components/documents/UploadZone", () => ({ DEFAULT_UPLOAD_LIMITS: { maxUploadMb: 10, maxUploadBytes: 10_000_000 }, UploadZone: ({ limits }: { limits: { maxUploadBytes: number } }) => <p>Upload bound: {limits.maxUploadBytes}</p> }));
vi.mock("@/components/documents/DocumentList", () => ({ DocumentList: () => <p>Document list fixture</p> }));
vi.mock("@/components/documents/DocumentDetailPanel", () => ({ DocumentDetailPanel: () => null }));
import DocumentsPage from "./page";
describe("document upload-limit status authority", () => {
  beforeEach(() => {
    access.authMode = "authenticated"; access.canAccessWorkspaceApi = true;
    useStore.setState({ authMode: "authenticated", authUser: { id: "user-a", email: null }, workspaceId: "workspace-a" });
    status.mockReset(); status.mockResolvedValue({ settings: { max_upload_size_mb: 20 } });
  });
  it.each(["loading", "signed_out"])("never requests workspace status during %s", mode => {
    access.authMode = mode; access.canAccessWorkspaceApi = false; render(<DocumentsPage />);
    expect(status).not.toHaveBeenCalled(); expect(screen.getByText("Upload bound: 10000000")).toBeInTheDocument();
  });
  it("never uses authenticated-without-workspace state as status authority", () => {
    useStore.setState({ workspaceId: null }); render(<DocumentsPage />); expect(status).not.toHaveBeenCalled();
  });
  it("requires a bound actor even if a workspace identifier is cached", () => {
    useStore.setState({ authUser: null }); render(<DocumentsPage />); expect(status).not.toHaveBeenCalled();
  });
  it("binds read-only viewer limits to the explicit current actor and workspace", async () => {
    render(<DocumentsPage />); await screen.findByText("Upload bound: 20000000");
    expect(status).toHaveBeenCalledWith({ workspaceId: "workspace-a", expectedUserId: "user-a" });
  });
  it("retains demo compatibility without claiming authenticated identity", async () => {
    access.authMode = "demo"; useStore.setState({ authMode: "demo", authUser: null, workspaceId: null }); render(<DocumentsPage />);
    await screen.findByText("Upload bound: 20000000"); expect(status).toHaveBeenCalledWith({});
  });
  it("does not apply old-account limit responses to the new account", async () => {
    let oldResult!: (value: unknown) => void; let newResult!: (value: unknown) => void;
    status.mockImplementationOnce(() => new Promise(resolve => { oldResult = resolve; })).mockImplementationOnce(() => new Promise(resolve => { newResult = resolve; }));
    render(<DocumentsPage />); await waitFor(() => expect(status).toHaveBeenCalledOnce());
    act(() => useStore.setState({ authUser: { id: "user-b", email: null }, workspaceId: "workspace-b" }));
    await waitFor(() => expect(status).toHaveBeenCalledTimes(2));
    await act(async () => oldResult({ settings: { max_upload_size_mb: 90 } })); expect(screen.getByText("Upload bound: 10000000")).toBeInTheDocument();
    await act(async () => newResult({ settings: { max_upload_size_mb: 15 } })); expect(screen.getByText("Upload bound: 15000000")).toBeInTheDocument();
    expect(status.mock.calls[1][0]).toEqual({ workspaceId: "workspace-b", expectedUserId: "user-b" });
  });
});
