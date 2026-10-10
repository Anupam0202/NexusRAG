"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiRequestError, getCurrentWorkspace, getIngestionJob, listDocuments, uploadDocument, deleteDocument, reindexDocument } from "@/lib/api";
import { useStore } from "@/hooks/useStore";
import { canUseWorkspaceApi } from "@/hooks/useAuthGate";
import type { DocumentListResponse } from "@/types";

type RefreshOptions = { suppressError?: boolean };
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const message = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback;

export function useDocuments() {
  const documents = useStore(state => state.documents);
  const authMode = useStore(state => state.authMode);
  const userId = useStore(state => state.authUser?.id);
  const workspaceId = useStore(state => state.workspaceId);
  const setDocuments = useStore(state => state.setDocuments);
  const addDocument = useStore(state => state.addDocument);
  const removeDocument = useStore(state => state.removeDocument);
  const setIsQuotaBlocked = useStore(state => state.setIsQuotaBlocked);
  const setShowApiKeyModal = useStore(state => state.setShowApiKeyModal);
  const canAccessWorkspaceApi = canUseWorkspaceApi(authMode) && (authMode !== "authenticated" || !!workspaceId);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const identity = JSON.stringify([authMode, userId, workspaceId]);
  const [permission, setPermission] = useState<{ identity: string; access: "checking" | "allowed" | "viewer" | "unavailable" }>({ identity, access: "checking" });
  const mutationAccess = permission.identity === identity ? permission.access : "checking";
  const canMutate = canAccessWorkspaceApi && mutationAccess === "allowed";
  const mutationDisabledReason = !canAccessWorkspaceApi ? undefined
    : mutationAccess === "viewer" ? "Viewer access: you can inspect documents, but cannot upload, delete or re-index."
    : mutationAccess === "checking" ? "Checking document edit permissions..."
    : mutationAccess === "unavailable" ? "Document edit permissions could not be verified. Refresh to retry."
    : undefined;
  const alive = useRef(true);
  const refreshSequence = useRef(0);
  const authoritySequence = useRef(0);
  const uploadPending = useRef(false);
  useEffect(() => { const counter = refreshSequence; alive.current = true; return () => { alive.current = false; counter.current++; }; }, []);
  const isCurrent = useCallback(() => {
    const current = useStore.getState();
    return alive.current && current.authMode === authMode && current.authUser?.id === userId && current.workspaceId === workspaceId;
  }, [authMode, userId, workspaceId]);
  const context = useCallback(() => ({ workspaceId, expectedUserId: authMode === "authenticated" ? userId ?? null : undefined }), [authMode, userId, workspaceId]);
  const checkMutationAuthority = useCallback(async () => {
    const sequence = ++authoritySequence.current;
    try {
      const authority = await getCurrentWorkspace(context());
      if (!isCurrent()) throw new Error("Your account or workspace changed. Try again in the current workspace.");
      if (sequence !== authoritySequence.current) return "unavailable";
      const matches = authMode === "demo" || (authority.workspace_id === workspaceId && authority.user_id === userId);
      const access = !matches || !["owner", "admin", "editor", "viewer"].includes(authority.role)
        ? "unavailable" : authority.role === "viewer" ? "viewer" : "allowed";
      setPermission({ identity, access });
      return access;
    } catch (error) {
      if (isCurrent() && sequence === authoritySequence.current) setPermission({ identity, access: "unavailable" });
      throw error;
    }
  }, [authMode, context, identity, isCurrent, userId, workspaceId]);
  const requireMutationAuthority = useCallback(async () => {
    const access = await checkMutationAuthority();
    if (access !== "allowed") throw new Error(access === "viewer"
      ? "Viewer access does not permit document changes."
      : "Document edit permissions could not be verified.");
  }, [checkMutationAuthority]);

  const refresh = useCallback(async (options: RefreshOptions = {}): Promise<DocumentListResponse | null> => {
    if (!canAccessWorkspaceApi || !isCurrent()) return null;
    const sequence = ++refreshSequence.current;
    setLoading(true);
    setPermission({ identity, access: "checking" });
    // Read access does not depend on a successful role lookup. Mutations do.
    void checkMutationAuthority().catch(() => {});
    try {
      const response = await listDocuments(context());
      if (!isCurrent() || sequence !== refreshSequence.current) return null;
      setDocuments(response.documents); setError(null); return response;
    } catch (error) {
      if (isCurrent() && sequence === refreshSequence.current && !options.suppressError) setError(message(error, "Failed to load documents"));
      return null;
    } finally { if (isCurrent() && sequence === refreshSequence.current) setLoading(false); }
  }, [canAccessWorkspaceApi, checkMutationAuthority, context, identity, isCurrent, setDocuments]);

  useEffect(() => {
    refreshSequence.current++; uploadPending.current = false;
    setLoading(false); setUploading(false); setError(null);
    if (canAccessWorkspaceApi) void refresh();
  }, [canAccessWorkspaceApi, refresh]);

  const poll = useCallback(async (jobId: string) => {
    for (let attempt = 0; attempt < 30; attempt++) {
      await sleep(1000);
      if (!isCurrent()) return;
      const job = await getIngestionJob(jobId, context());
      if (!isCurrent()) return;
      if (job.document) addDocument(job.document);
      if (job.status === "completed") return true;
      if (job.status === "failed" || job.status === "cancelled") throw new Error(job.error_message || `Ingestion ${job.status}`);
    }
    // Bounded polling is not a completion receipt. Durable job remains visible.
    return false;
  }, [addDocument, context, isCurrent]);

  const upload = useCallback(async (file: File, classification: "non_sensitive") => {
    if (!canAccessWorkspaceApi || !isCurrent()) throw new Error("Sign in and select a workspace to upload documents.");
    if (uploadPending.current) throw new Error("An upload is already in progress.");
    uploadPending.current = true; setUploading(true); setError(null);
    try {
      await requireMutationAuthority();
      if (!isCurrent()) throw new Error("Your account or workspace changed.");
      const response = await uploadDocument(file, classification, context());
      if (!isCurrent()) return response;
      if (response.success && response.document) {
        addDocument(response.document);
        const completed = response.job_id && response.job?.status !== "completed" ? await poll(response.job_id) : true;
        if (isCurrent()) {
          await refresh({ suppressError: true });
          if (isCurrent() && completed === false) setError("Processing is still pending. Refresh the document status; do not upload a duplicate.");
        }
      }
      return response;
    } catch (error) {
      if (!isCurrent()) throw error;
      if (error instanceof ApiRequestError && error.code === "BYOK_REQUIRED") { setIsQuotaBlocked(true); setShowApiKeyModal(true); }
      // Do not turn an ambiguous failure into success by matching a filename.
      await refresh({ suppressError: true });
      if (isCurrent()) setError(message(error, "Upload failed; inspect document status before retrying."));
      throw error;
    } finally { if (isCurrent()) { uploadPending.current = false; setUploading(false); } }
  }, [addDocument, canAccessWorkspaceApi, context, isCurrent, poll, refresh, requireMutationAuthority, setIsQuotaBlocked, setShowApiKeyModal]);

  const remove = useCallback(async (documentId: string) => {
    if (!canAccessWorkspaceApi || !isCurrent()) return;
    try {
      await requireMutationAuthority();
      if (!isCurrent()) return;
      const result = await deleteDocument(documentId, context());
      if (!result.success) throw new Error(result.message || "Deletion is not complete.");
      if (isCurrent()) removeDocument(documentId);
    } catch (error) { if (isCurrent()) setError(message(error, "Delete failed")); }
  }, [canAccessWorkspaceApi, context, isCurrent, removeDocument, requireMutationAuthority]);

  const reindex = useCallback(async (documentId: string) => {
    if (!canAccessWorkspaceApi || !isCurrent()) return;
    setError(null);
    try {
      await requireMutationAuthority();
      if (!isCurrent()) return;
      const started = await reindexDocument(documentId, context());
      if (!isCurrent()) return;
      if (started.document) addDocument(started.document);
      const completed = await poll(started.job_id);
      if (isCurrent()) {
        await refresh({ suppressError: true });
        if (isCurrent() && completed === false) setError("Re-indexing is still pending. Refresh the document status; do not start a duplicate job.");
      }
    } catch (error) { if (isCurrent()) setError(message(error, "Re-index failed")); }
  }, [addDocument, canAccessWorkspaceApi, context, isCurrent, poll, refresh, requireMutationAuthority]);
  return { documents, loading, uploading, error, refresh, upload, remove, reindex, canAccessWorkspaceApi, canMutate, mutationDisabledReason, authMode };
}
