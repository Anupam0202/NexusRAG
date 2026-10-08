import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ listDocuments: vi.fn(), getDocumentIngestionStatus: vi.fn(), deleteDocument: vi.fn(), reindexDocument: vi.fn(), retryIngestionJob: vi.fn(), setDocuments: vi.fn(), removeDocument: vi.fn(), navigate: vi.fn() }));
vi.mock("@/lib/api", async importOriginal => ({ ...await importOriginal<object>(), ...api }));
vi.mock("next/navigation", () => ({ useParams: () => ({ documentId: "doc-a" }) }));
vi.mock("@/lib/static-navigation", () => ({ navigateStatic: api.navigate }));
vi.mock("@/components/documents/DocumentChunksExplorer", () => ({ DocumentChunksExplorer: () => <div>Chunk viewer fixture</div> }));
import { useStore } from "@/hooks/useStore";
import DocumentDetail from "./DocumentDetailClient";
const document = { document_id: "doc-a", filename: "Private synthetic document.txt", status: "ready", file_type: "txt", file_size_bytes: 100, page_count: 1, chunk_count: 1, created_at: "2026-10-01T00:00:00Z", processing_time_seconds: 0, extra: {} };
describe("document detail authority", () => {
  beforeEach(() => {
    Object.values(api).forEach(mock => mock.mockReset()); api.listDocuments.mockResolvedValue({ documents: [document], total: 1 });
    useStore.setState({ authMode: "authenticated", authUser: { id: "user-a", email: null }, workspaceId: "workspace-a", setDocuments: api.setDocuments, removeDocument: api.removeDocument });
  });
  it("drops old-account private details and global inventory side effects", async () => {
    let finish!: (value: unknown) => void; api.listDocuments.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    render(<DocumentDetail />); await waitFor(() => expect(api.listDocuments).toHaveBeenCalledTimes(1));
    api.listDocuments.mockImplementationOnce(() => new Promise(() => {}));
    act(() => useStore.setState({ authUser: { id: "user-b", email: null } }));
    await act(async () => finish({ documents: [document], total: 1 }));
    expect(api.setDocuments).not.toHaveBeenCalled(); expect(screen.queryByText(document.filename)).not.toBeInTheDocument();
  });
  it("retains the document and displays incomplete deletion rather than navigating away", async () => {
    api.deleteDocument.mockResolvedValue({ success: false, message: "Derived cleanup remains pending" });
    render(<DocumentDetail />); await screen.findByText(document.filename); fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await screen.findByText("Derived cleanup remains pending"); expect(api.removeDocument).not.toHaveBeenCalled(); expect(api.navigate).not.toHaveBeenCalled();
    expect(api.deleteDocument).toHaveBeenCalledWith("doc-a", { workspaceId: "workspace-a", expectedUserId: "user-a" });
  });
  it("does not disguise an outage as a document-not-found result", async () => {
    api.listDocuments.mockRejectedValue(new Error("Inventory outage")); api.getDocumentIngestionStatus.mockRejectedValue(new Error("Status outage"));
    render(<DocumentDetail />); await screen.findByText("Unable to load document"); expect(screen.getByText("Status outage")).toBeInTheDocument();
    expect(screen.queryByText("Document not found")).not.toBeInTheDocument();
  });
});
