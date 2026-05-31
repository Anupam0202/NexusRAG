"use client";

import { useCallback, useEffect, useState } from "react";
import {
  getIngestionJob,
  listDocuments,
  uploadDocument,
  deleteDocument,
} from "@/lib/api";
import { useStore } from "@/hooks/useStore";
import type { DocumentListResponse } from "@/types";

function getErrorMessage(err: unknown, fallback: string) {
  return err instanceof Error ? err.message : fallback;
}

type RefreshOptions = {
  suppressError?: boolean;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function useDocuments() {
  const { documents, setDocuments, addDocument, removeDocument } = useStore();
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (
    options: RefreshOptions = {}
  ): Promise<DocumentListResponse | null> => {
    setLoading(true);
    try {
      const resp = await listDocuments();
      setDocuments(resp.documents);
      setError(null);
      return resp;
    } catch (err: unknown) {
      if (!options.suppressError) {
        setError(getErrorMessage(err, "Failed to load documents"));
      }
      return null;
    } finally {
      setLoading(false);
    }
  }, [setDocuments]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const upload = useCallback(
    async (file: File) => {
      setUploading(true);
      setError(null);
      try {
        const resp = await uploadDocument(file);
        if (resp.success && resp.document) {
          addDocument(resp.document);
          if (resp.job_id && resp.job?.status !== "completed") {
            for (let attempt = 0; attempt < 30; attempt++) {
              await sleep(1000);
              const job = await getIngestionJob(resp.job_id);
              if (job.document) {
                addDocument(job.document);
              }
              if (job.status === "completed") break;
              if (job.status === "failed") {
                throw new Error(job.error_message || "Ingestion failed");
              }
            }
          }
          await refresh({ suppressError: true });
          setError(null);
        }
        return resp;
      } catch (err: unknown) {
        const resp = await refresh({ suppressError: true });
        const uploaded = resp?.documents.find(
          (doc) =>
            doc.filename === file.name ||
            doc.filename === file.name.replace(/\s+/g, "_")
        );
        if (uploaded) {
          setError(null);
          return {
            success: true,
            message: `${uploaded.filename} uploaded successfully`,
            document: uploaded,
          };
        } else {
          setError(getErrorMessage(err, "Upload failed"));
        }
        throw err;
      } finally {
        setUploading(false);
      }
    },
    [addDocument, refresh]
  );

  const remove = useCallback(
    async (filename: string) => {
      try {
        await deleteDocument(filename);
        removeDocument(filename);
      } catch (err: unknown) {
        setError(getErrorMessage(err, "Delete failed"));
      }
    },
    [removeDocument]
  );

  return { documents, loading, uploading, error, refresh, upload, remove };
}
