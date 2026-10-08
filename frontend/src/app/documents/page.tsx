"use client";

import { useEffect, useState } from "react";
import {
  DEFAULT_UPLOAD_LIMITS,
  UploadZone,
  type UploadLimits,
} from "@/components/documents/UploadZone";
import { DocumentList } from "@/components/documents/DocumentList";
import { DocumentDetailPanel } from "@/components/documents/DocumentDetailPanel";
import { useStore } from "@/hooks/useStore";
import { useDocuments } from "@/hooks/useDocuments";
import { getSystemStatus } from "@/lib/api";
import type { DocumentMetadata } from "@/types";

export default function DocumentsPage() {
  const identity = useStore(state => JSON.stringify([state.authMode, state.authUser?.id, state.workspaceId]));
  return <WorkspaceDocuments key={identity} />;
}
function WorkspaceDocuments() {
  const {
    documents,
    loading,
    uploading,
    error,
    upload,
    remove,
    reindex,
    refresh,
    canAccessWorkspaceApi,
    authMode,
  } = useDocuments();
  const [limits, setLimits] = useState<UploadLimits>(DEFAULT_UPLOAD_LIMITS);
  const [selectedDocument, setSelectedDocument] = useState<DocumentMetadata | null>(null);

  useEffect(() => {
    let active = true;
    getSystemStatus()
      .then((status) => {
        if (!active) return;
        const settings = status.settings;
        setLimits({
          maxUploadMb: Number(settings.max_upload_size_mb) || DEFAULT_UPLOAD_LIMITS.maxUploadMb,
          maxUploadBytes: Number(settings.max_upload_size_mb) > 0
            ? Number(settings.max_upload_size_mb) * 1_000_000
            : DEFAULT_UPLOAD_LIMITS.maxUploadBytes,
          maxPdfPages: Number(settings.max_pdf_pages) || DEFAULT_UPLOAD_LIMITS.maxPdfPages,
          maxPdfOcrPages:
            Number(settings.max_pdf_ocr_pages) || DEFAULT_UPLOAD_LIMITS.maxPdfOcrPages,
          maxImageMegapixels:
            Number(settings.max_image_megapixels) ||
            DEFAULT_UPLOAD_LIMITS.maxImageMegapixels,
          pdfEmbeddedImageOcr:
            typeof settings.enable_pdf_embedded_image_ocr === "boolean"
              ? settings.enable_pdf_embedded_image_ocr
              : DEFAULT_UPLOAD_LIMITS.pdfEmbeddedImageOcr,
          docxEmbeddedImageOcr:
            typeof settings.enable_docx_embedded_image_ocr === "boolean"
              ? settings.enable_docx_embedded_image_ocr
              : DEFAULT_UPLOAD_LIMITS.docxEmbeddedImageOcr,
        });
      })
      .catch(() => { if (active) setLimits(DEFAULT_UPLOAD_LIMITS); });
    return () => { active = false; };
  }, [authMode, canAccessWorkspaceApi]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6 sm:space-y-8">
        {/* Upload */}
        <UploadZone
          onUpload={upload}
          uploading={uploading}
          limits={limits}
          disabledReason={
            canAccessWorkspaceApi
              ? undefined
              : authMode === "loading"
                ? "Checking your session..."
                : "Sign in to upload documents"
          }
        />

        {error && (
          <div className="rounded-xl border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-4 py-3 text-sm text-red-700 dark:text-red-300">
            {error}
          </div>
        )}

        {/* Document list */}
        <DocumentList
          documents={documents}
          loading={loading}
          onDelete={remove}
          onReindex={reindex}
          onRefresh={refresh}
          onSelect={setSelectedDocument}
          disabledReason={
            canAccessWorkspaceApi
              ? undefined
              : authMode === "loading"
                ? "Checking your session..."
                : "Sign in to view documents"
          }
        />
      </div>
      <DocumentDetailPanel
        document={selectedDocument}
        onClose={() => setSelectedDocument(null)}
      />
    </div>
  );
}
