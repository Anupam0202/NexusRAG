import { render, screen } from "@testing-library/react";
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
  it("renders low-confidence metadata from the backend", () => {
    const message: UIMessage = {
      id: "assistant-1",
      role: "assistant",
      content: "The answer may need source verification.",
      timestamp: "2026-06-02T00:00:00.000Z",
      confidence: 0.24,
      metadata: {
        answerability: "low_confidence",
        low_confidence: true,
        source_quote_coverage: 0.25,
      },
    };

    render(<MessageBubble message={message} />);

    expect(screen.getByText(/low confidence answer/i)).toBeInTheDocument();
    expect(screen.getByText("low_confidence")).toBeInTheDocument();
    expect(screen.getByText("25% quotes")).toBeInTheDocument();
  });
});
