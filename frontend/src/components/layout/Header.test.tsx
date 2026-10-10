import { act, render, screen, waitFor } from "@testing-library/react";
import { Profiler } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSystemStatus } = vi.hoisted(() => ({
  getSystemStatus: vi.fn(),
}));
const route = vi.hoisted(() => ({ value: "/documents" }));

vi.mock("next/navigation", () => ({
  usePathname: () => route.value,
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
    useStore.setState({ connectionStatus: "checking", authMode: "authenticated", authUser: { id: "synthetic-user", email: null }, workspaceId: "synthetic-workspace" });
    getSystemStatus.mockReset();
    route.value = "/documents";
  });
  it("uses the actual Evidence OS route title instead of Chat", async () => {
    route.value = "/evidence-os";
    getSystemStatus.mockRejectedValue(new Error("Offline fixture"));
    render(<Header />);
    expect(screen.getByRole("heading", { name: "Evidence OS" })).toBeInTheDocument();
    await waitFor(() => expect(useStore.getState().connectionStatus).toBe("offline"));
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
    expect(getSystemStatus).toHaveBeenCalledWith({ workspaceId: "synthetic-workspace", expectedUserId: "synthetic-user" });
  });

  it("reports sign-in required rather than backend offline for an unauthenticated status request", async () => {
    getSystemStatus.mockRejectedValue(
      Object.assign(new Error("Authentication is required."), { code: "AUTH_REQUIRED" })
    );

    render(<Header />);

    expect(await screen.findByText("Sign in required")).toBeInTheDocument();
    expect(screen.queryByText("Backend offline")).not.toBeInTheDocument();
    await waitFor(() =>
      expect(useStore.getState().connectionStatus).toBe("auth_required")
    );
  });

  it.each([
    ["loading", "Checking workspace"],
    ["missing", "Workspace required"],
    ["error", "Workspace unavailable"],
  ] as const)("does not probe private status for %s workspace discovery", (workspaceDiscovery, label) => {
    useStore.setState({ workspaceId: null, workspaceDiscovery, connectionStatus: "online" });
    render(<Header />);
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.queryByText("Backend offline")).not.toBeInTheDocument();
    expect(screen.queryByText("Gateway reachable")).not.toBeInTheDocument();
    expect(getSystemStatus).not.toHaveBeenCalled();
  });

  it("drops a pending previous-workspace status when its authority is cleared", async () => {
    let finish!: (status: unknown) => void;
    getSystemStatus.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    render(<Header />);
    await waitFor(() => expect(getSystemStatus).toHaveBeenCalledOnce());
    act(() => useStore.setState({ workspaceId: null, workspaceDiscovery: "missing" }));
    await act(async () => finish({ settings: { anonymous_demo_enabled: true } }));
    expect(screen.getByText("Workspace required")).toBeInTheDocument();
    expect(useStore.getState().connectionStatus).toBe("checking");
    expect(getSystemStatus).toHaveBeenCalledOnce();
  });

  it("reports an identity-context failure as authentication, not an outage", async () => {
    getSystemStatus.mockRejectedValue(Object.assign(new Error("Synthetic account changed"), { code: "AUTH_CONTEXT_CHANGED" }));
    render(<Header />);
    expect(await screen.findByText("Sign in required")).toBeInTheDocument();
    expect(screen.queryByText("Backend offline")).not.toBeInTheDocument();
  });

  it("does not rerender the header for unrelated streaming/document updates", () => {
    getSystemStatus.mockImplementation(() => new Promise(() => {}));
    const onRender = vi.fn();
    render(<Profiler id="header" onRender={onRender}><Header /></Profiler>);
    const renders = onRender.mock.calls.length;
    act(() => {
      useStore.getState().addUserMessage("Synthetic streaming fixture");
      useStore.setState({ documents: [] });
    });
    expect(onRender).toHaveBeenCalledTimes(renders);
    expect(getSystemStatus).toHaveBeenCalledOnce();
  });
});
