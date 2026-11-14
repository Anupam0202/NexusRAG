import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStore } from "@/hooks/useStore";
const { route, reload } = vi.hoisted(() => ({ route: { path: "/settings/privacy" }, reload: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => route.path }));
vi.mock("@/lib/static-navigation", () => ({ reloadStatic: reload }));
import { WorkspaceDiscoveryBoundary, isWorkspaceRoute } from "./WorkspaceDiscoveryBoundary";

describe("workspace discovery route boundary", () => {
  beforeEach(() => {
    route.path = "/settings/privacy"; reload.mockReset();
    useStore.setState({ authMode: "authenticated", workspaceId: null, workspaceDiscovery: "loading" });
  });
  afterEach(cleanup);
  const mount = () => render(<WorkspaceDiscoveryBoundary><div>Private route content</div></WorkspaceDiscoveryBoundary>);
  it("does not mount private content during membership discovery", () => {
    mount();
    expect(screen.getByRole("status")).toHaveTextContent("Verifying");
    expect(screen.queryByText("Private route content")).not.toBeInTheDocument();
  });
  it("offers onboarding only after confirmed absence", () => {
    useStore.setState({ workspaceDiscovery: "missing" }); mount();
    expect(screen.getByRole("link", { name: "Continue to onboarding" })).toHaveAttribute("href", "/onboarding");
    expect(screen.queryByText("Private route content")).not.toBeInTheDocument();
  });
  it("offers retry without inventing workspace creation on outage", () => {
    useStore.setState({ workspaceDiscovery: "error" }); mount();
    expect(screen.getByRole("heading")).toHaveTextContent("unavailable");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry workspace discovery" }));
    expect(reload).toHaveBeenCalledOnce();
  });
  it.each(["demo", "signed_out"] as const)("preserves %s route behavior", authMode => {
    useStore.setState({ authMode }); mount(); expect(screen.getByText("Private route content")).toBeInTheDocument();
  });
  it("preserves selected workspace content on a transient validation error", () => {
    useStore.setState({ workspaceId: "selected", workspaceDiscovery: "error" }); mount();
    expect(screen.getByText("Private route content")).toBeInTheDocument();
  });
  it.each(["/auth/login", "/auth/callback", "/onboarding", "/evidence-os"])("does not intercept %s", path => {
    route.path = path; mount(); expect(screen.getByText("Private route content")).toBeInTheDocument();
  });
  it.each(["loading", "missing", "error"] as const)("keeps account security and workspace acceptance reachable during %s discovery", discovery => {
    useStore.setState({ workspaceDiscovery: discovery });
    for (const path of ["/settings/security", "/workspaces"]) {
      route.path = path;
      const view = mount();
      expect(screen.getByText("Private route content")).toBeInTheDocument();
      expect(screen.queryByText("Continue to onboarding")).not.toBeInTheDocument();
      view.unmount();
    }
  });
  it.each(["/settings/privacy", "/settings/members", "/documents/id", "/findings", "/workspaces/private"])("still gates workspace-dependent %s", path => {
    route.path = path; mount();
    expect(screen.queryByText("Private route content")).not.toBeInTheDocument();
  });
  it("classifies query, fragment, and trailing-slash variants consistently", () => {
    expect(isWorkspaceRoute("/settings/security/?tab=sessions#providers")).toBe(false);
    expect(isWorkspaceRoute("/workspaces?invitation=synthetic")).toBe(false);
    expect(isWorkspaceRoute("/documents/?status=ready")).toBe(true);
    expect(isWorkspaceRoute("/settings/security/private")).toBe(true);
  });
  it("uses exact path prefixes rather than blocking similarly named public routes", () => {
    expect(isWorkspaceRoute("/settings/privacy")).toBe(true);
    expect(isWorkspaceRoute("/documents/id")).toBe(true);
    expect(isWorkspaceRoute("/settings-guide")).toBe(false);
  });
});
