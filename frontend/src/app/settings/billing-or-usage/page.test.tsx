import { act, render, screen, waitFor } from "@testing-library/react";
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
    workspaceId: null as string | null,
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
import { useStore } from "@/hooks/useStore";

describe("BillingOrUsagePage", () => {
  beforeEach(() => {
    useStore.setState({ authMode: "authenticated", authUser: { id: "user-a", email: null }, workspaceId: "workspace-a" });
    getAnalytics.mockReset();
    getApiKeyStatus.mockReset();
    getBillingUsage.mockReset();
    getSystemStatus.mockReset();
    workspaceAccess.value = {
      authMode: "authenticated",
      canAccessWorkspaceApi: true,
      isWorkspaceLoading: false,
      workspaceId: null,
    };
  });

  function mockUsageResponses(systemSettings = {}) {
    getAnalytics.mockResolvedValue({
      total_queries: 0,
      total_documents: 0,
      total_chunks: 0,
      avg_response_time: 0,
      avg_confidence: 0,
      queries_today: 0,
      cache_hits: 0,
      cache_misses: 0,
      cache_entries: 0,
      llm_total_tokens: 0,
      usage_tokens_today: 0,
      llm_usage_events: 0,
      llm_successful_events: 0,
      llm_fallbacks: 0,
      llm_error_events: 0,
      usage_avg_latency_ms: 0,
    });
    getSystemStatus.mockResolvedValue({
      service: "NexusRAG API",
      status: "healthy",
      version: "1.0.0",
      total_documents: 0,
      total_chunks: 0,
      api_key_configured: true,
      llm_model_name: "gemini-2.5-flash",
      embedding_model: "lightweight",
      cache: {},
      settings: {
        quota_daily_tokens: 250000,
        quota_daily_queries: 1000,
        quota_max_documents: 100,
        quota_max_storage_mb: 1024,
        ...systemSettings,
      },
      capabilities: {},
      provider_health: [],
    });
    getApiKeyStatus.mockResolvedValue({
      provider: "gemini",
      workspace_id: "workspace-a",
      workspace_key_configured: false,
      server_key_configured: true,
      storage: "memory",
    });
    getBillingUsage.mockResolvedValue({
      storage: "memory",
      daily: [],
      totals: {
        query_count: 0,
        input_tokens: 0,
        output_tokens: 0,
        total_tokens: 0,
        estimated_cost_microusd: 0,
      },
    });
  }

  it("waits for workspace hydration before loading workspace usage", async () => {
    workspaceAccess.value = {
      authMode: "authenticated",
      canAccessWorkspaceApi: true,
      isWorkspaceLoading: true,
      workspaceId: null,
    };

    render(<BillingOrUsagePage />);

    expect(screen.getByText("Loading usage")).toBeInTheDocument();
    await waitFor(() => {
      expect(getAnalytics).not.toHaveBeenCalled();
      expect(getSystemStatus).not.toHaveBeenCalled();
      expect(getBillingUsage).not.toHaveBeenCalled();
    });
  });

  it("derives the vector backend label from qdrant status flags", async () => {
    mockUsageResponses({ qdrant_configured: true, enable_qdrant: true });
    render(<BillingOrUsagePage />);
    await waitFor(() => { expect(screen.getByText("Vector backend")).toBeInTheDocument(); });
    expect(screen.getByText("qdrant")).toBeInTheDocument();
    expect(screen.queryByText("unknown")).not.toBeInTheDocument();
  });

  it("passes the hydrated workspace id to usage status requests", async () => {
    workspaceAccess.value = {
      authMode: "authenticated",
      canAccessWorkspaceApi: true,
      isWorkspaceLoading: false,
      workspaceId: "workspace-live",
    };
    mockUsageResponses({ qdrant_configured: true, enable_qdrant: true });
    render(<BillingOrUsagePage />);
    await waitFor(() => { expect(getAnalytics).toHaveBeenCalledWith({ workspaceId: "workspace-live" }); });
    expect(getSystemStatus).toHaveBeenCalledWith({ workspaceId: "workspace-live" });
    expect(getApiKeyStatus).toHaveBeenCalledWith({ workspaceId: "workspace-live" });
    expect(getBillingUsage).toHaveBeenCalledWith({ workspaceId: "workspace-live" });
  });

  it("shows unknown instead of zero when provider charges have not been reconciled", async () => {
    mockUsageResponses();
    getBillingUsage.mockResolvedValue({
      storage: "supabase",
      daily: [{ usage_date: "2026-09-25", query_count: 1, total_tokens: 12, estimated_cost_microusd: null, reconciled_at: "2026-09-25T12:00:00Z" }],
      totals: { query_count: 1, total_tokens: 12, estimated_cost_microusd: null },
    });
    render(<BillingOrUsagePage />);
    await waitFor(() => expect(screen.getByText("Unknown", { exact: true })).toBeInTheDocument());
    expect(screen.getByText(/BYOK\) calls are billed by Google/)).toBeInTheDocument();
  });

  it("removes private usage immediately when the account changes", async () => {
    mockUsageResponses();
    const view = render(<BillingOrUsagePage />);
    await screen.findByText("Durable usage ledger");
    getAnalytics.mockImplementationOnce(() => new Promise(() => {}));
    act(() => useStore.setState({ authUser: { id: "user-b", email: null } }));
    view.rerender(<BillingOrUsagePage />);
    expect(screen.getByText("Loading usage")).toBeInTheDocument();
    expect(screen.queryByText("Durable usage ledger")).not.toBeInTheDocument();
  });


  it("never invents free quotas or healthy provider posture from missing measurements", async () => {
    mockUsageResponses();
    getAnalytics.mockResolvedValue({ total_documents: 1, queries_today: 2 });
    getSystemStatus.mockResolvedValue({ settings: {}, capabilities: {}, provider_health: [] });
    getApiKeyStatus.mockRejectedValue(new Error("Key lookup unavailable"));
    render(<BillingOrUsagePage />);
    await screen.findByText("Durable usage ledger");
    expect(screen.getByText("Usage posture not verified")).toBeInTheDocument();
    expect(screen.getAllByText(/Limit not configured/)).toHaveLength(4);
    expect(screen.getByText("Key status unavailable")).toBeInTheDocument();
    expect(screen.getByText(/Missing health observations do not establish availability/)).toBeInTheDocument();
    expect(screen.queryByText("Healthy")).not.toBeInTheDocument();
  });

});
