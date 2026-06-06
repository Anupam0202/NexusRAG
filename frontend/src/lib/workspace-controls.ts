import type { AuthMode } from "@/hooks/useStore";
import type { WorkspaceRole } from "@/types";

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

export async function deleteDocumentsBestEffort(
  documentIds: string[],
  remove: (documentId: string) => Promise<unknown>
) {
  const deletedIds: string[] = [];
  const failures: Array<{ documentId: string; message: string }> = [];

  for (const documentId of documentIds) {
    try {
      await remove(documentId);
      deletedIds.push(documentId);
    } catch (error) {
      failures.push({
        documentId,
        message: error instanceof Error ? error.message : "Unknown deletion error",
      });
    }
  }

  return { deletedIds, failures };
}
