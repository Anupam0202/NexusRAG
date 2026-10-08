"use client";

import Link from "@/components/layout/StaticLink";
import { useEffect, useId, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { ExternalLink, FileText, X } from "lucide-react";
import { DocumentChunksExplorer } from "@/components/documents/DocumentChunksExplorer";
import { formatBytes } from "@/lib/utils";
import type { DocumentMetadata } from "@/types";

interface Props {
  document: DocumentMetadata | null;
  onClose: () => void;
}

export function DocumentDetailPanel({ document, onClose }: Props) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  const documentId = document?.document_id;
  useEffect(() => {
    if (!documentId || !dialogRef.current) return;
    const page = globalThis.document;
    const dialog = dialogRef.current;
    const previousFocus = page.activeElement instanceof HTMLElement ? page.activeElement : null;
    // The portal is a body child, so no ancestor containing the dialog is
    // disabled. Preserve pre-existing inert/scroll settings on dismissal.
    const background = Array.from(page.body.children)
      .filter((element): element is HTMLElement => element instanceof HTMLElement && element !== dialog);
    const inertStates = background.map(element => element.inert);
    const previousOverflow = page.body.style.overflow;
    background.forEach(element => { element.inert = true; });
    page.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const controls = () => Array.from(dialog.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]'
    )).filter(element => element.tabIndex >= 0 && !element.closest('[hidden], [inert], [aria-hidden="true"]')
      && getComputedStyle(element).display !== "none" && getComputedStyle(element).visibility !== "hidden")
      .sort((left, right) => left.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
    const focusInside = () => (closeRef.current ?? dialog).focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
      } else if (event.key === "Tab") {
        const items = controls(), first = items[0], last = items.at(-1);
        if (!first || !dialog.contains(page.activeElement)) {
          event.preventDefault();
          (event.shiftKey ? last : first)?.focus();
          if (!first) focusInside();
        } else if (event.shiftKey && page.activeElement === first) {
          event.preventDefault(); last?.focus();
        } else if (!event.shiftKey && page.activeElement === last) {
          event.preventDefault(); first.focus();
        }
      }
    };
    const containFocus = (event: FocusEvent) => {
      if (event.target instanceof Node && !dialog.contains(event.target)) focusInside();
    };
    page.addEventListener("keydown", trap, true);
    page.addEventListener("focusin", containFocus);
    return () => {
      page.removeEventListener("keydown", trap, true);
      page.removeEventListener("focusin", containFocus);
      background.forEach((element, index) => { element.inert = inertStates[index]; });
      page.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected && !previousFocus.closest("[inert]")) previousFocus.focus();
    };
  }, [documentId]);
  const metadata = useMemo<Array<[string, string | number]>>(() => {
    if (!document) return [];
    return [
      ["Type", document.file_type || "unknown"],
      ["Size", formatBytes(document.file_size_bytes)],
      ["Pages", document.page_count || "-"],
      ["Chunks", document.chunk_count],
      ["Extraction", document.extraction_method || "pipeline"],
    ];
  }, [document]);

  if (!document) return null;

  return createPortal(
    <div ref={dialogRef} tabIndex={-1} className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <button
        type="button"
        aria-label="Close document details"
        className="absolute inset-0 h-full w-full cursor-default"
        onClick={onClose}
        tabIndex={-1}
        aria-hidden="true"
      />
      <aside className="absolute right-0 top-0 flex h-full w-full max-w-2xl flex-col border-l border-[var(--border)] bg-[var(--bg-primary)] shadow-2xl">
        <div className="flex min-w-0 items-start justify-between gap-3 border-b border-[var(--border)] px-4 py-4 sm:px-5">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <FileText size={18} className="shrink-0 text-brand-500" />
              <h2 id={titleId} className="truncate text-base font-bold">{document.filename}</h2>
            </div>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              {document.chunk_count} indexed chunk{document.chunk_count === 1 ? "" : "s"}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Link
              href={`/documents/${encodeURIComponent(document.document_id)}`}
              onClick={onClose}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
              aria-label={`Open full details for ${document.filename}`}
              title="Open full details"
            >
              <ExternalLink size={15} />
            </Link>
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 border-b border-[var(--border)] px-4 py-3 sm:grid-cols-5 sm:px-5">
          {metadata.map(([label, value]) => (
            <div key={label} className="min-w-0 rounded-lg bg-[var(--bg-secondary)] px-3 py-2">
              <p className="truncate text-[10px] font-medium uppercase text-[var(--text-muted)]">{label}</p>
              <p className="mt-0.5 truncate text-xs font-semibold">{value}</p>
            </div>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
          <DocumentChunksExplorer
            documentId={document.document_id}
            expectedChunkCount={document.chunk_count}
          />
        </div>
      </aside>
    </div>,
    globalThis.document.body
  );
}
