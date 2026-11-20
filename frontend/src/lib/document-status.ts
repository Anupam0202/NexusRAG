import type { DocumentStatus } from "@/types";

const LABELS: Record<DocumentStatus, string> = {
  pending: "Waiting",
  processing: "Processing",
  ready: "Ready",
  error: "Failed",
  needs_upload: "Upload again",
};

/** A short label a person understands; unknown values are shown as they are. */
export function documentStatusLabel(status: string): string {
  return LABELS[status as DocumentStatus] ?? status;
}

/** One sentence for a document that cannot be answered from, or null when it can or is on its way. */
export function documentStatusExplanation(status: string): string | null {
  if (status === "needs_upload") {
    return "This document was added before the current version of NexusRAG and cannot be searched. Delete it, then upload the file again.";
  }
  if (status === "error") {
    return "Processing this document failed, so it cannot be searched. Retry it, or delete it and upload it again.";
  }
  return null;
}
