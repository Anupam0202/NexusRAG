"use client";

import { useCallback, useEffect, useState } from "react";
import {
  listDocuments,
  uploadDocument,
  deleteDocument,
} from "@/lib/api";
import { useStore } from "@/hooks/useStore";

function getErrorMessage(err: unknown, fallback: string) {
  return err instanceof Error ? err.message : fallback;
}

export function useDocuments() {
  const { documents, setDocuments, addDocument, removeDocument } = useStore();
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await listDocuments();
      setDocuments(resp.documents);
      setError(null);
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Failed to load documents"));
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
        }
        return resp;
      } catch (err: unknown) {
        setError(getErrorMessage(err, "Upload failed"));
        throw err;
      } finally {
        setUploading(false);
      }
    },
    [addDocument]
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
