import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getAnalytics, getApiKeyStatus, getBillingUsage, getSystemStatus } = vi.hoisted(() => ({
  getAnalytics: vi.fn(),
  getApiKeyStatus: vi.fn(),
  getBillingUsage: vi.fn(),
  getSystemStatus: vi.fn(),
}));
const workspaceAccess = vi.hoisted(() => ({
  value: {
    authMode: "authenticated",
    canAccessWorkspaceApi: true,
    isWorkspaceLoading: false,
  },
}));

vi.mock("@/hooks/useAuthGate", () => ({
  useWorkspaceApiAccess: () => workspaceAccess.value,
}));

vi.mock("@/lib/api", () => ({
  getAnalytics,
  getApiKeyStatus,
  getBillingUsage,
  getSystemStatus,
}));

import BillingOrUsagePage from "./page";

describe("BillingOrUsagePage", () => {
  beforeEach(() => {
    getAnalytics.mockReset();
    getApiKeyStatus.mockReset();
    getBillingUsage.mockReset();
    getSystemStatus.mockReset();
    workspaceAccess.value = {
      authMode: "authenticated",
      canAccessWorkspaceApi: true,
      isWorkspaceLoading: false,
    };
  });

  it("waits for workspace hydration before loading workspace usage", async () => {
    workspaceAccess.value = {
      authMode: "authenticated",
      canAccessWorkspaceApi: true,
      isWorkspaceLoading: true,
    };

    render(<BillingOrUsagePage />);

    expect(screen.getByText("Loading usage")).toBeInTheDocument();
    await waitFor(() => {
      expect(getAnalytics).not.toHaveBeenCalled();
      expect(getSystemStatus).not.toHaveBeenCalled();
      expect(getBillingUsage).not.toHaveBeenCalled();
    });
  });
});
