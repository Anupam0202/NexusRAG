import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ChatInterface from "./ChatInterface";
import { ApiRequestError } from "@/lib/api";
import { useStore } from "@/hooks/useStore";

const fixture = vi.hoisted(() => ({ clear: vi.fn(), error: vi.fn(), success: vi.fn(), send: vi.fn() }));
vi.mock("@/lib/api", async () => ({ ...await vi.importActual("@/lib/api"), clearSession: fixture.clear }));
vi.mock("@/hooks/useChat", () => ({ useChat: () => ({
  messages: useStore((s) => s.messages), sendMessage: fixture.send,
}) }));
vi.mock("@/hooks/useDocuments", () => ({ useDocuments: () => ({ documents: [], loading: false, error: null }) }));
vi.mock("sonner", () => ({ toast: { error: fixture.error, success: fixture.success } }));

beforeEach(() => {
  vi.resetAllMocks();
  Element.prototype.scrollIntoView = vi.fn();
  useStore.setState({ ...useStore.getInitialState(), authMode: "authenticated",
    authUser: { id: "22222222-2222-4222-8222-222222222222", email: null },
    workspaceId: "11111111-1111-4111-8111-111111111111",
    sessionId: "a1111111-1111-4111-8111-111111111111",
    messages: [{ id: "synthetic-message", role: "user", content: "Synthetic private question", timestamp: "2026-10-11T12:00:00Z" }],
  });
});
afterEach(() => { cleanup(); useStore.setState(useStore.getInitialState()); });

it("authorization denial preserves local history and never claims success", async () => {
  fixture.clear.mockRejectedValueOnce(new ApiRequestError("Conversation is not available.", "CONVERSATION_UNAVAILABLE"));
  render(<ChatInterface />);
  fireEvent.click(screen.getByTitle("Clear chat"));
  await waitFor(() => expect(fixture.error).toHaveBeenCalledWith("Conversation is not available."));
  expect(useStore.getState().messages).toHaveLength(1);
  await waitFor(() => expect(screen.getByText("Synthetic private question")).toBeVisible());
  expect(fixture.success).not.toHaveBeenCalled();
});

it("an unavailable first-turn session offers an explicit local-only draft reset", async () => {
  fixture.clear.mockRejectedValueOnce(new ApiRequestError("Conversation is not available.", "CONVERSATION_UNAVAILABLE"));
  render(<ChatInterface />);
  fireEvent.click(screen.getByTitle("Clear chat"));
  await waitFor(() => expect(fixture.error).toHaveBeenCalled());
  expect(useStore.getState().messages).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Reset local draft" }));
  expect(useStore.getState().messages).toHaveLength(0);
  expect(fixture.clear).toHaveBeenCalledTimes(1);
  expect(fixture.success).toHaveBeenCalledWith("Local draft reset. Stored history was not changed.");
  expect(fixture.success).not.toHaveBeenCalledWith("Chat history cleared");
});

it("ambiguous cleanup does not offer a draft reset or discard history", async () => {
  fixture.clear.mockRejectedValueOnce(new ApiRequestError("Cleanup unconfirmed", "CLEANUP_UNCONFIRMED"));
  render(<ChatInterface />);
  fireEvent.click(screen.getByTitle("Clear chat"));
  await waitFor(() => expect(fixture.error).toHaveBeenCalled());
  expect(screen.queryByRole("button", { name: "Reset local draft" })).not.toBeInTheDocument();
  expect(useStore.getState().messages).toHaveLength(1);
});

it("confirmed zero-message cleanup preserves the reusable session and next-turn workflow", async () => {
  fixture.clear.mockResolvedValueOnce({ success: true, durable_messages_deleted: 0 });
  render(<ChatInterface />);
  fireEvent.click(screen.getByTitle("Clear chat"));
  await waitFor(() => expect(useStore.getState().messages).toHaveLength(0));
  expect(useStore.getState().sessionId).toBe("a1111111-1111-4111-8111-111111111111");
  expect(fixture.success).toHaveBeenCalledWith("Chat history cleared");
  fireEvent.change(screen.getByLabelText("Chat message"), { target: { value: "New synthetic question" } });
  fireEvent.click(screen.getByRole("checkbox", { name: /This question contains no personal/ }));
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  expect(fixture.send).toHaveBeenCalledWith("New synthetic question", expect.objectContaining({ nonSensitiveAttested: true }));
});

it("pending cleanup disables double submission and retains history until confirmation", async () => {
  let confirm!: (receipt: unknown) => void;
  fixture.clear.mockReturnValueOnce(new Promise((resolve) => { confirm = resolve; }));
  render(<ChatInterface />);
  fireEvent.click(screen.getByTitle("Clear chat"));
  expect(screen.getByTitle("Clear chat")).toBeDisabled();
  fireEvent.click(screen.getByTitle("Clear chat"));
  expect(fixture.clear).toHaveBeenCalledTimes(1);
  expect(useStore.getState().messages).toHaveLength(1);
  confirm({ success: true, durable_messages_deleted: 1 });
  await waitFor(() => expect(useStore.getState().messages).toHaveLength(0));
});
