import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DocumentMetadata } from "@/types";
vi.mock("@/components/documents/DocumentChunksExplorer", () => ({
  DocumentChunksExplorer: () => <div><button>Inspect chunk</button><button disabled>Unavailable</button></div>,
}));
import { DocumentDetailPanel } from "./DocumentDetailPanel";
const fixture = {
  document_id: "synthetic-doc", filename: "Synthetic evidence.txt", file_type: "txt",
  file_size_bytes: 20, chunk_count: 1, page_count: 1, status: "ready",
} as DocumentMetadata;
afterEach(() => { document.body.style.overflow = ""; });
describe("document evidence panel keyboard access", () => {
  it("labels the dialog, focuses close, and isolates the background", () => {
    const view = render(<DocumentDetailPanel document={fixture} onClose={vi.fn()} />);
    expect(screen.getByRole("dialog", { name: fixture.filename })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();
    expect(view.container.inert).toBe(true);
    expect(document.body.style.overflow).toBe("hidden");
  });
  it("wraps Tab in both directions and excludes disabled and backdrop controls", () => {
    render(<DocumentDetailPanel document={fixture} onClose={vi.fn()} />);
    const first = screen.getByRole("link", { name: /Open full details/ });
    const last = screen.getByRole("button", { name: "Inspect chunk" });
    last.focus(); fireEvent.keyDown(document, { key: "Tab" }); expect(first).toHaveFocus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true }); expect(last).toHaveFocus();
  });
  it("dismisses with Escape and restores focus, inert state, and prior scroll", () => {
    const trigger = document.createElement("button");
    document.body.append(trigger); trigger.focus();
    document.body.style.overflow = "clip";
    const onClose = vi.fn();
    const view = render(<DocumentDetailPanel document={fixture} onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" }); expect(onClose).toHaveBeenCalledOnce();
    view.unmount();
    expect(trigger).toHaveFocus(); expect(trigger.inert).not.toBe(true);
    expect(document.body.style.overflow).toBe("clip"); trigger.remove();
  });
  it("keeps focus inside and uses the latest close callback without restarting focus", () => {
    const oldClose = vi.fn(), newClose = vi.fn();
    const view = render(<DocumentDetailPanel document={fixture} onClose={oldClose} />);
    const chunk = screen.getByRole("button", { name: "Inspect chunk" });
    chunk.focus();
    view.rerender(<DocumentDetailPanel document={fixture} onClose={newClose} />);
    expect(chunk).toHaveFocus();
    view.container.focus();
    fireEvent.focusIn(view.container);
    expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(newClose).toHaveBeenCalledOnce(); expect(oldClose).not.toHaveBeenCalled();
  });
  it("does not render or modify the page when no document is selected", () => {
    const view = render(<DocumentDetailPanel document={null} onClose={vi.fn()} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(view.container.inert).not.toBe(true);
  });
});