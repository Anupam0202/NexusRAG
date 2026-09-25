import DocumentDetailClient from "@/components/documents/DocumentDetailClient";
import { STATIC_DOCUMENT_ROUTE_ID } from "@/lib/document-route";

// This concrete build-time route supplies the static HTML shell. The
// candidate Worker maps UUID detail URLs to this asset; the client resolves
// the real UUID from window.location before requesting tenant-scoped data.
export function generateStaticParams() {
  return [{ documentId: STATIC_DOCUMENT_ROUTE_ID }];
}

export const dynamicParams = false;

export default function DocumentDetailPage() {
  return <DocumentDetailClient />;
}