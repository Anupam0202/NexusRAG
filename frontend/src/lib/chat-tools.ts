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

function optionalPage(value?: string) {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (!/^\d+$/.test(trimmed)) {
    throw new Error("Page filters must be non-negative whole numbers.");
  }
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error("Page filters must be non-negative whole numbers.");
  }
  return parsed;
}

function optionalDate(value?: string) {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Upload dates must be valid dates.");
  }
  return parsed.toISOString();
}

export function buildChatRequestFilters(input: ChatFilterInput): Partial<QueryRequest> {
  const documentIds = [...new Set(input.documentIds.map((item) => item.trim()).filter(Boolean))]
    .sort()
    .slice(0, 25);
  const filename = input.filename?.trim();
  const fileTypes = [...new Set(input.fileTypes.map((item) => item.trim().toLowerCase()).filter(Boolean))]
    .sort()
    .slice(0, 20);
  const uploadedBy = input.uploadedBy?.trim();
  const minPage = optionalPage(input.minPage);
  const maxPage = optionalPage(input.maxPage);
  const uploadedAfter = optionalDate(input.uploadedAfter);
  const uploadedBefore = optionalDate(input.uploadedBefore);
  const metadataKey = input.metadataKey?.trim();
  const metadataValue = input.metadataValue?.trim();

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
  if (metadataKey && !/^[A-Za-z0-9_.-]{1,64}$/.test(metadataKey)) {
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
  return JSON.stringify(
    messages.map(({ role, content, timestamp, sources, confidence, queryType, responseTime }) => ({
      role,
      content,
      timestamp,
      confidence,
      query_type: queryType,
      response_time_seconds: responseTime,
      sources: (sources ?? []).map(
        ({ content: quote, filename, page_number, chunk_index, relevance_score, document_type }) => ({
          quote,
          filename,
          page_number,
          chunk_index,
          relevance_score,
          document_type,
        })
      ),
    })),
    null,
    2
  );
}
