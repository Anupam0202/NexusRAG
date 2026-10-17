import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  hydration,
  clearMessages,
  clearSession,
  deleteCurrentWorkspace,
  getCurrentWorkspace,
  getPrivacySettings,
  listDocuments,
  runRetention,
  setDocuments,
  setStoredWorkspaceId,
} = vi.hoisted(() => ({
  hydration: { loading: false },
  clearMessages: vi.fn(),
  clearSession: vi.fn(),
  deleteCurrentWorkspace: vi.fn(),
  getCurrentWorkspace: vi.fn(),
  getPrivacySettings: vi.fn(),
  listDocuments: vi.fn(),
  runRetention: vi.fn(),
  setDocuments: vi.fn(),
  setStoredWorkspaceId: vi.fn(),
}));

vi.mock("@/hooks/useAuthGate", () => ({
  useWorkspaceApiAccess: () => ({
    authMode: "authenticated",
    canAccessWorkspaceApi: true,
    isWorkspaceLoading: hydration.loading,
  }),
}));

vi.mock("@/hooks/useStore", () => ({
  useStore: (selector: (state: unknown) => unknown) =>
    selector({
      sessionId: "session-1",
      clearMessages,
      setDocuments,
    }),
}));

vi.mock("@/lib/api-context", () => ({
  setStoredWorkspaceId,
}));

vi.mock("@/lib/api", () => ({
  clearSession,
  deleteCurrentWorkspace,
  deleteDocument: vi.fn(),
  getCurrentWorkspace,
  getPrivacySettings,
  listDocuments,
  runRetention,
  updatePrivacySettings: vi.fn(),
}));

vi.mock("@/components/settings/ProcessingPolicyPanel", () => ({ ProcessingPolicyPanel: () => <div>Processing policy controls</div> }));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

import PrivacyPage from "./page";
import { toast } from "sonner";

describe("PrivacyPage", () => {
  beforeEach(() => {
    hydration.loading = false;
    clearMessages.mockReset();
    clearSession.mockReset();
    deleteCurrentWorkspace.mockReset();
    getCurrentWorkspace.mockReset();
    getPrivacySettings.mockReset();
    listDocuments.mockReset();
    runRetention.mockReset();
    vi.mocked(toast.error).mockClear();
    vi.mocked(toast.success).mockClear();
    setDocuments.mockReset();
    setStoredWorkspaceId.mockReset();

    getCurrentWorkspace.mockResolvedValue({
      workspace_id: "workspace-1",
      role: "owner",
      user_id: "user-1",
    });
    listDocuments.mockResolvedValue({ total: 0, documents: [] });
    getPrivacySettings.mockResolvedValue({
      retention_enabled: false,
      retention_days: 30,
      last_retention_at: null,
    });
  });

  it("waits for workspace hydration before reading private settings", async () => {
    hydration.loading = true;
    const { rerender } = render(<PrivacyPage />);
    expect(getCurrentWorkspace).not.toHaveBeenCalled(); expect(getPrivacySettings).not.toHaveBeenCalled();
    hydration.loading = false; rerender(<PrivacyPage />);
    await waitFor(() => expect(getCurrentWorkspace).toHaveBeenCalledTimes(1));
  });

  it("does not offer mutations the bounded gateway cannot execute", async () => {
    getPrivacySettings.mockResolvedValue({
      retention_enabled: false,
      retention_days: 0,
      retention_mutation_supported: false,
      workspace_deletion_supported: false,
    });
    render(<PrivacyPage />);
    expect(await screen.findByText(/Retention configuration and execution are not yet available/)).toBeVisible();
    expect(await screen.findByText(/Workspace erasure is not yet available/)).toBeVisible();
    expect(screen.queryByLabelText("Confirm workspace deletion")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(deleteCurrentWorkspace).not.toHaveBeenCalled();
  });

  it("submits workspace deletion through a guarded form", async () => {
    deleteCurrentWorkspace.mockImplementation(() => new Promise(() => {}));

    render(<PrivacyPage />);

    const confirmation = await screen.findByLabelText("Confirm workspace deletion");
    const form = confirmation.closest("form");
    expect(form).not.toBeNull();

    fireEvent.change(confirmation, { target: { value: "DELETE WORKSPACE" } });
    fireEvent.submit(form!);

    await waitFor(() => {
      expect(deleteCurrentWorkspace).toHaveBeenCalledTimes(1);
    });
  });

  it("keeps destructive controls unavailable while secure workspace data is loading", async () => {
    let resolveWorkspace: (value: {
      workspace_id: string;
      role: "owner";
      user_id: string;
    }) => void;
    getCurrentWorkspace.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveWorkspace = resolve;
        })
    );

    render(<PrivacyPage />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading secure workspace data...");
    expect(screen.getByRole("button", { name: "Clear chat" })).toBeDisabled();
    expect(screen.queryByLabelText("Confirm workspace deletion")).not.toBeInTheDocument();

    resolveWorkspace!({ workspace_id: "workspace-1", role: "owner", user_id: "user-1" });

    expect(await screen.findByLabelText("Confirm workspace deletion")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear chat" })).not.toBeDisabled();
  });

  it("submits workspace deletion from the destructive button click path", async () => {
    deleteCurrentWorkspace.mockImplementation(() => new Promise(() => {}));

    render(<PrivacyPage />);

    const confirmation = await screen.findByLabelText("Confirm workspace deletion");
    fireEvent.change(confirmation, { target: { value: "DELETE WORKSPACE" } });
    fireEvent.click(screen.getByRole("button", { name: "Delete workspace" }));

    await waitFor(() => {
      expect(deleteCurrentWorkspace).toHaveBeenCalledTimes(1);
    });
  });

  it("displays the durable retention completion timestamp rather than the device clock", async () => {
    const completedAt = "2026-01-02T03:04:05Z";
    getPrivacySettings.mockResolvedValueOnce({ retention_enabled: true, retention_days: 30, last_retention_at: null })
      .mockResolvedValueOnce({ retention_enabled: true, retention_days: 30, last_retention_at: completedAt });
    runRetention.mockResolvedValue({ documents_deleted: 0, failures: [] });
    render(<PrivacyPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Run now" }));
    await waitFor(() => expect(getPrivacySettings).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(new RegExp(`Last run ${new Date(completedAt).toLocaleString().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`))).toBeVisible();
  });

  it("does not invent a retention timestamp when the durable refresh fails", async () => {
    getPrivacySettings.mockResolvedValueOnce({ retention_enabled: true, retention_days: 30, last_retention_at: null })
      .mockRejectedValueOnce(new Error("Retention status refresh failed"));
    runRetention.mockResolvedValue({ documents_deleted: 0, failures: [] });
    render(<PrivacyPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Run now" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(screen.queryByText(/Last run/)).not.toBeInTheDocument();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("preserves local history when clearing is unconfirmed", async () => {
    clearSession.mockRejectedValueOnce(new Error("Chat history clearing was not confirmed"));
    render(<PrivacyPage />);
    const button = screen.getByRole("button", { name: "Clear chat" });
    await waitFor(() => expect(button).not.toBeDisabled());
    fireEvent.click(button);
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(clearMessages).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("keeps workspace context when erasure is unconfirmed", async () => {
    deleteCurrentWorkspace.mockRejectedValueOnce(new Error("Workspace erasure was not confirmed"));
    render(<PrivacyPage />);
    const confirmation = await screen.findByLabelText("Confirm workspace deletion");
    fireEvent.change(confirmation, { target: { value: "DELETE WORKSPACE" } });
    fireEvent.click(screen.getByRole("button", { name: "Delete workspace" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(setStoredWorkspaceId).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });
});
