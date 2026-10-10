import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DocumentMetadata } from "@/types";
import { DocumentList } from "./DocumentList";
const fixture = { document_id: "synthetic-doc", filename: "Synthetic evidence.txt", file_type: "txt", status: "ready", file_size_bytes: 20, chunk_count: 1 } as DocumentMetadata;
describe("document library role controls", () => {
  it("preserves preview, navigation and refresh while disabling viewer mutations", () => {
    const onSelect = vi.fn(), onDelete = vi.fn(), onReindex = vi.fn(), onRefresh = vi.fn();
    render(<DocumentList documents={[fixture]} loading={false} canMutate={false}
      mutationDisabledReason="Viewer access: read only" onSelect={onSelect} onDelete={onDelete} onReindex={onReindex} onRefresh={onRefresh} />);
    fireEvent.click(screen.getByRole("button", { name: `Preview ${fixture.filename}` }));
    expect(onSelect).toHaveBeenCalledWith(fixture);
    expect(screen.getByRole("link", { name: /Open details page/ })).toHaveAttribute("href", "/documents/synthetic-doc");
    fireEvent.click(screen.getByRole("button", { name: "Refresh" })); expect(onRefresh).toHaveBeenCalledOnce();
    for (const name of [`Delete ${fixture.filename}`, `Re-index ${fixture.filename}`]) {
      const control = screen.getByRole("button", { name }); expect(control).toBeDisabled(); fireEvent.click(control);
    }
    expect(onDelete).not.toHaveBeenCalled(); expect(onReindex).not.toHaveBeenCalled();
  });
  it("wires authorized mutation controls to their exact document", () => {
    const onDelete = vi.fn(), onReindex = vi.fn();
    render(<DocumentList documents={[fixture]} loading={false} canMutate onSelect={vi.fn()}
      onDelete={onDelete} onReindex={onReindex} onRefresh={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: `Delete ${fixture.filename}` }));
    fireEvent.click(screen.getByRole("button", { name: `Re-index ${fixture.filename}` }));
    expect(onDelete).toHaveBeenCalledWith("synthetic-doc"); expect(onReindex).toHaveBeenCalledWith("synthetic-doc");
  });
});