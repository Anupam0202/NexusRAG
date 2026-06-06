"use client";

import { useCallback, useEffect, useState } from "react";
import { useDropzone, type FileRejection } from "react-dropzone";
import { AlertCircle, CheckCircle2, FileUp, Upload } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { DocumentUploadResponse } from "@/types";

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
  "image/tiff": [".tif", ".tiff"],
};

const ACCEPTED_SUMMARY = "PDF, DOCX, XLSX, CSV, TXT, MD, JSON, PNG/JPG/TIFF";
const MAX_FILES_PER_DROP = 8;

export interface UploadLimits {
  maxUploadMb: number;
  maxPdfPages: number;
  maxPdfOcrPages: number;
  maxImageMegapixels: number;
  pdfEmbeddedImageOcr: boolean;
  docxEmbeddedImageOcr: boolean;
}

export const DEFAULT_UPLOAD_LIMITS: UploadLimits = {
  maxUploadMb: 100,
  maxPdfPages: 40,
  maxPdfOcrPages: 12,
  maxImageMegapixels: 25,
  pdfEmbeddedImageOcr: true,
  docxEmbeddedImageOcr: true,
};

interface Props {
  onUpload: (file: File) => Promise<DocumentUploadResponse>;
  uploading: boolean;
  limits: UploadLimits;
  disabledReason?: string;
}

export function UploadZone({ onUpload, uploading, limits, disabledReason }: Props) {
  const [status, setStatus] = useState<"idle" | "success" | "error">("idle");
  const [mounted, setMounted] = useState(false);
  const disabled = uploading || Boolean(disabledReason);

  useEffect(() => {
    setMounted(true);
  }, []);

  const onDrop = useCallback(
    async (files: File[]) => {
      for (const file of files) {
        try {
          setStatus("idle");
          const resp = await onUpload(file);
          if (resp.success) {
            setStatus("success");
            const chunkCount = resp.document?.chunk_count ?? 0;
            toast.success(
              resp.job_id && resp.job?.status !== "completed"
                ? `${file.name} queued for indexing`
                : `${file.name} - ${chunkCount} chunks created`
            );
          } else {
            setStatus("error");
            toast.error(resp.message);
          }
        } catch (err: unknown) {
          setStatus("error");
          toast.error(err instanceof Error ? err.message : "Upload failed");
        }
      }
    },
    [onUpload]
  );

  const onDropRejected = useCallback((rejections: FileRejection[]) => {
    setStatus("error");
    const firstError = rejections[0]?.errors[0];
    if (firstError?.code === "file-invalid-type") {
      toast.error(`Unsupported file type. Use ${ACCEPTED_SUMMARY}.`);
    } else if (firstError?.code === "too-many-files") {
      toast.error(`Upload up to ${MAX_FILES_PER_DROP} files at once.`);
    } else {
      toast.error(`File is too large. Upload limit is ${limits.maxUploadMb} MB.`);
    }
  }, [limits.maxUploadMb]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    onDropRejected,
    accept: ACCEPTED,
    maxFiles: MAX_FILES_PER_DROP,
    maxSize: limits.maxUploadMb * 1024 * 1024,
    multiple: true,
    disabled,
    useFsAccessApi: false,
  });

  return (
    <div
      {...getRootProps({ "aria-disabled": disabled })}
      className={cn(
        "relative flex flex-col items-center justify-center rounded-xl border border-dashed px-4 py-6 sm:py-7 md:py-8 transition-all cursor-pointer",
        isDragActive
          ? "border-brand-500 bg-brand-50 dark:bg-brand-900/20"
          : "border-[var(--border)] bg-[var(--bg-secondary)] hover:border-brand-400 upload-zone-idle",
        disabled && "cursor-not-allowed opacity-65"
      )}
    >
      {mounted && (
        <input
          {...getInputProps({
            "aria-label": "Upload NexusRAG documents",
            autoComplete: "off",
            disabled,
          })}
        />
      )}
      {disabledReason ? (
        <>
          <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-brand-100 dark:bg-brand-900/30">
            <AlertCircle className="text-brand-500" size={24} />
          </div>
          <p className="text-center text-sm font-semibold">{disabledReason}</p>
          <p className="mt-2 max-w-md text-center text-xs leading-5 text-[var(--text-muted)]">
            Your document library is protected by workspace authentication.
          </p>
        </>
      ) : uploading ? (
        <>
          <div className="h-10 w-10 rounded-full border-4 border-brand-500 border-t-transparent animate-spin mb-3" />
          <p className="text-sm font-medium">Processing...</p>
        </>
      ) : (
        <>
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-100 dark:bg-brand-900/30 mb-3">
            {status === "success" ? (
              <CheckCircle2 className="text-green-500" size={24} />
            ) : status === "error" ? (
              <AlertCircle className="text-red-500" size={24} />
            ) : (
              <FileUp className="text-brand-500" size={23} />
            )}
          </div>
          <p className="text-sm font-semibold mb-1 text-center">
            {isDragActive ? "Drop files here" : "Drop files here"}
          </p>
          <div className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-3 py-1.5 text-xs font-semibold text-brand-600 dark:text-brand-300 shadow-sm">
            <Upload size={13} />
            Browse documents
          </div>
          <p className="mt-3 text-xs text-[var(--text-muted)] text-center">
            {ACCEPTED_SUMMARY} - up to {limits.maxUploadMb} MB each; {MAX_FILES_PER_DROP} per batch.
          </p>
          <p className="mt-1 max-w-md text-center text-[11px] leading-4 text-[var(--text-muted)]">
            PDFs up to {limits.maxPdfPages} pages; scanned PDFs up to{" "}
            {limits.maxPdfOcrPages} OCR pages; images up to {limits.maxImageMegapixels} MP.
          </p>
          {(!limits.pdfEmbeddedImageOcr || !limits.docxEmbeddedImageOcr) && (
            <p className="mt-1 max-w-md text-center text-[11px] leading-4 text-[var(--text-muted)]">
              Text is indexed; embedded PDF/DOCX images are skipped on this deployment.
            </p>
          )}
        </>
      )}
    </div>
  );
}
