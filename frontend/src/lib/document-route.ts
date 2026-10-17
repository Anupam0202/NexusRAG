export const STATIC_DOCUMENT_ROUTE_ID = "__static_document__";

export function isDocumentDetailPath(pathname: string) {
  return /^\/documents\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/?$/i.test(pathname);
}