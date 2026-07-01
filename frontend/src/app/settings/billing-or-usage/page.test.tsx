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
    mockUsageResponses({
      qdrant_configured: true,
      enable_qdrant: true,
    });

    render(<BillingOrUsagePage />);

    await waitFor(() => {
      expect(screen.getByText("Vector backend")).toBeInTheDocument();
    });
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
    mockUsageResponses({
      qdrant_configured: true,
      enable_qdrant: true,
    });

    render(<BillingOrUsagePage />);

    await waitFor(() => {
      expect(getAnalytics).toHaveBeenCalledWith({ workspaceId: "workspace-live" });
    });
    expect(getSystemStatus).toHaveBeenCalledWith({ workspaceId: "workspace-live" });
    expect(getApiKeyStatus).toHaveBeenCalledWith({ workspaceId: "workspace-live" });
    expect(getBillingUsage).toHaveBeenCalledWith({ workspaceId: "workspace-live" });
  });
});
