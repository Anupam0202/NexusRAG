"use client";

import { useCallback, useEffect, useState } from "react";
import {
  listDocuments,
  uploadDocument,
  deleteDocument,
} from "@/lib/api";
import { useStore } from "@/hooks/useStore";
import type { DocumentMetadata } from "@/types";

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
    } catch (err: any) {
      setError(err.message);
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
      } catch (err: any) {
        setError(err.message);
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
      } catch (err: any) {
        setError(err.message);
      }
    },
    [removeDocument]
  );

  return { documents, loading, uploading, error, refresh, upload, remove };
}