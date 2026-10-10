import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getAnalytics, getAuditEvents, getSystemStatus, healthCheck } = vi.hoisted(() => ({
  getAnalytics: vi.fn(),
  getAuditEvents: vi.fn(),
  getSystemStatus: vi.fn(),
  healthCheck: vi.fn(),
}));
const workspaceAccess = vi.hoisted(() => ({
  value: {
    workspaceId: "workspace-a",
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
import { useStore } from "@/hooks/useStore";

describe("AnalyticsPage", () => {
  beforeEach(() => {
    getAnalytics.mockReset();
    getAuditEvents.mockReset();
    getSystemStatus.mockReset();
    healthCheck.mockReset();
    useStore.setState({ authMode: "authenticated", authUser: { id: "user-a", email: null }, workspaceId: "workspace-a" });
    workspaceAccess.value = {
      workspaceId: "workspace-a",
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
    useStore.setState({ authMode: "authenticated", authUser: { id: "user-a", email: null }, workspaceId: "workspace-a" });
    workspaceAccess.value = {
      workspaceId: "workspace-a",
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

  it("passes explicit workspace authority to every private analytics request", async () => {
    render(<AnalyticsPage />);
    await screen.findByText("8 chunks indexed");
    expect(getAnalytics).toHaveBeenCalledWith({ workspaceId: "workspace-a" });
    expect(getSystemStatus).toHaveBeenCalledWith({ workspaceId: "workspace-a" });
    expect(getAuditEvents).toHaveBeenCalledWith(8, { workspaceId: "workspace-a" });
  });

  it("clears old workspace results immediately and ignores pending responses", async () => {
    let finishOld!: (value: unknown) => void;
    getAnalytics.mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve; }));
    const view = render(<AnalyticsPage />);
    await waitFor(() => expect(getAnalytics).toHaveBeenCalledTimes(1));
    workspaceAccess.value.workspaceId = "workspace-b";
    act(() => useStore.setState({ workspaceId: "workspace-b" }));
    view.rerender(<AnalyticsPage />);
    await screen.findByText("8 chunks indexed");
    await act(async () => finishOld({ total_chunks: 999, total_queries: 999 }));
    expect(screen.queryByText("999 chunks indexed")).not.toBeInTheDocument();
    expect(getAuditEvents).toHaveBeenLastCalledWith(8, { workspaceId: "workspace-b" });
  });

  it("does not mistake configuration or missing usage for verified readiness", async () => {
    getAnalytics.mockResolvedValue({ total_documents: 1, total_chunks: 8, total_queries: 2,
      avg_response_time: 0, avg_confidence: 0, cache_hits: 0, cache_misses: 0,
      measurement_states: { avg_response_time: "NOT_MEASURED", avg_confidence: "NOT_MEASURED", cache: "DISABLED" } });
    healthCheck.mockResolvedValue({ status: "CONFIGURED", readiness: "NOT_PROBED", total_chunks: 1000 });
    getSystemStatus.mockResolvedValue({ status: "CONFIGURED", readiness: "NOT_PROBED", settings: {}, capabilities: { semantic_cache: false } });
    getAuditEvents.mockRejectedValue(new Error("Unavailable"));
    render(<AnalyticsPage />);
    expect(await screen.findByText("API responding — dependency readiness is not verified")).toBeInTheDocument();
    expect(screen.queryByText("All systems operational")).not.toBeInTheDocument();
    expect(screen.queryByText("1000 chunks indexed")).not.toBeInTheDocument();
    expect(screen.getAllByText(/Not measured/).length).toBeGreaterThan(3);
    expect(screen.getByText("Semantic cache is disabled in this runtime")).toBeInTheDocument();
    expect(screen.getByText("Audit trail could not be loaded. Refresh to retry.")).toBeInTheDocument();
  });


  it("removes rendered private audit records on identity change before replacement loads", async () => {
    getAuditEvents.mockResolvedValueOnce({ events: [{ action: "private.workspace.a", workspace_id: "workspace-a", metadata: {} }], storage: "supabase" });
    const view = render(<AnalyticsPage />);
    await screen.findByText("Private Workspace A");
    getAnalytics.mockImplementationOnce(() => new Promise(() => {}));
    act(() => useStore.setState({ authUser: { id: "user-b", email: null } }));
    view.rerender(<AnalyticsPage />);
    expect(screen.queryByText("Private Workspace A")).not.toBeInTheDocument();
    expect(screen.queryByText("8 chunks indexed")).not.toBeInTheDocument();
  });

});
