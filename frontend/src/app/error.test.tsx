import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import PageError from "./error";
import AppError from "./global-error";

describe("error screens", () => {
  it("tell the person what happened, offer a retry, and keep internals out of view", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const retry = vi.fn();
    const failure = Object.assign(new Error("TypeError: cannot read properties of undefined (reading 'x')"), { digest: "abc123" });
    render(<PageError error={failure} retry={retry} />);
    expect(screen.getByRole("alert")).toHaveTextContent("This page could not be shown");
    expect(screen.getByText("Reference: abc123")).toBeInTheDocument();
    expect(screen.queryByText(/cannot read properties/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("link", { name: "Go to Chat" })).toHaveAttribute("href", "/chat");
  });

  it("cover a failure of the app frame itself", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const retry = vi.fn();
    render(<AppError error={new Error("layout failed")} retry={retry} />, { container: document.documentElement });
    expect(screen.getByRole("heading", { name: "NexusRAG could not start" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
