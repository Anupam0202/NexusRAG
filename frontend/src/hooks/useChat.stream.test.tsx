import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useChat } from "./useChat";
import { useStore } from "./useStore";

const api = vi.hoisted(() => ({ chatQuery: vi.fn(), getSessionMessages: vi.fn() }));
vi.mock("@/lib/api", async importOriginal => ({ ...await importOriginal<object>(), ...api }));
beforeEach(() => {
  vi.clearAllMocks();
  api.getSessionMessages.mockResolvedValue({ messages: [], total: 0 });
  useStore.setState({ ...useStore.getInitialState(), authMode: "authenticated",
    authUser: { id: "22222222-2222-4222-8222-222222222222", email: null },
    workspaceId: "11111111-1111-4111-8111-111111111111" });
});
afterEach(() => { cleanup(); useStore.setState(useStore.getInitialState()); });

it("shows the answer while it is written, then the checked answer in its place", async () => {
  const seen: string[] = [];
  api.chatQuery.mockImplementation(async (_request: unknown, _context: unknown, onToken: (token: string) => void) => {
    onToken("Retention is ");
    seen.push(useStore.getState().messages.at(-1)?.content ?? "");
    onToken("forty-seven days.");
    seen.push(useStore.getState().messages.at(-1)?.content ?? "");
    expect(useStore.getState().messages.at(-1)?.isStreaming).toBe(true);
    return { answer: "I cannot verify this answer against the available evidence.", sources: [], query_type: "hybrid", confidence: 0,
      response_time_seconds: 1, metadata: { abstained: true } };
  });
  const { result } = renderHook(() => useChat());
  act(() => result.current.sendMessage("What is the retention period?", { nonSensitiveAttested: true }));
  await waitFor(() => expect(useStore.getState().messages.at(-1)?.isStreaming).toBe(false));
  expect(seen).toEqual(["Retention is ", "Retention is forty-seven days."]);
  expect(useStore.getState().messages.at(-1)?.content).toBe("I cannot verify this answer against the available evidence.");
  expect(api.chatQuery).toHaveBeenCalledWith(expect.objectContaining({ question: "What is the retention period?" }), expect.any(Object), expect.any(Function));
});
