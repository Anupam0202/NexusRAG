import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const { getDocumentChunks } = vi.hoisted(() => ({ getDocumentChunks: vi.fn() }));
vi.mock("@/lib/api", () => ({ getDocumentChunks }));
import { useStore } from "@/hooks/useStore";
import { DocumentChunksExplorer } from "./DocumentChunksExplorer";
const chunk = (index: number, content: string) => ({ chunk_index: index, content, token_count: 0, page_number: 1, section_title: null });
describe("authorized chunk inventory", () => {
  beforeEach(() => {
    getDocumentChunks.mockReset(); useStore.setState({ authMode: "authenticated", authUser: { id: "user-a", email: null }, workspaceId: "workspace-a" });
  });
  it("shows measured zero tokens and loads remaining version-fenced pages", async () => {
    getDocumentChunks.mockResolvedValueOnce({ chunks: [chunk(0, "First original")], total: 2, total_is_exact: true, next_after: 0, version_id: "version-a" })
      .mockResolvedValueOnce({ chunks: [chunk(1, "Second original")], total: 2, total_is_exact: true, next_after: null, version_id: "version-a" });
    render(<DocumentChunksExplorer documentId="doc-a" limit={1} />);
    await screen.findByText("First original"); expect(screen.getByText("0 tokens")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Load more chunks" })); await screen.findByText("Second original");
    expect(getDocumentChunks).toHaveBeenLastCalledWith("doc-a", { search: "", limit: 1, after: 0, versionId: "version-a" }, { workspaceId: "workspace-a", expectedUserId: "user-a" });
    expect(screen.getByText("2 indexed chunks · showing 2")).toBeInTheDocument();
  });
  it("does not invent an exact total from a legacy limited response", async () => {
    getDocumentChunks.mockResolvedValue({ chunks: [chunk(0, "Original")], total: 1 });
    render(<DocumentChunksExplorer documentId="doc-a" expectedChunkCount={300} />);
    await screen.findByText("Original"); expect(screen.getByText("Showing 1 chunk previews · total unverified")).toBeInTheDocument();
    expect(screen.queryByText(/300 indexed/)).not.toBeInTheDocument();
  });
  it("drops old-account pending source text and search draft", async () => {
    let finish!: (value: unknown) => void; getDocumentChunks.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    render(<DocumentChunksExplorer documentId="doc-a" />);
    await waitFor(() => expect(getDocumentChunks).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText("Search indexed chunks"), { target: { value: "Old private query" } });
    getDocumentChunks.mockImplementationOnce(() => new Promise(() => {}));
    act(() => useStore.setState({ authUser: { id: "user-b", email: null } }));
    await act(async () => finish({ chunks: [chunk(0, "Old private original")], total: 1, total_is_exact: true }));
    expect(screen.queryByText("Old private original")).not.toBeInTheDocument(); expect(screen.getByLabelText("Search indexed chunks")).toHaveValue("");
  });
  it("rejects a changed version rather than combining incompatible pages", async () => {
    getDocumentChunks.mockResolvedValueOnce({ chunks: [chunk(0, "First original")], total: 2, total_is_exact: true, next_after: 0, version_id: "version-a" })
      .mockResolvedValueOnce({ chunks: [chunk(1, "New incompatible original")], total: 2, total_is_exact: true, next_after: null, version_id: "version-b" });
    render(<DocumentChunksExplorer documentId="doc-a" />); await screen.findByText("First original");
    fireEvent.click(screen.getByRole("button", { name: "Load more chunks" })); await screen.findByText(/Chunk inventory changed/);
    expect(screen.queryByText("New incompatible original")).not.toBeInTheDocument();
  });
});
