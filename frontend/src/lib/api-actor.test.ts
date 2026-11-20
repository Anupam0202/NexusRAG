import { afterEach, expect, it, vi } from "vitest";
const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ hasPublicSupabaseConfig: () => true, createSupabaseBrowserClient: () => ({ auth: { getSession } }) }));
import { setApiKey, uploadDocument, chatQuery } from "./api";
afterEach(() => { vi.unstubAllGlobals(); });
it("never sends credential payloads when the current session differs from the initiating account", async () => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  getSession.mockResolvedValue({ data: { session: { user: { id: "user-b" }, access_token: "synthetic-token" } } });
  await expect(setApiKey("synthetic-key-not-real", true, { workspaceId: "workspace-a", expectedUserId: "user-a" })).rejects.toMatchObject({ code: "AUTH_CONTEXT_CHANGED" });
  expect(fetch).not.toHaveBeenCalled();
});

it("never uploads private file bodies under a different account token", async () => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  getSession.mockResolvedValue({ data: { session: { user: { id: "user-b" }, access_token: "synthetic-token" } } });
  await expect(uploadDocument(new File(["synthetic private fixture"], "fixture.txt"), "non_sensitive", { workspaceId: "workspace-a", expectedUserId: "user-a" })).rejects.toMatchObject({ code: "AUTH_CONTEXT_CHANGED" });
  expect(fetch).not.toHaveBeenCalled();
});
it("never submits old-account question/history under a different token", async () => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  getSession.mockResolvedValue({ data: { session: { user: { id: "user-b" }, access_token: "synthetic-token" } } });
  await expect(chatQuery({ question: "Synthetic question", session_id: "session-a", non_sensitive_attested: true }, { workspaceId: "workspace-a", expectedUserId: "user-a" })).rejects.toMatchObject({ code: "AUTH_CONTEXT_CHANGED" });
  expect(fetch).not.toHaveBeenCalled();
});
