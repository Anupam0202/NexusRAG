import { sha256 } from "./worker-pipeline.js";
import { matchesDocumentFilters, matchesChunkFilters } from "./retrieval-filters.js";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function candidateChunkIds(candidates) {
  return [...new Set(candidates.map(candidate => candidate?.payload?.chunk_id)
    .filter(id => typeof id === "string" && uuid.test(id)))].slice(0, 12);
}

// Vector content, names and locators are cache data, never evidence authority.
// Rehydrate every candidate from current tenant/version authority and hash-check
// the immutable original before a provider receives any source content.
export async function rehydrateEvidence({ workspaceId, candidates, chunks, documents, versions, filters = {} }) {
  const currentDocuments = new Map(documents.filter(document => document.workspace_id === workspaceId
    && document.lifecycle_state === "active").map(document => [document.id, document]));
  const currentVersions = new Map(versions.filter(version => version.workspace_id === workspaceId
    && version.publication_state === "ready" && version.data_classification === "non_sensitive")
    .map(version => [version.id, version]));
  const authoritativeChunks = new Map(chunks.filter(chunk => chunk.workspace_id === workspaceId)
    .map(chunk => [chunk.id, chunk]));
  const hydrated = [];
  for (const candidate of candidates) {
    const payload = candidate?.payload;
    const chunk = authoritativeChunks.get(payload?.chunk_id);
    const document = currentDocuments.get(chunk?.document_id);
    const version = currentVersions.get(chunk?.version_id);
    if (!chunk || !document || !version || document.active_version_id !== version.id
        || version.document_id !== document.id || payload.workspace_id !== workspaceId
        || payload.document_id !== document.id || payload.version_id !== version.id
        || payload.index_generation !== version.index_generation
        || !matchesDocumentFilters(document, filters) || !matchesChunkFilters(chunk, filters)) continue;
    const original = chunk.original_text ?? chunk.content;
    if (typeof original !== "string" || !original.trim()
        || !/^[a-f0-9]{64}$/.test(chunk.original_content_hash ?? "")
        || await sha256(original) !== chunk.original_content_hash) continue;
    hydrated.push({ id: chunk.id, score: Number.isFinite(candidate.score) ? candidate.score : 0,
      payload: { workspace_id: workspaceId, document_id: document.id, version_id: version.id,
        index_generation: version.index_generation, chunk_id: chunk.id,
        filename: document.filename, content: original, original_content_hash: chunk.original_content_hash,
        chunk_index: chunk.chunk_index, page_number: chunk.page_number ?? 0,
        location: chunk.location ?? null, document_type: document.content_type } });
  }
  return hydrated;
}
