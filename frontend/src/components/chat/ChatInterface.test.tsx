import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ChatInterface from "./ChatInterface";
import { useStore } from "@/hooks/useStore";

const fixture = vi.hoisted(() => ({
  sendMessage: vi.fn(), error: vi.fn(), messages: [],
  documents: [{ document_id: "33333333-3333-4333-8333-333333333333",
    filename: "report.txt", file_type: "txt", file_size_bytes: 25, page_count: 0,
    chunk_count: 1, status: "ready", created_at: "2026-01-02T12:00:00Z",
    processing_time_seconds: 0, extraction_method: "synthetic", extra: {} }],
}));
vi.mock("@/hooks/useChat", () => ({ useChat: () => ({ sendMessage: fixture.sendMessage, messages: fixture.messages }) }));
vi.mock("@/hooks/useDocuments", () => ({ useDocuments: () => ({ documents: fixture.documents, loading: false, error: null }) }));
vi.mock("sonner", () => ({ toast: { error: fixture.error } }));

function change(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}
function prepareSend() {
  change("Chat message", "What does the evidence say?");
  fireEvent.click(screen.getByRole("checkbox", { name: /This question contains no personal/ }));
}
beforeEach(() => {
  vi.clearAllMocks();
  Element.prototype.scrollIntoView = vi.fn();
  useStore.setState({ ...useStore.getInitialState(), authMode: "authenticated",
    authUser: { id: "22222222-2222-4222-8222-222222222222", email: null },
    workspaceId: "11111111-1111-4111-8111-111111111111" });
});
afterEach(() => { cleanup(); useStore.setState(useStore.getInitialState()); });

describe("chat filter controls (synthetic component state, not live OAuth acceptance)", () => {
  it("sends exact selected filters and inclusive UTC end dates through the actual controls", () => {
    render(<ChatInterface />);
    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    change("Filter by filename", "report.txt");
    change("Filter by uploader user ID", "22222222-2222-4222-8222-222222222222");
    change("Minimum page", "0"); change("Maximum page", "2");
    change("Uploaded after", "2026-01-02"); change("Uploaded before", "2026-01-02");
    change("Metadata key", "literal.key"); change("Metadata value", "finance");
    fireEvent.click(screen.getByRole("checkbox", { name: "TXT" }));
    expect(screen.getByText(/Dates use UTC/)).toBeVisible();
    prepareSend();
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    expect(fixture.sendMessage).toHaveBeenCalledExactlyOnceWith("What does the evidence say?", {
      nonSensitiveAttested: true, chatScope: "workspace", documentIds: undefined,
      fileTypes: ["txt"], filename: "report.txt", uploadedBy: "22222222-2222-4222-8222-222222222222",
      minPage: 0, maxPage: 2, uploadedAfter: "2026-01-02T00:00:00.000Z",
      uploadedBefore: "2026-01-02T23:59:59.999Z", metadataFilters: { "literal.key": "finance" },
    });
    expect(screen.getByLabelText("Chat message")).toHaveValue("");
    expect(screen.getByRole("checkbox", { name: /This question contains no personal/ })).not.toBeChecked();
  });
  it("invalid filters preserve input and stop before sending a research request", () => {
    render(<ChatInterface />);
    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    change("Filter by uploader user ID", "not-a-user-id"); prepareSend();
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    expect(fixture.sendMessage).not.toHaveBeenCalled();
    expect(fixture.error).toHaveBeenCalledWith("Uploader must be a valid user ID.");
    expect(screen.getByLabelText("Chat message")).toHaveValue("What does the evidence say?");
  });
  it("workspace changes discard the old scope, question and processing attestation", () => {
    render(<ChatInterface />);
    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    change("Filter by filename", "private-old-workspace.txt"); prepareSend();
    act(() => useStore.setState({ workspaceId: "44444444-4444-4444-8444-444444444444" }));
    expect(screen.queryByLabelText("Filter by filename")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Chat message")).toHaveValue("");
    expect(screen.getByRole("checkbox", { name: /This question contains no personal/ })).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    expect(screen.getByLabelText("Filter by filename")).toHaveValue("");
    expect(fixture.sendMessage).not.toHaveBeenCalled();
  });
});