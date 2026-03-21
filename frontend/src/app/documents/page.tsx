"use client";

import { UploadZone } from "@/components/documents/UploadZone";
import { DocumentList } from "@/components/documents/DocumentList";
import { useDocuments } from "@/hooks/useDocuments";

export default function DocumentsPage() {
  const { documents, loading, uploading, error, upload, remove, refresh } =
    useDocuments();

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6 sm:space-y-8">
        {/* Upload */}
        <UploadZone onUpload={upload} uploading={uploading} />

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
          onRefresh={refresh}
        />
      </div>
    </div>
  );
}