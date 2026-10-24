import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MessageBubble, safeHref } from "./MessageBubble";
import type { UIMessage } from "@/types";

describe("safeHref", () => {
  it("allows relative and trusted web protocols", () => {
    expect(safeHref("/documents")).toBe("/documents");
    expect(safeHref("#source")).toBe("#source");
    expect(safeHref("https://example.com/path")).toBe("https://example.com/path");
    expect(safeHref("mailto:test@example.com")).toBe("mailto:test@example.com");
  });

  it("blocks dangerous markdown link protocols", () => {
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("data:text/html,<script>alert(1)</script>")).toBeNull();
    expect(safeHref("vbscript:msgbox(1)")).toBeNull();
  });
});

describe("MessageBubble", () => {
  it("preserves citation markers and code whitespace without inventing calibrated confidence", () => {
    render(<MessageBubble message={{ id: "proof", role: "assistant",
      content: "Review [Source 1, Page 4] and [S1].\n\n```text\nalpha  beta\n    indented\n```",
      confidence: 0.95, metadata: { claim_state: "REVIEW_REQUIRED" } }} />);
    expect(screen.getByText(/Review \[Source 1, Page 4\] and \[S1\]/)).toBeInTheDocument();
    expect(document.querySelector("pre code")?.textContent).toBe("alpha  beta\n    indented\n");
    expect(screen.queryByText("95%")).not.toBeInTheDocument();
    expect(screen.getByText("Answer confidence not calibrated")).toBeInTheDocument();
    expect(screen.getByText(/support for each claim has not been verified/)).toBeInTheDocument();
  });

  it("names the expandable source region and excludes invalid measurement badges", () => {
    render(<MessageBubble message={{ id: "sources", role: "assistant", content: "Evidence [S1]",
      responseTime: Infinity, metadata: { source_quote_coverage: 2 },
      sources: [{ content: "Evidence", filename: "proof.txt", page_number: 1, chunk_index: 0,
        relevance_score: 0.1, document_type: "text", metadata: {} }] }} />);
    const toggle = screen.getByRole("button", { name: /1 sources/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("region", { name: "Response sources" }).id).toBe(toggle.getAttribute("aria-controls"));
    expect(screen.queryByText("200% quotes")).not.toBeInTheDocument();
    expect(screen.queryByText("Infinitys")).not.toBeInTheDocument();
  });

  it("renders low-confidence metadata from the backend", () => {
    const message: UIMessage = {
      id: "assistant-1",
      role: "assistant",
      content: "The answer may need source verification.",
      timestamp: "2026-06-02T00:00:00.000Z",
      confidence: 0.24,
      sources: [
        {
          content: "Source excerpt",
          filename: "resume.pdf",
          page_number: 1,
          chunk_index: 0,
          relevance_score: 0.5,
          document_type: "durable_chunk",
          metadata: {},
        },
      ],
      metadata: {
        answerability: "low_confidence",
        low_confidence: true,
        source_quote_coverage: 0.25,
      },
    };

    render(<MessageBubble message={message} />);

    expect(screen.getByText(/review the attached sources/i)).toBeInTheDocument();
    expect(screen.getByText("low_confidence")).toBeInTheDocument();
    expect(screen.getByText("25% quotes")).toBeInTheDocument();
  });

  it("does not reference attached sources when none were returned", () => {
    const message: UIMessage = {
      id: "assistant-1",
      role: "assistant",
      content: "No matching answer was found.",
      timestamp: "2026-06-02T00:00:00.000Z",
      confidence: 0.1,
      sources: [],
      metadata: {
        answerability: "no_sources",
        low_confidence: true,
      },
    };

    render(<MessageBubble message={message} />);

    expect(screen.getByText(/no matching source chunks were found/i)).toBeInTheDocument();
    expect(screen.queryByText(/attached sources/i)).not.toBeInTheDocument();
  });
});
