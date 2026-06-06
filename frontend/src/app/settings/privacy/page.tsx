"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Eraser, Loader2, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { clearSession, deleteDocument, getCurrentWorkspace, listDocuments } from "@/lib/api";
import { AuthRequiredState } from "@/components/auth/AuthRequiredState";
import { useWorkspaceApiAccess } from "@/hooks/useAuthGate";
import { useStore } from "@/hooks/useStore";
import { deleteDocumentsBestEffort } from "@/lib/workspace-controls";
import type { WorkspaceRole } from "@/types";

const DELETE_CONFIRMATION = "DELETE DOCUMENTS";

export default function PrivacyPage() {
  const { authMode, canAccessWorkspaceApi } = useWorkspaceApiAccess();
  const sessionId = useStore((state) => state.sessionId);
  const clearMessages = useStore((state) => state.clearMessages);
  const setDocuments = useStore((state) => state.setDocuments);
  const [role, setRole] = useState<WorkspaceRole>("viewer");
  const [documentCount, setDocumentCount] = useState(0);
  const [confirmation, setConfirmation] = useState("");
  const [working, setWorking] = useState<"chat" | "documents" | null>(null);

  useEffect(() => {
    if (!canAccessWorkspaceApi) return;
    Promise.all([getCurrentWorkspace(), listDocuments()])
      .then(([workspace, documents]) => {
        setRole(workspace.role);
        setDocumentCount(documents.total);
      })
      .catch((error) => {
        toast.error(error instanceof Error ? error.message : "Unable to load privacy controls");
      });
  }, [canAccessWorkspaceApi]);

  if (!canAccessWorkspaceApi) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="mx-auto flex min-h-full max-w-xl flex-col justify-center px-4 py-8">
          <AuthRequiredState
            authMode={authMode}
            nextPath="/settings/privacy"
            title="Sign in to manage privacy"
            description="Privacy actions are scoped to your authenticated workspace."
          />
        </div>
      </div>
    );
  }

  const clearCurrentChat = async () => {
    setWorking("chat");
    try {
      await clearSession(sessionId);
      clearMessages();
      toast.success("Current chat history cleared");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to clear chat history");
    } finally {
      setWorking(null);
    }
  };

  const deleteAllDocuments = async () => {
    if (confirmation !== DELETE_CONFIRMATION) return;
    setWorking("documents");
    try {
      const response = await listDocuments();
      const result = await deleteDocumentsBestEffort(
        response.documents.map((document) => document.document_id),
        deleteDocument
      );
      const remaining = response.documents.filter(
        (document) => !result.deletedIds.includes(document.document_id)
      );
      setDocuments(remaining);
      setDocumentCount(remaining.length);
      if (result.failures.length === 0) {
        setConfirmation("");
        toast.success(
          `${result.deletedIds.length} document${result.deletedIds.length === 1 ? "" : "s"} deleted`
        );
      } else {
        toast.error(
          `${result.deletedIds.length} deleted; ${result.failures.length} could not be deleted.`
        );
      }
    } catch (error) {
      toast.error(
        error instanceof Error
          ? `Document cleanup stopped: ${error.message}`
          : "Unable to delete workspace documents"
      );
    } finally {
      setWorking(null);
    }
  };

  const canDeleteDocuments = role === "owner" || role === "admin";

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-4 py-6 md:px-6 md:py-8">
        <Link
          href="/settings"
          className="mb-5 inline-flex items-center gap-2 text-sm font-semibold text-[var(--text-muted)] hover:text-[var(--text-primary)]"
        >
          <ArrowLeft size={15} />
          Settings
        </Link>

        <div className="mb-6 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
            <ShieldCheck size={20} />
          </span>
          <div>
            <h2 className="text-lg font-bold">Privacy & Data Controls</h2>
            <p className="text-sm text-[var(--text-muted)]">
              Review and remove workspace-scoped data.
            </p>
          </div>
        </div>

        <div className="space-y-4">
          <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold">Current chat history</p>
                <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">
                  Clears the active session from this device and durable workspace message storage.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void clearCurrentChat()}
                disabled={working !== null}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-semibold hover:bg-[var(--bg-hover)] disabled:opacity-50"
              >
                {working === "chat" ? <Loader2 size={15} className="animate-spin" /> : <Eraser size={15} />}
                Clear chat
              </button>
            </div>
          </section>

          <section className="rounded-xl border border-red-300 bg-red-50/70 p-4 dark:border-red-900 dark:bg-red-950/20">
            <div className="flex items-start gap-3">
              <Trash2 size={18} className="mt-0.5 shrink-0 text-red-600 dark:text-red-300" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-red-800 dark:text-red-200">Danger zone</p>
                <p className="mt-1 text-xs leading-5 text-red-700 dark:text-red-300">
                  Delete all {documentCount} indexed workspace document{documentCount === 1 ? "" : "s"}.
                  This removes document metadata, chunks, and vectors through the protected document API.
                </p>
                {canDeleteDocuments ? (
                  <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
                    <label htmlFor="delete-documents-confirmation" className="sr-only">
                      Confirm deletion of all workspace documents
                    </label>
                    <input
                      id="delete-documents-confirmation"
                      value={confirmation}
                      onChange={(event) => setConfirmation(event.target.value)}
                      placeholder={`Type ${DELETE_CONFIRMATION}`}
                      className="min-w-0 rounded-lg border border-red-300 bg-white px-3 py-2 text-sm outline-none focus:border-red-500 dark:border-red-900 dark:bg-red-950/30"
                    />
                    <button
                      type="button"
                      onClick={() => void deleteAllDocuments()}
                      disabled={
                        confirmation !== DELETE_CONFIRMATION ||
                        documentCount === 0 ||
                        working !== null
                      }
                      className="inline-flex items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-50"
                    >
                      {working === "documents" ? (
                        <Loader2 size={15} className="animate-spin" />
                      ) : (
                        <Trash2 size={15} />
                      )}
                      Delete all
                    </button>
                  </div>
                ) : (
                  <p className="mt-3 text-xs font-semibold text-red-700 dark:text-red-300">
                    Only workspace owners and administrators can perform this action.
                  </p>
                )}
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
