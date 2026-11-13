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
  updatePrivacySettings,
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
  updatePrivacySettings: vi.fn(),
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
  updatePrivacySettings,
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

const receipt = (patch: Record<string, unknown> = {}) => ({
  workspace_deleted: false, cutoff: null, documents_deleted: 0, documents_pending_erasure: 0, documents_kept_for_radar: 0,
  chat_messages_deleted: 0, chat_sessions_deleted: 0, chat_titles_cleared: 0, workbench_runs_redacted: 0,
  research_runs_deleted: 0, runs_kept_for_findings: 0, more_remaining: false, failures: [], ...patch,
});

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
    updatePrivacySettings.mockReset();
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
    // A gateway that can carry out retention and workspace deletion says so explicitly.
    getPrivacySettings.mockResolvedValue({
      retention_enabled: false,
      retention_days: 30,
      last_retention_at: null,
      retention_mutation_supported: true,
      workspace_deletion_supported: true,
    });
  });

  it("waits for workspace hydration before reading private settings", async () => {
    hydration.loading = true;
    const { rerender } = render(<PrivacyPage />);
    expect(getCurrentWorkspace).not.toHaveBeenCalled(); expect(getPrivacySettings).not.toHaveBeenCalled();
    hydration.loading = false; rerender(<PrivacyPage />);
    await waitFor(() => expect(getCurrentWorkspace).toHaveBeenCalledTimes(1));
  });

  it("offers no retention or workspace deletion unless the gateway confirms it can carry them out", async () => {
    getPrivacySettings.mockResolvedValue({ retention_enabled: false, retention_days: 30, last_retention_at: null });
    render(<PrivacyPage />);
    expect(await screen.findByText(/Retention is not available on this server yet/)).toBeVisible();
    expect(screen.queryByLabelText("Confirm workspace deletion")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Run now" })).not.toBeInTheDocument();
  });

  it("does not offer changes the server cannot carry out", async () => {
    getPrivacySettings.mockResolvedValue({
      retention_enabled: false,
      retention_days: 0,
      retention_mutation_supported: false,
      workspace_deletion_supported: false,
    });
    render(<PrivacyPage />);
    expect(await screen.findByText(/Retention is not available on this server yet/)).toBeVisible();
    expect(await screen.findByText(/Deleting a whole workspace is not available on this server yet/)).toBeVisible();
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
    getPrivacySettings.mockResolvedValueOnce({ retention_enabled: true, retention_days: 30, last_retention_at: null, retention_mutation_supported: true })
      .mockResolvedValueOnce({ retention_enabled: true, retention_days: 30, last_retention_at: completedAt, retention_mutation_supported: true });
    runRetention.mockResolvedValue(receipt());
    render(<PrivacyPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Run now" }));
    await waitFor(() => expect(getPrivacySettings).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(new RegExp(`Last run ${new Date(completedAt).toLocaleString().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`))).toBeVisible();
  });

  it("does not invent a retention timestamp when the durable refresh fails", async () => {
    getPrivacySettings.mockResolvedValueOnce({ retention_enabled: true, retention_days: 30, last_retention_at: null, retention_mutation_supported: true })
      .mockRejectedValueOnce(new Error("Retention status refresh failed"));
    runRetention.mockResolvedValue(receipt());
    render(<PrivacyPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Run now" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(screen.queryByText(/Last run/)).not.toBeInTheDocument();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("turns retention on only after a second click that names what will be deleted", async () => {
    updatePrivacySettings.mockResolvedValue({ retention_enabled: true, retention_days: 30, last_retention_at: null,
      next_retention_at: "2026-11-13T12:00:00Z", retention_mutation_supported: true });
    render(<PrivacyPage />);
    fireEvent.click(await screen.findByRole("checkbox", { name: "Enabled" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const warning = await screen.findByRole("alert");
    expect(warning).toHaveTextContent(/documents uploaded before .+ are permanently deleted/);
    expect(warning).toHaveTextContent("This cannot be undone.");
    expect(updatePrivacySettings).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Delete on this schedule" }));
    await waitFor(() => expect(updatePrivacySettings).toHaveBeenCalledWith({ retention_enabled: true, retention_days: 30 }, expect.anything()));
    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining("Retention is on"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(await screen.findByText(new RegExp(`Next run ${new Date("2026-11-13T12:00:00Z").toLocaleString().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`))).toBeVisible();
  });

  it("leaves the schedule alone when the warning is cancelled or the choice changes", async () => {
    render(<PrivacyPage />);
    fireEvent.click(await screen.findByRole("checkbox", { name: "Enabled" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    fireEvent.change(await screen.findByRole("spinbutton", { name: "Retention days" }), { target: { value: "90" } });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(updatePrivacySettings).not.toHaveBeenCalled();
  });

  it("turns retention off at once, and offers Run now only for a saved schedule", async () => {
    getPrivacySettings.mockResolvedValue({ retention_enabled: true, retention_days: 30, last_retention_at: null, retention_mutation_supported: true });
    updatePrivacySettings.mockResolvedValue({ retention_enabled: false, retention_days: 30, last_retention_at: null, next_retention_at: null });
    render(<PrivacyPage />);
    const run = await screen.findByRole("button", { name: "Run now" });
    expect(run).toBeEnabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "Enabled" }));
    // Unchecked but not saved: the stored schedule is still on, so a run is still possible.
    expect(run).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(updatePrivacySettings).toHaveBeenCalledWith({ retention_enabled: false, retention_days: 0 }, expect.anything()));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await waitFor(() => expect(run).toBeDisabled());
  });

  it("does not offer a run for a schedule that is only ticked, not saved", async () => {
    render(<PrivacyPage />);
    const run = await screen.findByRole("button", { name: "Run now" });
    fireEvent.click(screen.getByRole("checkbox", { name: "Enabled" }));
    expect(run).toBeDisabled();
  });

  it("tells the person what a run removed", async () => {
    getPrivacySettings.mockResolvedValue({ retention_enabled: true, retention_days: 30, last_retention_at: null, retention_mutation_supported: true });
    runRetention.mockResolvedValue(receipt({ documents_deleted: 2, documents_pending_erasure: 2, chat_messages_deleted: 5, more_remaining: true }));
    render(<PrivacyPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Run now" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(
      "Removed 2 documents and 5 chat messages. The documents' stored copies are erased in the background, usually within the hour. "
        + "More remains; the next run continues within the hour."));
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
