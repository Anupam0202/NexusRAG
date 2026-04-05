"use client";

import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import { Upload, CheckCircle2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DocumentUploadResponse } from "@/types";
import { toast } from "sonner";

const ACCEPTED: Record<string, string[]> = {
  "application/pdf": [".pdf"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
  "application/vnd.ms-excel": [".xls"],
  "text/csv": [".csv"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
  "text/plain": [".txt"],
  "text/markdown": [".md"],
  "application/json": [".json"],
  "image/png": [".png"],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/gif": [".gif"],
  "image/webp": [".webp"],
  "image/bmp": [".bmp"],
  "image/tiff": [".tiff"],
};

interface Props {
  onUpload: (file: File) => Promise<DocumentUploadResponse>;
  uploading: boolean;
}

export function UploadZone({ onUpload, uploading }: Props) {
  const [status, setStatus] = useState<"idle" | "success" | "error">("idle");

  const onDrop = useCallback(async (files: File[]) => {
    for (const file of files) {
      try {
        setStatus("idle");
        const resp = await onUpload(file);
        if (resp.success) {
          setStatus("success");
          toast.success(`${file.name} — ${resp.document?.chunk_count} chunks created`);
        } else {
          setStatus("error");
          toast.error(resp.message);
        }
      } catch (err: any) {
        setStatus("error");
        toast.error(err.message);
      }
    }
  }, [onUpload]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: ACCEPTED,
    maxSize: 100 * 1024 * 1024,
    disabled: uploading,
  });

  return (
    <div
      {...getRootProps()}
      className={cn(
        "relative flex flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-10 md:py-14 transition-all cursor-pointer",
        isDragActive
          ? "border-brand-500 bg-brand-50 dark:bg-brand-900/20 scale-[1.01]"
          : "border-[var(--border)] bg-[var(--bg-secondary)] hover:border-brand-400 upload-zone-idle",
        uploading && "opacity-60 pointer-events-none"
      )}
    >
      <input {...getInputProps()} />
      {uploading ? (
        <>
          <div className="h-10 w-10 rounded-full border-4 border-brand-500 border-t-transparent animate-spin mb-3" />
          <p className="text-sm font-medium">Processing…</p>
        </>
      ) : (
        <>
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-100 dark:bg-brand-900/30 mb-3">
            {status === "success" ? (
              <CheckCircle2 className="text-green-500" size={24} />
            ) : status === "error" ? (
              <AlertCircle className="text-red-500" size={24} />
            ) : (
              <Upload className="text-brand-500" size={24} />
            )}
          </div>
          <p className="text-sm font-semibold mb-1 text-center">
            {isDragActive ? "Drop files here" : "Drag & drop files, or tap to browse"}
          </p>
          <p className="text-xs text-[var(--text-muted)] text-center">
            PDF · DOCX · Excel · CSV · TXT · MD · JSON · Images — up to 100 MB
          </p>
        </>
      )}
    </div>
  );
}