import { describe, expect, it, vi } from "vitest";
import {
  canManageWorkspaceMember,
  deleteDocumentsBestEffort,
  normalizeRetentionSchedule,
  toggleDocumentSelection,
} from "./workspace-controls";

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
      failures: [{ documentId: "two", message: "locked" }],
    });
    expect(remove).toHaveBeenCalledTimes(3);
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
});
