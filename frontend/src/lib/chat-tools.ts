import type { QueryRequest, UIMessage } from "@/types";

export interface ChatFilterInput {
  chatScope: "workspace" | "documents";
  documentIds: string[];
  fileTypes: string[];
  filename?: string;
  uploadedBy?: string;
  minPage?: string;
  maxPage?: string;
  uploadedAfter?: string;
  uploadedBefore?: string;
  metadataKey?: string;
  metadataValue?: string;
}

function hasControlCharacters(value: string) {
  return [...value].some(character => {
    const code = character.codePointAt(0)!;
    return code < 32 || code === 127;
  });
}

function optionalPage(value?: string) {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (!/^\d+$/.test(trimmed)) {
    throw new Error("Page filters must be non-negative whole numbers.");
  }
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 1_000_000) {
    throw new Error("Page filters must be non-negative whole numbers.");
  }
  return parsed;
}

function optionalDate(value?: string, endOfDay = false) {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?$/.test(trimmed)
    || Number(trimmed.slice(0, 4)) < 1) throw new Error("Upload dates must be valid dates.");
  const parsed = new Date(trimmed);
  const calendar = new Date(`${trimmed.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || Number.isNaN(calendar.getTime())
    || calendar.toISOString().slice(0, 10) !== trimmed.slice(0, 10)
    || (trimmed.length > 10 && (Number(trimmed.slice(11, 13)) > 23 || Number(trimmed.slice(14, 16)) > 59 || Number(trimmed.slice(17, 19)) > 59))) {
    throw new Error("Upload dates must be valid dates.");
  }
  if (endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(trimmed)) parsed.setUTCHours(23, 59, 59, 999);
  return parsed.toISOString();
}

export function buildChatRequestFilters(input: ChatFilterInput): Partial<QueryRequest> {
  const documentIds = [...new Set(input.documentIds.map((item) => item.trim()).filter(Boolean))]
    .sort();
  const filename = input.filename?.trim();
  const fileTypes = [...new Set(input.fileTypes.map((item) => item.trim().toLowerCase()).filter(Boolean))]
    .sort();
  const uploadedBy = input.uploadedBy?.trim();
  const minPage = optionalPage(input.minPage);
  const maxPage = optionalPage(input.maxPage);
  const uploadedAfter = optionalDate(input.uploadedAfter);
  const uploadedBefore = optionalDate(input.uploadedBefore, true);
  const metadataKey = input.metadataKey?.trim();
  const metadataValue = input.metadataValue?.trim();
  if (documentIds.length > 25) throw new Error("Select at most 25 documents; the scope will not be silently truncated.");
  if (fileTypes.length > 20 || fileTypes.some(type => !/^\.?[a-z0-9]{1,20}$/.test(type))) {
    throw new Error("Choose at most 20 valid file extensions.");
  }
  if (uploadedBy && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uploadedBy)) {
    throw new Error("Uploader must be a valid user ID.");
  }
  if (filename && (filename.length > 255 || hasControlCharacters(filename))) throw new Error("Filename must be an exact name of at most 255 characters.");
  if (metadataValue && (metadataValue.length > 256 || hasControlCharacters(metadataValue))) throw new Error("Metadata values must contain at most 256 characters.");
  if (Boolean(metadataKey) !== Boolean(metadataValue)) throw new Error("Provide both a metadata key and its exact text value.");

  if (minPage !== undefined && maxPage !== undefined && maxPage < minPage) {
    throw new Error("Maximum page must be greater than or equal to minimum page.");
  }
  if (
    uploadedAfter &&
    uploadedBefore &&
    new Date(uploadedBefore).getTime() < new Date(uploadedAfter).getTime()
  ) {
    throw new Error("Upload end date must be on or after the start date.");
  }
  if (metadataKey && (!/^[A-Za-z0-9_.-]{1,64}$/.test(metadataKey) || ["__proto__", "constructor", "prototype"].includes(metadataKey))) {
    throw new Error("Metadata keys may contain only letters, numbers, dots, underscores, and dashes.");
  }

  return {
    chat_scope: input.chatScope,
    ...(documentIds.length ? { document_ids: documentIds } : {}),
    ...(fileTypes.length ? { file_types: fileTypes } : {}),
    ...(filename ? { filename } : {}),
    ...(uploadedBy ? { uploaded_by: uploadedBy } : {}),
    ...(minPage !== undefined ? { min_page: minPage } : {}),
    ...(maxPage !== undefined ? { max_page: maxPage } : {}),
    ...(uploadedAfter ? { uploaded_after: uploadedAfter } : {}),
    ...(uploadedBefore ? { uploaded_before: uploadedBefore } : {}),
    ...(metadataKey && metadataValue
      ? { metadata_filters: { [metadataKey]: metadataValue } }
      : {}),
  };
}

export function exportChatMarkdown(messages: UIMessage[], title = "NexusRAG chat export") {
  const sections = messages.map((message) => {
    const sourceLines = (message.sources ?? []).map(
      (source, index) =>
        `${index + 1}. ${source.filename}, page ${source.page_number}, chunk ${source.chunk_index}`
    );
    return [
      `## ${message.role === "assistant" ? "Assistant" : message.role === "user" ? "User" : "System"}`,
      message.timestamp ? `_${message.timestamp}_` : "",
      message.content,
      sourceLines.length ? `### Sources\n${sourceLines.join("\n")}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");
  });

  return [`# ${title}`, `Exported: ${new Date().toISOString()}`, ...sections].join("\n\n");
}

export function exportChatJson(messages: UIMessage[]) {
  // Preserve evidence identity without copying arbitrary document metadata or
  // unrelated runtime fields into portable exports.
  const pick = (metadata: Record<string, unknown> | undefined, fields: string[]) =>
    Object.fromEntries(fields.filter(key => metadata && Object.hasOwn(metadata, key))
      .map(key => [key, metadata![key]]));
  return JSON.stringify(
    messages.map(({ role, content, timestamp, sources, confidence, queryType, responseTime, metadata }) => ({
      role,
      content,
      timestamp,
      confidence,
      confidence_state: "UNCALIBRATED",
      query_type: queryType,
      response_time_seconds: responseTime,
      metadata: pick(metadata, ["claim_state", "abstained", "validated_citation_ids", "citation_required",
        "answerability", "low_confidence", "source_quote_coverage", "model", "retrieval",
        "session_id", "provider_cost_status", "provider_cost_owner"]),
      sources: (sources ?? []).map(
        ({ content: quote, filename, page_number, chunk_index, relevance_score, document_type, metadata }) => ({
          quote,
          filename,
          page_number,
          chunk_index,
          relevance_score,
          relevance_score_meaning: "RANKING_ONLY_NOT_CLAIM_SUPPORT",
          document_type,
          metadata: pick(metadata, ["document_id", "version_id", "chunk_id", "index_generation",
            "original_content_hash", "location", "authority", "source_url", "retrieved_at"]),
        })
      ),
    })),
    null,
    2
  );
}
