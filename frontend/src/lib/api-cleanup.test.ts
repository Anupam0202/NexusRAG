import { afterEach, describe, expect, it, vi } from "vitest";

const getApiHeaders = vi.hoisted(() => vi.fn(async () => ({ Authorization: "Bearer synthetic" })));
vi.mock("@/lib/api-context", () => ({ getApiHeaders }));
vi.mock("@/lib/backend-url", () => ({ buildBackendUrl: (path: string) => `https://gateway.invalid${path}` }));

import { clearSession, deleteCurrentWorkspace, deleteDocument, runRetention } from "./api";
import { deleteDocumentsBestEffort } from "./workspace-controls";

const context = { workspaceId: "workspace-a", expectedUserId: "user-a" };
const lifecycle = {
  workspace_deleted: false,
  documents_deleted: 2,
  chat_sessions_deleted: 1,
  local_chunks_deleted: 5,
  qdrant_chunks_deleted: 5,
  failures: [],
};

function respond(body: unknown) {
  const fetch = vi.fn().mockImplementation(async () => new Response(JSON.stringify(body)));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("confirmed cleanup responses", () => {
  it.each([null, {}, { success: false }, { success: "true" }, { success: true, message: 42 }])(
    "rejects an unconfirmed document deletion body %j", async body => {
      respond(body);
      await expect(deleteDocument("document-a", context)).rejects.toMatchObject({ code: "CLEANUP_UNCONFIRMED" });
    }
  );

  it("keeps unconfirmed deletions out of the best-effort success count", async () => {
    respond({ success: false, message: "Private upstream detail" });
    const result = await deleteDocumentsBestEffort(["document-a"], id => deleteDocument(id, context));
    expect(result.deletedIds).toEqual([]);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].message).not.toContain("Private upstream detail");
  });

  it("passes on that a document's stored copies are still being erased", async () => {
    const receipt = { success: true, state: "PENDING", message: "a.pdf is no longer available. Its stored copies are still being erased." };
    respond(receipt);
    await expect(deleteDocument("document-a", context)).resolves.toEqual(receipt);
    respond(receipt);
    const result = await deleteDocumentsBestEffort(["document-a"], id => deleteDocument(id, context));
    expect(result).toEqual({ deletedIds: [], pendingIds: ["document-a"], failures: [] });
  });

  it("accepts an explicit document receipt and keeps actor/workspace binding", async () => {
    const receipt = { success: true, message: "Deleted" };
    const fetch = respond(receipt);
    await expect(deleteDocument("document/a", context)).resolves.toEqual(receipt);
    expect(fetch.mock.calls[0][0]).toBe("https://gateway.invalid/api/v1/documents/document%2Fa/delete");
    expect(getApiHeaders).toHaveBeenCalledWith(context);
  });

  it.each([null, {}, { success: false }, { success: "true" }, { success: true, durable_messages_deleted: -1 }])(
    "rejects unconfirmed history clearing %j", async body => {
      respond(body);
      await expect(clearSession("session-a", context)).rejects.toMatchObject({ code: "CLEANUP_UNCONFIRMED" });
    }
  );

  it("accepts clear-history success and encodes the session path", async () => {
    const receipt = { success: true, durable_messages_deleted: 0 };
    const fetch = respond(receipt);
    await expect(clearSession("session/a?other=1", context)).resolves.toEqual(receipt);
    expect(fetch.mock.calls[0][0]).toBe("https://gateway.invalid/api/v1/chat/sessions/session%2Fa%3Fother%3D1/clear");
    expect(getApiHeaders).toHaveBeenCalledWith(context);
  });

  it.each([null, {}, lifecycle, { ...lifecycle, workspace_deleted: true, failures: [{ document_id: "a", message: "pending" }] }])(
    "does not clear a workspace context on unconfirmed erasure %j", async body => {
      respond(body);
      await expect(deleteCurrentWorkspace(context)).rejects.toMatchObject({ code: "CLEANUP_UNCONFIRMED" });
    }
  );

  it("accepts explicit workspace erasure with no partial failures", async () => {
    const receipt = { ...lifecycle, workspace_deleted: true };
    respond(receipt);
    await expect(deleteCurrentWorkspace(context)).resolves.toEqual(receipt);
  });

  const retention = {
    workspace_deleted: false, cutoff: "2026-10-14T12:00:00+00:00", documents_deleted: 2, documents_pending_erasure: 2,
    documents_kept_for_radar: 0, chat_messages_deleted: 14, chat_sessions_deleted: 1, chat_titles_cleared: 1,
    workbench_runs_redacted: 0, research_runs_deleted: 0, runs_kept_for_findings: 0, more_remaining: false, failures: [],
  };

  it.each([
    null, {}, lifecycle, { ...retention, failures: null },
    { ...retention, failures: [{ document_id: "a", message: "pending" }] },
    { ...retention, documents_deleted: -1 }, { ...retention, documents_deleted: 1.5 },
    { ...retention, documents_deleted: "2" }, { ...retention, workspace_deleted: true },
    { ...retention, chat_messages_deleted: undefined }, { ...retention, more_remaining: "no" },
  ])("rejects malformed, partial or unexpected retention completion %j", async body => {
    respond(body);
    await expect(runRetention(context)).rejects.toMatchObject({ code: "CLEANUP_UNCONFIRMED" });
  });

  it("accepts bounded confirmed retention counts without erasing the workspace", async () => {
    respond(retention);
    await expect(runRetention(context)).resolves.toEqual(retention);
  });

  it("does not retry an ambiguous mutation automatically", async () => {
    const fetch = respond({ success: false });
    await expect(deleteDocument("document-a", context)).rejects.toThrow("not confirmed");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
