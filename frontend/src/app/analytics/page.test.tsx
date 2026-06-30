import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getAnalytics, getAuditEvents, getSystemStatus, healthCheck } = vi.hoisted(() => ({
  getAnalytics: vi.fn(),
  getAuditEvents: vi.fn(),
  getSystemStatus: vi.fn(),
  healthCheck: vi.fn(),
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
  getAuditEvents,
  getSystemStatus,
  healthCheck,
}));

import AnalyticsPage from "./page";

describe("AnalyticsPage", () => {
  beforeEach(() => {
    getAnalytics.mockReset();
    getAuditEvents.mockReset();
    getSystemStatus.mockReset();
    healthCheck.mockReset();
    workspaceAccess.value = {
      authMode: "authenticated",
      canAccessWorkspaceApi: true,
      isWorkspaceLoading: false,
    };

    getAnalytics.mockResolvedValue({
      total_documents: 1,
      total_chunks: 8,
      total_queries: 2,
      avg_response_time: 1.4,
      avg_confidence: 0.7,
      queries_today: 1,
      cache_hits: 0,
      cache_misses: 1,
      cache_entries: 1,
      llm_model_name: "gemini-2.5-flash",
      embedding_model: "all-MiniLM-L6-v2",
      llm_usage_events: 2,
      llm_input_tokens: 10,
      llm_output_tokens: 20,
      llm_total_tokens: 30,
      llm_successful_events: 2,
      llm_error_events: 0,
      llm_fallbacks: 0,
      llm_cache_hits: 0,
      usage_avg_latency_ms: 1400,
      usage_tokens_today: 30,
      audit_events: 1,
      last_activity_at: null,
      quota: null,
    });
    healthCheck.mockResolvedValue({ status: "healthy", total_chunks: 0 });
    getSystemStatus.mockResolvedValue({
      service: "NexusRAG API",
      status: "healthy",
      version: "1.0.0",
      total_documents: 0,
      total_chunks: 0,
      api_key_configured: true,
      llm_model_name: "gemini-2.5-flash",
      embedding_model: "all-MiniLM-L6-v2",
      cache: {},
      capabilities: {},
      settings: {
        memory_constrained: true,
        use_lightweight_embeddings: true,
        vector_backend: "qdrant",
      },
      provider_health: [],
    });
    getAuditEvents.mockResolvedValue({ events: [], total: 0, storage: "supabase" });
  });

  it("shows workspace analytics chunk count instead of global health chunk count", async () => {
    render(<AnalyticsPage />);

    expect(await screen.findByText("8 chunks indexed")).toBeInTheDocument();
    expect(screen.queryByText("0 chunks indexed")).not.toBeInTheDocument();
  });

  it("waits for workspace hydration before requesting workspace analytics", async () => {
    workspaceAccess.value = {
      authMode: "authenticated",
      canAccessWorkspaceApi: true,
      isWorkspaceLoading: true,
    };

    render(<AnalyticsPage />);

    expect(screen.getByText(/Checking/)).toBeInTheDocument();
    await waitFor(() => {
      expect(getAnalytics).not.toHaveBeenCalled();
      expect(getSystemStatus).not.toHaveBeenCalled();
    });
  });
});
