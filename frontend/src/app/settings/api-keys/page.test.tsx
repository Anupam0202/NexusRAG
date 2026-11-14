import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const { getApiKeyStatus, setApiKey, deleteApiKey, fingerprint } = vi.hoisted(() => ({ getApiKeyStatus: vi.fn(), setApiKey: vi.fn(), deleteApiKey: vi.fn(), fingerprint: vi.fn() }));
vi.mock("@/lib/api", () => ({ getApiKeyStatus, setApiKey, deleteApiKey }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { useStore } from "@/hooks/useStore";
import ApiKeysPage from "./page";
const status = { provider: "gemini", key_fingerprint: null, workspace_key_configured: false, server_key_configured: true, storage: "supabase" };
describe("account credential state", () => {
  beforeEach(() => {
    getApiKeyStatus.mockReset().mockResolvedValue(status); setApiKey.mockReset(); deleteApiKey.mockReset(); fingerprint.mockReset();
    useStore.setState({ authMode: "authenticated", authUser: { id: "user-a", email: null }, workspaceId: "workspace-a", setUserApiKey: fingerprint });
  });
  it("erases unsaved key text and consent when the account changes", async () => {
    render(<ApiKeysPage />); await waitFor(() => expect(getApiKeyStatus).toHaveBeenCalled());
    const input = screen.getByPlaceholderText("AIza...");
    fireEvent.change(input, { target: { value: "synthetic-key-not-real" } });
    fireEvent.click(screen.getByRole("checkbox"));
    await act(async () => useStore.setState({ authUser: { id: "user-b", email: null } }));
    expect(screen.getByPlaceholderText("AIza...")).toHaveValue("");
    expect(screen.getByRole("checkbox")).not.toBeChecked();
  });
  it("ignores pending old-account status including global fingerprint side effects", async () => {
    let finish!: (value: unknown) => void;
    getApiKeyStatus.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    render(<ApiKeysPage />); await waitFor(() => expect(getApiKeyStatus).toHaveBeenCalledTimes(1));
    getApiKeyStatus.mockImplementationOnce(() => new Promise(() => {}));
    act(() => useStore.setState({ authUser: { id: "user-b", email: null } }));
    await act(async () => finish({ ...status, key_fingerprint: "old-account-fingerprint" }));
    expect(fingerprint).not.toHaveBeenCalled();
    expect(screen.queryByText("old-account-fingerprint")).not.toBeInTheDocument();
  });
  it("binds credential activation to the initiating account and workspace", async () => {
    setApiKey.mockResolvedValue({ ...status, workspace_key_configured: true, key_fingerprint: "synthetic-fingerprint" });
    render(<ApiKeysPage />);
    await waitFor(() => expect(fingerprint).toHaveBeenCalled());
    fireEvent.change(screen.getByPlaceholderText("AIza..."), { target: { value: "synthetic-key-not-real" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Activate Key" }));
    await waitFor(() => expect(setApiKey).toHaveBeenCalledWith("synthetic-key-not-real", true, { workspaceId: "workspace-a", expectedUserId: "user-a" }));
  });
});
