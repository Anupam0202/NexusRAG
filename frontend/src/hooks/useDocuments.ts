"use client";

import { useCallback, useEffect, useState } from "react";
import {
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
