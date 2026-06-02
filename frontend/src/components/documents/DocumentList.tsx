"use client";

import Link from "next/link";
import type { DocumentMetadata } from "@/types";
import { motion } from "framer-motion";
import { ExternalLink, Eye, RefreshCw, Trash2, FileText } from "lucide-react";
import { cn, formatBytes, fileIcon } from "@/lib/utils";

interface Props {
  documents: DocumentMetadata[];
  loading: boolean;
  onDelete: (documentId: string) => void;
  onReindex: (documentId: string) => void;
  onRefresh: () => void;
  onSelect: (document: DocumentMetadata) => void;
  disabledReason?: string;
}

export function DocumentList({
  documents,
  loading,
  onDelete,
  onReindex,
  onRefresh,
  onSelect,
  disabledReason,
}: Props) {
  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-semibold">
          Document Library
          <span className="text-sm font-normal text-[var(--text-muted)] ml-1">({documents.length})</span>
        </h2>
        <button
          onClick={onRefresh}
          disabled={loading || Boolean(disabledReason)}
          className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium hover:bg-[var(--bg-hover)] transition disabled:opacity-50"
        >
          <RefreshCw size={13} className={cn(loading && "animate-spin")} />
          Refresh
        </button>
      </div>

      {loading && documents.length === 0 ? (
        <DocumentSkeleton />
      ) : disabledReason ? (
        <div className="flex flex-col items-center py-16 text-center text-[var(--text-muted)]">
          <FileText size={40} className="mb-3 opacity-30" />
          <p className="font-medium text-sm">{disabledReason}</p>
          <p className="text-xs">Sign in to view and manage indexed files.</p>
        </div>
      ) : documents.length === 0 ? (
        <div className="flex flex-col items-center py-16 text-[var(--text-muted)]">
          <FileText size={40} className="mb-3 opacity-30" />
          <p className="font-medium text-sm">No documents yet</p>
          <p className="text-xs">Upload files above to get started</p>
        </div>
      ) : (
        <div className="space-y-2">
          {documents.map((doc, i) => (
            <motion.article
              key={doc.document_id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05, duration: 0.3 }}
              className="group flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2.5 transition hover:shadow-md md:px-4 md:py-3"
            >
              <button
                type="button"
                onClick={() => onSelect(doc)}
                className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left focus:outline-none focus:ring-2 focus:ring-brand-500/50"
                aria-label={`Preview ${doc.filename}`}
              >
                <span className="text-xl md:text-2xl shrink-0">{fileIcon(doc.filename)}</span>
                <div className="flex-1 min-w-0">
                  <p className="truncate text-sm font-semibold">{doc.filename}</p>
                  <p className="text-xs text-[var(--text-muted)]">
                    {doc.chunk_count} chunks
                    {doc.file_size_bytes > 0 && ` - ${formatBytes(doc.file_size_bytes)}`}
                  </p>
                </div>
                <span className={cn(
                  "hidden rounded-full px-2 py-0.5 text-[10px] font-bold uppercase sm:inline-block",
                  doc.status === "ready"
                    ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300"
                    : "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700"
                )}>
                  {doc.status}
                </span>
                <span className="hidden rounded-lg p-2 text-[var(--text-muted)] sm:inline-flex">
                  <Eye size={15} />
                </span>
              </button>
              <Link
                href={`/documents/${encodeURIComponent(doc.document_id)}`}
                aria-label={`Open details page for ${doc.filename}`}
                title="Open full details"
                className="rounded-lg p-2 text-[var(--text-muted)] transition hover:bg-[var(--bg-hover)] hover:text-brand-500 shrink-0"
              >
                <ExternalLink size={15} />
              </Link>
              <button
                onClick={(event) => {
                  event.stopPropagation();
                  onReindex(doc.document_id);
                }}
                aria-label={`Re-index ${doc.filename}`}
                title="Re-index"
                className="rounded-lg p-2 text-[var(--text-muted)] transition hover:bg-[var(--bg-hover)] hover:text-brand-500 shrink-0"
              >
                <RefreshCw size={15} />
              </button>
              <button
                onClick={(event) => {
                  event.stopPropagation();
                  onDelete(doc.document_id);
                }}
                aria-label={`Delete ${doc.filename}`}
                className="rounded-lg p-2 text-[var(--text-muted)] hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-all shrink-0"
              >
                <Trash2 size={15} />
              </button>
            </motion.article>
          ))}
        </div>
      )}

      {documents.length > 0 && (
        <div className="mt-6 grid grid-cols-2 md:grid-cols-3 gap-3">
          <StatCard label="Documents" value={documents.length} variant="docs" />
          <StatCard label="Total Chunks" value={documents.reduce((s, d) => s + d.chunk_count, 0)} variant="chunks" />
          <StatCard
            label="Total Size"
            value={formatBytes(documents.reduce((s, d) => s + d.file_size_bytes, 0))}
            variant="size"
          />
        </div>
      )}
    </section>
  );
}

function StatCard({ label, value, variant }: { label: string; value: string | number; variant: "docs" | "chunks" | "size" }) {
  return (
    <div className={`stat-card-${variant} rounded-xl p-3 md:p-4 text-white text-center shadow-lg hover:shadow-xl hover:-translate-y-0.5 transition-all duration-200`}>
      <p className="text-xl md:text-2xl font-bold">{value}</p>
      <p className="text-[11px] opacity-80">{label}</p>
    </div>
  );
}

function DocumentSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2.5 md:px-4 md:py-3 animate-pulse"
        >
          <div className="h-8 w-8 rounded-lg bg-[var(--bg-secondary)]" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-3/4 rounded bg-[var(--bg-secondary)]" />
            <div className="h-3 w-1/2 rounded bg-[var(--bg-secondary)]" />
          </div>
          <div className="h-5 w-14 rounded-full bg-[var(--bg-secondary)] hidden sm:block" />
        </div>
      ))}
    </div>
  );
}
