import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ApiRequestError } from "@/lib/api";
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

it("returns an actionable ordinary summary-selection error without retrying or marking the gateway offline", async () => {
  api.chatQuery.mockRejectedValue(new ApiRequestError("Select summary documents.", "DOCUMENT_SELECTION_REQUIRED"));
  const { result } = renderHook(() => useChat());
  act(() => result.current.sendMessage("Summarize this document", { nonSensitiveAttested: true }));
  await waitFor(() => expect(result.current.documentSelectionRequest?.question).toBe("Summarize this document"));
  expect(api.chatQuery).toHaveBeenCalledTimes(1);
  expect(useStore.getState().connectionStatus).toBe("online");
  expect(useStore.getState().messages.at(-1)?.isStreaming).toBe(false);
  expect(useStore.getState().messages.at(-1)?.content).toContain("Select summary documents.");
  api.chatQuery.mockResolvedValue({ answer: "Summary.", sources: [], query_type: "summary",
    confidence: 0, response_time_seconds: 0, metadata: {} });
  act(() => result.current.sendMessage("Summarize this document", { documentIds: ["33333333-3333-4333-8333-333333333333"] }));
  await waitFor(() => expect(api.chatQuery).toHaveBeenCalledTimes(2));
  expect(result.current.documentSelectionRequest).toBeNull();
});

it("dismisses selection recovery when its conversation messages are reset", async () => {
  api.chatQuery.mockRejectedValue(new ApiRequestError("Select summary documents.", "DOCUMENT_SELECTION_REQUIRED"));
  const { result } = renderHook(() => useChat());
  act(() => result.current.sendMessage("Summarize this document", { nonSensitiveAttested: true }));
  await waitFor(() => expect(result.current.documentSelectionRequest).not.toBeNull());
  act(() => useStore.getState().clearMessages());
  expect(result.current.documentSelectionRequest).toBeNull();
});
