import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  clearMessages,
  clearSession,
  deleteCurrentWorkspace,
  getCurrentWorkspace,
  getPrivacySettings,
  listDocuments,
  setDocuments,
  setStoredWorkspaceId,
} = vi.hoisted(() => ({
  clearMessages: vi.fn(),
  clearSession: vi.fn(),
  deleteCurrentWorkspace: vi.fn(),
  getCurrentWorkspace: vi.fn(),
  getPrivacySettings: vi.fn(),
  listDocuments: vi.fn(),
  setDocuments: vi.fn(),
  setStoredWorkspaceId: vi.fn(),
}));

vi.mock("@/hooks/useAuthGate", () => ({
  useWorkspaceApiAccess: () => ({
    authMode: "authenticated",
    canAccessWorkspaceApi: true,
    isWorkspaceLoading: false,
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
  runRetention: vi.fn(),
  updatePrivacySettings: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

import PrivacyPage from "./page";

describe("PrivacyPage", () => {
  beforeEach(() => {
    clearMessages.mockReset();
    clearSession.mockReset();
    deleteCurrentWorkspace.mockReset();
    getCurrentWorkspace.mockReset();
    getPrivacySettings.mockReset();
    listDocuments.mockReset();
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
});
