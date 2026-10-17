import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Sidebar } from "./Sidebar";
import { useStore } from "@/hooks/useStore";

vi.mock("next/navigation", () => ({ usePathname: () => "/evidence-os" }));

function fixture() {
  return render(<div><Sidebar /><main aria-label="Application background"><button>Background action</button></main></div>);
}

describe("Accessible navigation", () => {
  beforeEach(() => {
    useStore.setState({ documents: [] });
    vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue({ length: 1 } as DOMRectList);
  });
  afterEach(() => vi.restoreAllMocks());

  it("preserves names for collapsed icon links and the expansion control", () => {
    fixture();
    fireEvent.click(screen.getByRole("button", { name: "Collapse navigation sidebar" }));
    expect(screen.getByRole("link", { name: "Documents" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Expand navigation sidebar" })).toBeInTheDocument();
  });

  it("makes background inert, traps focus and restores it on Escape", async () => {
    fixture();
    const opener = screen.getByRole("button", { name: "Open navigation menu" });
    const previousInert = document.querySelector("main")?.inert;
    opener.focus(); fireEvent.click(opener);
    const dialog = screen.getByRole("dialog", { name: "Navigation menu" });
    const dismiss = screen.getByRole("button", { name: "Dismiss navigation menu" });
    await waitFor(() => expect(dismiss).toHaveFocus());
    expect(document.querySelector("main")?.inert).toBe(true);
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(dialog.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(document.querySelector("main")?.inert).toBe(previousInert);
    expect(opener).toHaveFocus(); expect(document.body.style.overflow).not.toBe("hidden");
  });

  it("restores inert state and scroll lock when a modal unmounts", () => {
    const view = fixture();
    fireEvent.click(screen.getByRole("button", { name: "Open navigation menu" }));
    expect(document.body.style.overflow).toBe("hidden");
    view.unmount();
    expect(document.body.style.overflow).not.toBe("hidden");
  });

  it("moves every Tab explicitly so browser link-tabbing preferences cannot escape the dialog", async () => {
    fixture();
    fireEvent.click(screen.getByRole("button", { name: "Open navigation menu" }));
    const dialog = screen.getByRole("dialog", { name: "Navigation menu" });
    const dismiss = screen.getByRole("button", { name: "Dismiss navigation menu" });
    await waitFor(() => expect(dismiss).toHaveFocus());
    const nodes = Array.from(dialog.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),[tabindex]:not([tabindex="-1"])'));
    for (let index = 1; index <= nodes.length; index++) {
      const event = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
      document.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
      expect(nodes[index % nodes.length]).toHaveFocus();
    }
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(nodes[nodes.length - 1]).toHaveFocus();
  });
});
