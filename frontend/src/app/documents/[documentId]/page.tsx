"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Calendar,
  CheckCircle2,
  Clock3,
  Database,
  FileText,
  HardDrive,
  Hash,
  Loader2,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { DocumentChunksExplorer } from "@/components/documents/DocumentChunksExplorer";
import {
  deleteDocument,
  getDocumentIngestionStatus,
  listDocuments,
} from "@/lib/api";
import { cn, formatBytes, timeAgo } from "@/lib/utils";
import { useStore } from "@/hooks/useStore";
import type { DocumentMetadata, IngestionJobStatusResponse } from "@/types";

type LoadState = "loading" | "ready" | "not_found" | "error";

function readParam(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return "";
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function formatDate(value?: string | null) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function documentStatusTone(status?: DocumentMetadata["status"]) {
  if (status === "ready") {
    return "border-green-200 bg-green-50 text-green-700 dark:border-green-900/60 dark:bg-green-900/20 dark:text-green-300";
  }
  if (status === "error") {
    return "border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-900/20 dark:text-red-300";
  }
  return "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-900/20 dark:text-amber-300";
}

function jobStatusTone(status?: IngestionJobStatusResponse["status"]) {
  if (status === "completed") {
    return "border-green-200 bg-green-50 text-green-700 dark:border-green-900/60 dark:bg-green-900/20 dark:text-green-300";
  }
  if (status === "failed" || status === "cancelled") {
    return "border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-900/20 dark:text-red-300";
  }
  return "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/60 dark:bg-blue-900/20 dark:text-blue-300";
}

export default function DocumentDetailPage() {
  const params = useParams();
  const router = useRouter();
  const documentId = readParam(params.documentId);
  const setDocuments = useStore((state) => state.setDocuments);
  const removeDocument = useStore((state) => state.removeDocument);

  const [document, setDocument] = useState<DocumentMetadata | null>(null);
  const [job, setJob] = useState<IngestionJobStatusResponse | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const loadDocument = useCallback(async () => {
    if (!documentId) {
      setLoadState("not_found");
      return;
    }

    setRefreshing(true);
    setError(null);
    try {
      let nextDocument: DocumentMetadata | null = null;
      let nextJob: IngestionJobStatusResponse | null = null;
      let documentsError: unknown = null;

      try {
        const response = await listDocuments();
        setDocuments(response.documents);
        nextDocument = response.documents.find((item) => item.document_id === documentId) ?? null;
      } catch (err: unknown) {
        documentsError = err;
      }

      if (!nextDocument || nextDocument.status !== "ready") {
        try {
          nextJob = await getDocumentIngestionStatus(documentId);
          if (nextJob.document) {
            nextDocument = nextJob.document;
          }
        } catch {
          if (!nextDocument && documentsError) {
            throw documentsError;
          }
          if (!nextDocument) {
            setJob(null);
            setDocument(null);
            setLoadState("not_found");
            return;
          }
        }
      }

      setJob(nextJob);
      setDocument(nextDocument);

      if (nextDocument) {
        setLoadState("ready");
      } else {
        setLoadState("not_found");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unable to load document details");
      setLoadState("error");
    } finally {
      setRefreshing(false);
    }
  }, [documentId, setDocuments]);

  useEffect(() => {
    void loadDocument();
  }, [loadDocument]);

  const metadata = useMemo(() => {
    if (!document) return [];
    return [
      { label: "File type", value: document.file_type || "unknown", icon: FileText },
      { label: "File size", value: formatBytes(document.file_size_bytes), icon: HardDrive },
      { label: "Pages", value: document.page_count || "-", icon: Hash },
      { label: "Chunks", value: document.chunk_count, icon: Database },
      { label: "Created", value: timeAgo(document.created_at), icon: Calendar },
      {
        label: "Processing",
        value: document.processing_time_seconds
          ? `${document.processing_time_seconds.toFixed(2)}s`
          : "-",
        icon: Clock3,
      },
    ];
  }, [document]);

  const progress = job?.progress ?? (document?.status === "ready" ? 100 : 0);

  const handleDelete = async () => {
    if (!document) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteDocument(document.filename);
      removeDocument(document.filename);
      router.push("/documents");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unable to delete document");
      setDeleting(false);
    }
  };

  if (loadState === "loading") {
    return (
      <div className="flex h-full items-center justify-center px-4 text-sm text-[var(--text-muted)]">
        <Loader2 size={18} className="mr-2 animate-spin" />
        Loading document
      </div>
    );
  }

  if (loadState === "not_found") {
    return (
      <div className="flex h-full items-center justify-center px-4">
        <div className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-amber-100 text-amber-600 dark:bg-amber-900/20 dark:text-amber-300">
            <AlertTriangle size={22} />
          </div>
          <h2 className="text-base font-bold">Document not found</h2>
          <p className="mt-2 text-sm text-[var(--text-muted)]">
            This document may have been deleted, or it may belong to a different workspace.
          </p>
          <Link
            href="/documents"
            className="mt-5 inline-flex items-center gap-2 rounded-xl border border-[var(--border)] px-4 py-2 text-sm font-semibold hover:bg-[var(--bg-hover)]"
          >
            <ArrowLeft size={15} />
            Back to documents
          </Link>
        </div>
      </div>
    );
  }

  if (loadState === "error" || !document) {
    return (
      <div className="flex h-full items-center justify-center px-4">
        <div className="w-full max-w-md rounded-xl border border-red-300 bg-red-50 p-5 text-center text-red-700 dark:border-red-900/60 dark:bg-red-900/20 dark:text-red-300">
          <AlertTriangle size={24} className="mx-auto mb-3" />
          <h2 className="text-base font-bold">Unable to load document</h2>
          <p className="mt-2 text-sm">{error}</p>
          <button
            type="button"
            onClick={() => void loadDocument()}
            className="mt-5 inline-flex items-center gap-2 rounded-xl border border-red-300 px-4 py-2 text-sm font-semibold hover:bg-red-100 dark:border-red-800 dark:hover:bg-red-900/30"
          >
            <RefreshCw size={15} />
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-6xl flex-col gap-5 px-4 py-5 sm:px-6 sm:py-7">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Link
            href="/documents"
            className="inline-flex w-fit items-center gap-2 rounded-xl border border-[var(--border)] px-3 py-2 text-sm font-semibold text-[var(--text-secondary)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
          >
            <ArrowLeft size={15} />
            Documents
          </Link>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void loadDocument()}
              disabled={refreshing}
              className="inline-flex items-center gap-2 rounded-xl border border-[var(--border)] px-3 py-2 text-sm font-semibold text-[var(--text-secondary)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:opacity-50"
            >
              <RefreshCw size={15} className={cn(refreshing && "animate-spin")} />
              Refresh
            </button>
            <button
              type="button"
              onClick={() => void handleDelete()}
              disabled={deleting}
              className="inline-flex items-center gap-2 rounded-xl border border-red-200 px-3 py-2 text-sm font-semibold text-red-600 transition hover:bg-red-50 disabled:opacity-50 dark:border-red-900/60 dark:text-red-300 dark:hover:bg-red-900/20"
            >
              {deleting ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
              Delete
            </button>
          </div>
        </div>

        {error && (
          <div className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
            {error}
          </div>
        )}

        <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4 sm:p-5">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0">
              <div className="flex min-w-0 items-start gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-100 text-brand-600 dark:bg-brand-900/30 dark:text-brand-300">
                  <FileText size={22} />
                </div>
                <div className="min-w-0">
                  <h2 className="break-words text-lg font-bold tracking-tight sm:text-xl">
                    {document.filename}
                  </h2>
                  <p className="mt-1 break-all text-xs text-[var(--text-muted)]">
                    ID: <span className="font-mono">{document.document_id}</span>
                  </p>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase",
                  documentStatusTone(document.status)
                )}
              >
                {document.status === "ready" && <CheckCircle2 size={12} />}
                {document.status}
              </span>
              {job && (
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase",
                    jobStatusTone(job.status)
                  )}
                >
                  <Activity size={12} />
                  {job.status}
                </span>
              )}
            </div>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {metadata.map((item) => {
              const Icon = item.icon;
              return (
                <div
                  key={item.label}
                  className="flex min-w-0 items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] px-3 py-3"
                >
                  <Icon size={16} className="shrink-0 text-brand-500" />
                  <div className="min-w-0">
                    <p className="text-[10px] font-semibold uppercase text-[var(--text-muted)]">
                      {item.label}
                    </p>
                    <p className="truncate text-sm font-semibold">{item.value}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4 sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h3 className="text-base font-bold">Ingestion status</h3>
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                {job?.message || "Document is indexed and available for retrieval."}
              </p>
            </div>
            <div className="text-left text-xs text-[var(--text-muted)] sm:text-right">
              <p>Created: {formatDate(job?.created_at || document.created_at)}</p>
              <p>Updated: {formatDate(job?.updated_at || document.created_at)}</p>
            </div>
          </div>

          <div className="mt-4">
            <div className="mb-1 flex items-center justify-between text-xs font-medium text-[var(--text-muted)]">
              <span>{job?.stage || document.extraction_method || "indexed"}</span>
              <span>{Math.round(progress)}%</span>
            </div>
            <div className="h-2 rounded-full bg-[var(--bg-secondary)]">
              <div
                className={cn(
                  "h-full rounded-full transition-all",
                  job?.status === "failed" ? "bg-red-500" : "bg-brand-500"
                )}
                style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
              />
            </div>
          </div>

          {job?.error_message && (
            <div className="mt-4 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
              {job.error_message}
            </div>
          )}
        </section>

        <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4 sm:p-5">
          <div className="mb-4">
            <h3 className="text-base font-bold">Indexed chunks</h3>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              Search the exact text NexusRAG indexed from this document before asking the chatbot.
            </p>
          </div>
          <DocumentChunksExplorer
            documentId={document.document_id}
            expectedChunkCount={document.chunk_count}
            limit={80}
          />
        </section>
      </div>
    </div>
  );
}
