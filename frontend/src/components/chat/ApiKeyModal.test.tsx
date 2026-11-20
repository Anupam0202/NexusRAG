import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const { setApiKey, fingerprint, quota, success } = vi.hoisted(() => ({ setApiKey: vi.fn(), fingerprint: vi.fn(), quota: vi.fn(), success: vi.fn() }));
vi.mock("@/lib/api", () => ({ setApiKey }));
vi.mock("sonner", () => ({ toast: { success, error: vi.fn() } }));
import { useStore } from "@/hooks/useStore";
import { ApiKeyModal } from "./ApiKeyModal";
describe("API key consent dialog", () => {
  beforeEach(() => {
    setApiKey.mockReset(); fingerprint.mockReset(); quota.mockReset(); success.mockReset();
    useStore.setState({ showApiKeyModal: true, isQuotaBlocked: true, authMode: "authenticated", authUser: { id: "user-a", email: null }, workspaceId: "workspace-a", setUserApiKey: fingerprint, setIsQuotaBlocked: quota });
  });
  const fill = () => { fireEvent.change(screen.getByLabelText("Gemini API key"), { target: { value: "synthetic-not-a-real-key" } }); fireEvent.click(screen.getByRole("checkbox")); };
  it("allows Escape dismissal without removing quota enforcement and restores focus", () => {
    const previous = document.createElement("button"); document.body.append(previous); previous.focus();
    render(<ApiKeyModal />); expect(screen.getByRole("dialog")).toHaveAttribute("aria-modal", "true");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); expect(quota).not.toHaveBeenCalled();
    expect(useStore.getState().isQuotaBlocked).toBe(true); expect(previous).toHaveFocus(); previous.remove();
  });
  it("allows cancellation and traps keyboard focus inside the dialog", () => {
    render(<ApiKeyModal />);
    const first = screen.getByRole("button", { name: "Close" }), last = screen.getByRole("checkbox");
    last.focus(); fireEvent.keyDown(document, { key: "Tab" }); expect(first).toHaveFocus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true }); expect(last).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(quota).not.toHaveBeenCalled(); expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("erases the key and cost consent on identity change", () => {
    render(<ApiKeyModal />); fill(); act(() => useStore.setState({ authUser: { id: "user-b", email: null } }));
    expect(screen.getByLabelText("Gemini API key")).toHaveValue(""); expect(screen.getByRole("checkbox")).not.toBeChecked();
  });
  it("binds the request to its initiating account and ignores its stale completion", async () => {
    let finish!: (value: unknown) => void; setApiKey.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    render(<ApiKeyModal />); fill(); fireEvent.click(screen.getByRole("button", { name: "Activate Key" }));
    await waitFor(() => expect(setApiKey).toHaveBeenCalledWith("synthetic-not-a-real-key", true, { workspaceId: "workspace-a", expectedUserId: "user-a" }));
    act(() => useStore.setState({ authUser: { id: "user-b", email: null } }));
    await act(async () => finish({ key_fingerprint: "old-fingerprint" }));
    expect(fingerprint).not.toHaveBeenCalled(); expect(quota).not.toHaveBeenCalled(); expect(success).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
  it("cannot activate without a hydrated authenticated workspace", () => {
    useStore.setState({ workspaceId: null }); render(<ApiKeyModal />); fill();
    expect(screen.getByRole("button", { name: "Activate Key" })).toBeDisabled(); expect(setApiKey).not.toHaveBeenCalled();
  });
});
