import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MessageBubble } from "./MessageBubble";
import type { UIMessage } from "@/types";
vi.mock("framer-motion", async importOriginal => ({
  ...await importOriginal<typeof import("framer-motion")>(), useReducedMotion: () => true,
}));

const message: UIMessage = { id: "synthetic-copy-047", role: "assistant", content: "Synthetic saved answer [S1]." };
const writeText = vi.fn();
beforeEach(() => {
  vi.useFakeTimers(); writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });
const button = () => screen.getByRole("button", { name: "Copy response to clipboard" });
it("reports a normal copy rejection, retains the answer and recovers on explicit retry", async () => {
  writeText.mockRejectedValueOnce(new Error("Ordinary clipboard rejection"));
  render(<MessageBubble message={message} />);
  await act(async () => { fireEvent.click(button()); });
  expect(screen.getByRole("alert")).toHaveTextContent("The clipboard was unavailable.");
  expect(screen.getByText(message.content)).toBeVisible();
  await act(async () => { fireEvent.click(button()); });
  expect(button()).toHaveTextContent("Copied"); expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(writeText).toHaveBeenCalledTimes(2); expect(writeText.mock.calls[1][0]).toBe(message.content);
});
it("reports a missing clipboard API instead of silently doing nothing", async () => {
  render(<MessageBubble message={message} />);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
  await act(async () => { fireEvent.click(button()); });
  expect(screen.getByRole("alert")).toHaveTextContent("The clipboard was unavailable.");
  expect(button()).toHaveTextContent("Copy"); expect(screen.getByText(message.content)).toBeVisible();
});
it("allows only one pending write and unlocks after its ordinary failure", async () => {
  let reject!: (error: Error) => void;
  writeText.mockReturnValueOnce(new Promise<void>((_, fail) => { reject = fail; }));
  render(<MessageBubble message={message} />);
  fireEvent.click(button()); fireEvent.click(button());
  const pendingDisabled = button().hasAttribute("disabled"), attempts = writeText.mock.calls.length;
  await act(async () => { reject(new Error("Ordinary pending-write failure")); });
  expect(pendingDisabled).toBe(true); expect(attempts).toBe(1); expect(button()).toBeEnabled();
  expect(screen.getByRole("alert")).toHaveTextContent("The clipboard was unavailable.");
});
it("does not label changed response content as copied by an older pending write", async () => {
  let finish!: () => void;
  writeText.mockReturnValueOnce(new Promise<void>(resolve => { finish = resolve; }));
  const view = render(<MessageBubble message={message} />); fireEvent.click(button());
  const revised = { ...message, content: "Synthetic revised answer [S2]." };
  view.rerender(<MessageBubble message={revised} />);
  await act(async () => { finish(); });
  expect(button()).toHaveTextContent("Copy"); expect(button()).not.toHaveTextContent("Copied");
  await act(async () => { fireEvent.click(button()); });
  expect(writeText.mock.calls.at(-1)![0]).toBe(revised.content); expect(button()).toHaveTextContent("Copied");
});
it("clears successful feedback when a different response is rendered", async () => {
  const view = render(<MessageBubble message={message} />);
  await act(async () => { fireEvent.click(button()); }); expect(button()).toHaveTextContent("Copied");
  view.rerender(<MessageBubble message={{ ...message, id: "synthetic-other-response", content: "Another saved answer." }} />);
  expect(button()).not.toHaveTextContent("Copied");
});
it("gives a repeated successful copy its own full feedback interval", async () => {
  render(<MessageBubble message={message} />);
  await act(async () => { fireEvent.click(button()); });
  act(() => vi.advanceTimersByTime(1000));
  await act(async () => { fireEvent.click(button()); });
  act(() => vi.advanceTimersByTime(1000)); expect(button()).toHaveTextContent("Copied");
  act(() => vi.advanceTimersByTime(1000)); expect(button()).not.toHaveTextContent("Copied");
});
