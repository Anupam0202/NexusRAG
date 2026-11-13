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

async function ask(error: Error) {
  api.chatQuery.mockRejectedValue(error);
  const { result } = renderHook(() => useChat());
  act(() => result.current.sendMessage("What is the retention period?", { nonSensitiveAttested: true }));
  await waitFor(() => expect(useStore.getState().messages.at(-1)?.isStreaming).toBe(false));
  const state = useStore.getState();
  return { shown: state.messages.at(-1)?.content ?? "", keyPrompt: state.showApiKeyModal, connection: state.connectionStatus };
}

it("asks for a key again when Gemini rejects the key or its project has no credit", async () => {
  for (const [code, message] of [
    ["PROVIDER_KEY_REJECTED", "Gemini rejected the API key. If you added your own key, check it in Settings; it must be a valid Gemini API key from Google AI Studio."],
    ["PROVIDER_CREDIT_EXHAUSTED", "Gemini refused the request because the API key's project has no prepaid credit left. Add your own Gemini API key in Settings, or add credit to your key's project in Google AI Studio."],
  ]) {
    useStore.setState({ showApiKeyModal: false, messages: [] });
    const outcome = await ask(new ApiRequestError(message, code, code === "PROVIDER_KEY_REJECTED" ? 502 : 402));
    expect(outcome.shown).toContain(message);
    expect(outcome.keyPrompt).toBe(true);
    expect(outcome.connection).toBe("online");
  }
});

it("shows the gateway's own explanation of a limit or an outage instead of a generic sentence", async () => {
  for (const [code, message] of [
    ["PROVIDER_QUOTA_EXHAUSTED", "Gemini is rate limited or out of quota. Try again in a few minutes."],
    ["TRY_AFTER_RESET", "Today's usage limit has been reached. It resets at midnight UTC."],
    ["INDEX_NOT_ANSWERING", "The search index is not answering. It may be restarting, or it was paused after a week without use, in which case the service operator has to wake it. Your documents are safe. Try again in a few minutes."],
  ]) {
    useStore.setState({ showApiKeyModal: false, messages: [] });
    const outcome = await ask(new ApiRequestError(message, code, code === "INDEX_NOT_ANSWERING" ? 503 : 429));
    expect(outcome.shown).toContain(message);
    expect(outcome.shown).not.toContain("workspace budget blocks this request");
    expect(outcome.keyPrompt).toBe(false);
    expect(outcome.connection).toBe("online");
  }
});

it("keeps the general sentence for a limit reported without a code", async () => {
  const outcome = await ask(new Error("429 resource exhausted"));
  expect(outcome.shown).toContain("The free-tier limit or workspace budget blocks this request.");
});
