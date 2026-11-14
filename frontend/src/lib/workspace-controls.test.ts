import { describe, expect, it, vi } from "vitest";
import {
  canManageWorkspaceMember,
  deleteDocumentsBestEffort,
  normalizeRetentionSchedule,
  retentionRunSummary,
  toggleDocumentSelection,
} from "./workspace-controls";
import type { RetentionRunReceipt } from "@/types";

describe("canManageWorkspaceMember", () => {
  it("hides durable member controls outside authenticated mode", () => {
    expect(
      canManageWorkspaceMember({
        authMode: "demo",
        actorRole: "owner",
        actorUserId: "owner",
        member: { user_id: "viewer", role: "viewer" },
      })
    ).toBe(false);
  });

  it("prevents self-management and owner management", () => {
    expect(
      canManageWorkspaceMember({
        authMode: "authenticated",
        actorRole: "owner",
        actorUserId: "owner",
        member: { user_id: "owner", role: "owner" },
      })
    ).toBe(false);
    expect(
      canManageWorkspaceMember({
        authMode: "authenticated",
        actorRole: "admin",
        actorUserId: "admin",
        member: { user_id: "owner", role: "owner" },
      })
    ).toBe(false);
  });

  it("allows owners to manage admins and admins to manage editors", () => {
    expect(
      canManageWorkspaceMember({
        authMode: "authenticated",
        actorRole: "owner",
        actorUserId: "owner",
        member: { user_id: "admin", role: "admin" },
      })
    ).toBe(true);
    expect(
      canManageWorkspaceMember({
        authMode: "authenticated",
        actorRole: "admin",
        actorUserId: "admin",
        member: { user_id: "editor", role: "editor" },
      })
    ).toBe(true);
  });
});

describe("toggleDocumentSelection", () => {
  it("reports the selection cap instead of silently discarding the requested document", () => {
    const selected = Array.from({ length: 25 }, (_, index) => `document-${index}`);

    expect(toggleDocumentSelection(selected, "document-26")).toEqual({
      selected,
      limitReached: true,
    });
  });

  it("removes an already-selected document", () => {
    expect(toggleDocumentSelection(["one", "two"], "one")).toEqual({
      selected: ["two"],
      limitReached: false,
    });
  });
});

describe("deleteDocumentsBestEffort", () => {
  it("continues after individual failures and reports both outcomes", async () => {
    const remove = vi.fn(async (documentId: string) => {
      if (documentId === "two") throw new Error("locked");
    });

    await expect(deleteDocumentsBestEffort(["one", "two", "three"], remove)).resolves.toEqual({
      deletedIds: ["one", "three"],
      pendingIds: [],
      failures: [{ documentId: "two", message: "locked" }],
    });
    expect(remove).toHaveBeenCalledTimes(3);
  });

  it("keeps documents that are still being erased apart from finished deletions", async () => {
    const remove = vi.fn(async (documentId: string) => ({ success: true, state: documentId === "two" ? "PENDING" : "DELETED" }));
    await expect(deleteDocumentsBestEffort(["one", "two"], remove)).resolves.toEqual({
      deletedIds: ["one"],
      pendingIds: ["two"],
      failures: [],
    });
  });
});

describe("normalizeRetentionSchedule", () => {
  it("clears days when retention is disabled", () => {
    expect(normalizeRetentionSchedule(false, 90)).toEqual({
      retention_enabled: false,
      retention_days: 0,
    });
  });

  it("rejects an enabled schedule without a positive day count", () => {
    expect(() => normalizeRetentionSchedule(true, 0)).toThrow("at least 1 day");
  });

  it("rejects a schedule the gateway would refuse", () => {
    expect(() => normalizeRetentionSchedule(true, 3651)).toThrow("at most 3650 days");
    expect(normalizeRetentionSchedule(true, 3650)).toEqual({ retention_enabled: true, retention_days: 3650 });
  });
});

describe("retentionRunSummary", () => {
  const receipt = (patch: Partial<RetentionRunReceipt> = {}): RetentionRunReceipt => ({
    workspace_deleted: false, cutoff: "2026-10-14T12:00:00Z", documents_deleted: 0, documents_pending_erasure: 0,
    documents_kept_for_radar: 0, chat_messages_deleted: 0, chat_sessions_deleted: 0, chat_titles_cleared: 0,
    workbench_runs_redacted: 0, research_runs_deleted: 0, runs_kept_for_findings: 0, more_remaining: false, failures: [],
    ...patch,
  });
  const day = new Date("2026-10-14T12:00:00Z").toLocaleDateString("en-GB");

  it("says what was removed, from before which date, and what happens next", () => {
    expect(retentionRunSummary(receipt({ documents_deleted: 2, documents_pending_erasure: 2, chat_messages_deleted: 14,
      chat_sessions_deleted: 1, workbench_runs_redacted: 1, research_runs_deleted: 2 }), "en-GB")).toBe(
      `Removed 2 documents, 14 chat messages, 1 unused conversation and 3 research runs from before ${day}. `
        + "The documents' stored copies are erased in the background, usually within the hour.");
  });

  it("says when nothing was due", () => {
    expect(retentionRunSummary(receipt(), "en-GB")).toBe(`Nothing from before ${day} was left to remove.`);
  });

  it("names what was kept and whether more remains", () => {
    expect(retentionRunSummary(receipt({ documents_deleted: 1, documents_pending_erasure: 1, documents_kept_for_radar: 1,
      runs_kept_for_findings: 2, more_remaining: true }), "en-GB")).toBe(
      `Removed 1 document from before ${day}. The documents' stored copies are erased in the background, usually within the hour. `
        + "1 document is kept because Radar stores it. 2 research runs are kept because saved findings cite them. "
        + "More remains; the next run continues within the hour.");
  });
});
