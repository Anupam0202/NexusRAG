import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSystemStatus } = vi.hoisted(() => ({
  getSystemStatus: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/documents",
}));
vi.mock("@/components/auth/AuthMenu", () => ({
  AuthMenu: () => <div data-testid="auth-menu" />,
}));
vi.mock("@/lib/api", () => ({
  getSystemStatus,
}));

import { useStore } from "@/hooks/useStore";
import { Header } from "./Header";

describe("Header", () => {
  beforeEach(() => {
    useStore.setState({ connectionStatus: "checking" });
    getSystemStatus.mockReset();
  });

  it("does not show Backend live when Supabase persistence is unauthorized", async () => {
    getSystemStatus.mockResolvedValue({
      service: "NexusRAG API",
      status: "degraded",
      version: "1.0.0",
      total_documents: 0,
      total_chunks: 0,
      api_key_configured: true,
      llm_model_name: "gemini",
      embedding_model: "mini",
      cache: {},
      capabilities: {},
      settings: {
        anonymous_demo_enabled: false,
        supabase_configured: true,
        supabase_auth_configured: true,
        supabase_data_api_reachable: false,
        supabase_data_api_status: "unauthorized",
      },
    });

    render(<Header />);

    expect(await screen.findByText("Data setup required")).toBeInTheDocument();
    expect(screen.queryByText("Backend live")).not.toBeInTheDocument();
    await waitFor(() =>
      expect(useStore.getState().connectionStatus).toBe("data_setup_required")
    );
  });
});
