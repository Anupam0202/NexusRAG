import type { AuthMode } from "@/hooks/useStore";
import type { RetentionRunReceipt, WorkspaceRole } from "@/types";

type ManageableMember = {
  user_id: string;
  role: WorkspaceRole;
};

export function canManageWorkspaceMember({
  authMode,
  actorRole,
  actorUserId,
  member,
}: {
  authMode: AuthMode;
  actorRole: WorkspaceRole;
  actorUserId?: string | null;
  member: ManageableMember;
}) {
  if (authMode !== "authenticated" || !actorUserId || member.user_id === actorUserId) {
    return false;
  }
  if (member.role === "owner") return false;
  if (actorRole === "owner") return true;
  return actorRole === "admin" && member.role !== "admin";
}

export function toggleDocumentSelection(
  current: string[],
  documentId: string,
  limit = 25
) {
  if (current.includes(documentId)) {
    return {
      selected: current.filter((id) => id !== documentId),
      limitReached: false,
    };
  }
  if (current.length >= limit) {
    return { selected: current, limitReached: true };
  }
  return { selected: [...current, documentId], limitReached: false };
}

/**
 * Deletes documents one by one. `pendingIds` are documents that are already unavailable but whose stored
 * copies the service is still erasing.
 */
export async function deleteDocumentsBestEffort(
  documentIds: string[],
  remove: (documentId: string) => Promise<unknown>
) {
  const deletedIds: string[] = [];
  const pendingIds: string[] = [];
  const failures: Array<{ documentId: string; message: string }> = [];

  for (const documentId of documentIds) {
    try {
      const receipt = await remove(documentId);
      const pending = typeof receipt === "object" && receipt !== null && (receipt as { state?: unknown }).state === "PENDING";
      (pending ? pendingIds : deletedIds).push(documentId);
    } catch (error) {
      failures.push({
        documentId,
        message: error instanceof Error ? error.message : "Unknown deletion error",
      });
    }
  }

  return { deletedIds, pendingIds, failures };
}

export function normalizeRetentionSchedule(enabled: boolean, days: number) {
  if (!enabled) {
    return { retention_enabled: false, retention_days: 0 };
  }
  const normalizedDays = Math.floor(Number(days));
  if (!Number.isFinite(normalizedDays) || normalizedDays < 1) {
    throw new Error("Retention must be at least 1 day.");
  }
  if (normalizedDays > 3650) {
    throw new Error("Retention can be at most 3650 days (ten years).");
  }
  return { retention_enabled: true, retention_days: normalizedDays };
}

const counted = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
const listed = (items: string[]) =>
  items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;

/** What one retention run did, in the words shown to the person who ran it. */
export function retentionRunSummary(receipt: RetentionRunReceipt, locale?: string): string {
  const removed: string[] = [];
  if (receipt.documents_deleted) removed.push(counted(receipt.documents_deleted, "document", "documents"));
  if (receipt.chat_messages_deleted) removed.push(counted(receipt.chat_messages_deleted, "chat message", "chat messages"));
  if (receipt.chat_sessions_deleted) removed.push(counted(receipt.chat_sessions_deleted, "unused conversation", "unused conversations"));
  const research = receipt.workbench_runs_redacted + receipt.research_runs_deleted;
  if (research) removed.push(counted(research, "research run", "research runs"));
  const cutoff = receipt.cutoff ? new Date(receipt.cutoff) : null;
  const before = cutoff && !Number.isNaN(cutoff.getTime()) ? ` from before ${cutoff.toLocaleDateString(locale)}` : "";
  const sentences = [removed.length ? `Removed ${listed(removed)}${before}.` : `Nothing${before} was left to remove.`];
  if (receipt.documents_pending_erasure)
    sentences.push("The documents' stored copies are erased in the background, usually within the hour.");
  if (receipt.documents_kept_for_radar)
    sentences.push(`${counted(receipt.documents_kept_for_radar, "document is", "documents are")} kept because Radar stores ${receipt.documents_kept_for_radar === 1 ? "it" : "them"}.`);
  if (receipt.runs_kept_for_findings)
    sentences.push(`${counted(receipt.runs_kept_for_findings, "research run is", "research runs are")} kept because saved findings cite ${receipt.runs_kept_for_findings === 1 ? "it" : "them"}.`);
  if (receipt.more_remaining) sentences.push("More remains; the next run continues within the hour.");
  return sentences.join(" ");
}
