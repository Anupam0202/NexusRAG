import { describe, expect, it } from "vitest";
import { buildChatRequestFilters, exportChatMarkdown } from "./chat-tools";
import type { UIMessage } from "@/types";

describe("buildChatRequestFilters", () => {
  it("normalizes selected documents and page filters", () => {
    expect(
      buildChatRequestFilters({
        chatScope: "documents",
        documentIds: ["doc-b", "doc-a", "doc-a", ""],
        fileTypes: ["pdf", "md", "pdf"],
        filename: "  report.pdf ",
        uploadedBy: " user-1 ",
        minPage: "2",
        maxPage: "8",
        uploadedAfter: "2026-01-01",
        uploadedBefore: "2026-06-01",
        metadataKey: "department",
        metadataValue: "finance",
      })
    ).toEqual({
      chat_scope: "documents",
      document_ids: ["doc-a", "doc-b"],
      file_types: ["md", "pdf"],
      filename: "report.pdf",
      uploaded_by: "user-1",
      min_page: 2,
      max_page: 8,
      uploaded_after: "2026-01-01T00:00:00.000Z",
      uploaded_before: "2026-06-01T00:00:00.000Z",
      metadata_filters: { department: "finance" },
    });
  });

  it("rejects an inverted page range", () => {
    expect(() =>
      buildChatRequestFilters({
        chatScope: "workspace",
        documentIds: [],
        fileTypes: [],
        minPage: "9",
        maxPage: "2",
      })
    ).toThrow("Maximum page must be greater than or equal to minimum page.");
  });

  it.each(["2.9", "1e2", "-1", "page 4"])(
    "rejects malformed page filter %s",
    (value) => {
      expect(() =>
        buildChatRequestFilters({
          chatScope: "workspace",
          documentIds: [],
          fileTypes: [],
          minPage: value,
        })
      ).toThrow("Page filters must be non-negative whole numbers.");
    }
  );

  it("rejects inverted upload dates and unsafe metadata keys", () => {
    expect(() =>
      buildChatRequestFilters({
        chatScope: "workspace",
        documentIds: [],
        fileTypes: [],
        uploadedAfter: "2026-06-01",
        uploadedBefore: "2026-01-01",
      })
    ).toThrow("Upload end date must be on or after the start date.");

    expect(() =>
      buildChatRequestFilters({
        chatScope: "workspace",
        documentIds: [],
        fileTypes: [],
        metadataKey: "workspace/id",
        metadataValue: "hidden",
      })
    ).toThrow("Metadata keys may contain only letters, numbers, dots, underscores, and dashes.");
  });
});

describe("exportChatMarkdown", () => {
  it("includes messages and source references without leaking metadata blobs", () => {
    const messages: UIMessage[] = [
      {
        id: "user-1",
        role: "user",
        content: "What is the result?",
        timestamp: "2026-06-06T10:00:00.000Z",
      },
      {
        id: "assistant-1",
        role: "assistant",
        content: "The result is 42.",
        sources: [
          {
            content: "The result is 42.",
            filename: "report.pdf",
            page_number: 4,
            chunk_index: 2,
            relevance_score: 0.9,
            document_type: "pdf",
            metadata: { private: "do-not-export" },
          },
        ],
      },
    ];

    const markdown = exportChatMarkdown(messages, "NexusRAG export");

    expect(markdown).toContain("# NexusRAG export");
    expect(markdown).toContain("## User");
    expect(markdown).toContain("## Assistant");
    expect(markdown).toContain("report.pdf, page 4, chunk 2");
    expect(markdown).not.toContain("do-not-export");
  });
});
