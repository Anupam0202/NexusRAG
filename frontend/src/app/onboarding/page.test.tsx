import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const { createWorkspace, getCurrentWorkspace, getSession, navigate, setWorkspace, setAuth } = vi.hoisted(() => ({ createWorkspace: vi.fn(), getCurrentWorkspace: vi.fn(), getSession: vi.fn(), navigate: vi.fn(), setWorkspace: vi.fn(), setAuth: vi.fn() }));
vi.mock("@/lib/api", () => ({ createWorkspace, getCurrentWorkspace }));
vi.mock("@/lib/supabase/client", () => ({ hasPublicSupabaseConfig: () => true, createSupabaseBrowserClient: () => ({ auth: { getSession } }) }));
vi.mock("@/lib/static-navigation", () => ({ navigateStatic: navigate }));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));
import { useStore } from "@/hooks/useStore";
import OnboardingPage from "./page";
describe("onboarding account authority", () => {
  beforeEach(() => {
    [createWorkspace, getCurrentWorkspace, getSession, navigate, setWorkspace, setAuth].forEach(mock => mock.mockReset());
    getSession.mockResolvedValue({ data: { session: { user: { id: "user-a", email: null } } } });
    getCurrentWorkspace.mockRejectedValue(Object.assign(new Error("No workspace"), { code: "WORKSPACE_NOT_FOUND" }));
    useStore.setState({ authMode: "authenticated", authUser: { id: "user-a", email: null }, workspaceId: null, setWorkspaceId: setWorkspace, setAuthState: setAuth });
  });
  it("does not publish a stale session after switching accounts", async () => {
    let finish!: (value: unknown) => void;
    getSession.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    render(<OnboardingPage />); getSession.mockImplementationOnce(() => new Promise(() => {}));
    act(() => useStore.setState({ authUser: { id: "user-b", email: null } }));
    await act(async () => finish({ data: { session: { user: { id: "user-a" } } } }));
    expect(setAuth).not.toHaveBeenCalled(); expect(getCurrentWorkspace).not.toHaveBeenCalled(); expect(navigate).not.toHaveBeenCalled();
  });
  it("binds workspace creation to its account and ignores old-account completion", async () => {
    let finish!: (value: unknown) => void; createWorkspace.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    render(<OnboardingPage />); await screen.findByRole("button", { name: "Create workspace" });
    fireEvent.click(screen.getByRole("button", { name: "Create workspace" }));
    expect(createWorkspace).toHaveBeenCalledWith({ name: "My Workspace", slug: null }, { workspaceId: null, expectedUserId: "user-a" });
    getSession.mockImplementationOnce(() => new Promise(() => {}));
    act(() => useStore.setState({ authUser: { id: "user-b", email: null } }));
    await act(async () => finish({ id: "old-workspace" }));
    expect(setWorkspace).not.toHaveBeenCalled(); expect(navigate).not.toHaveBeenCalled();
  });
  it("does not offer duplicate workspace creation during discovery outage", async () => {
    getCurrentWorkspace.mockRejectedValue(new Error("Synthetic gateway unavailable"));
    render(<OnboardingPage />);
    await screen.findByText(/Workspace discovery could not be completed/);
    expect(screen.getByRole("button", { name: "Create workspace" })).toBeDisabled();
  });
  it("shows session failure instead of an endless loading state or usable creation", async () => {
    getSession.mockRejectedValue(new Error("Session unavailable"));
    useStore.setState({ authMode: "signed_out", authUser: null }); render(<OnboardingPage />);
    await waitFor(() => expect(screen.getByText("Unable to verify your session. Sign in and retry.")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Create workspace" })).toBeDisabled();
  });
});
