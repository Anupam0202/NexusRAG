import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { navigateStatic, setAuthState, setWorkspaceId, authIdentity } = vi.hoisted(() => ({
  navigateStatic: vi.fn(),
  setAuthState: vi.fn(),
  setWorkspaceId: vi.fn(),
  authIdentity: { authMode: "loading", authUser: null as { id: string } | null },
}));

vi.mock("@/lib/static-navigation", () => ({ navigateStatic }));
vi.mock("@/hooks/useStore", () => ({
  useStore: (
    selector: (state: {
      setAuthState: typeof setAuthState;
      setWorkspaceId: typeof setWorkspaceId;
      authMode: string;
      authUser: { id: string } | null;
    }) => unknown
  ) => selector({ setAuthState, setWorkspaceId, ...authIdentity }),
}));
vi.mock("@/lib/api", () => ({
  getCurrentWorkspace: vi.fn(),
}));
vi.mock("@/lib/supabase/client", () => ({
  hasPublicSupabaseConfig: () => true,
  createSupabaseBrowserClient: vi.fn(),
}));

import AuthCallbackPage from "./page";
import { getCurrentWorkspace } from "@/lib/api";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

describe("AuthCallbackPage", () => {
  const exchangeCodeForSession = vi.fn();
  const getSession = vi.fn();

  beforeEach(() => {
    authIdentity.authMode = "loading";
    authIdentity.authUser = null;
    navigateStatic.mockReset();
    setAuthState.mockReset();
    setWorkspaceId.mockReset();
    exchangeCodeForSession.mockReset();
    getSession.mockReset();
    vi.mocked(getCurrentWorkspace).mockReset();
    vi.mocked(createSupabaseBrowserClient).mockReturnValue({
      auth: {
        exchangeCodeForSession,
        getSession,
      },
    } as unknown as ReturnType<typeof createSupabaseBrowserClient>);
    exchangeCodeForSession.mockResolvedValue({ error: null });
    getSession.mockResolvedValue({
      data: { session: { user: { id: "user-1", email: "user@example.com" } } },
      error: null,
    });
    vi.mocked(getCurrentWorkspace).mockResolvedValue({
      workspace_id: "workspace-1",
      user_id: "user-1",
      role: "owner",
    });
  });

  it("shows provider-neutral recovery guidance", async () => {
    window.history.replaceState(
      {},
      "",
      "/auth/callback?error_description=Sensitive+provider+details"
    );

    render(<AuthCallbackPage />);

    expect(await screen.findByText("Sign-in could not be completed")).toBeVisible();
    expect(
      screen.getByText(
        "Authentication could not be completed. Return to sign in and try again."
      )
    ).toBeVisible();
    expect(screen.queryByText(/sensitive provider details/i)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to sign in" })).toHaveAttribute(
      "href",
      "/auth/login?next=%2Fdocuments"
    );
  });

  it("exchanges an OAuth code, waits for the session, and redirects to the safe destination", async () => {
    window.history.replaceState({}, "", "/auth/callback?code=oauth-code&next=/documents");
    getSession
      .mockResolvedValueOnce({ data: { session: null }, error: null })
      .mockResolvedValueOnce({
        data: { session: { user: { id: "user-1", email: "user@example.com" } } },
        error: null,
      });

    render(<AuthCallbackPage />);

    await waitFor(() => expect(navigateStatic).toHaveBeenCalledWith("/documents"));
    expect(exchangeCodeForSession).toHaveBeenCalledWith("oauth-code");
    expect(setAuthState).toHaveBeenCalledWith("authenticated", {
      id: "user-1",
      email: "user@example.com",
    });
    expect(setWorkspaceId).toHaveBeenCalledWith("workspace-1");
    expect(getCurrentWorkspace).toHaveBeenCalledWith({ workspaceId: null, expectedUserId: "user-1" });
    expect(window.location.search).not.toContain("code=");
  });

  it("continues when a stale code exchange fails but the session is already hydrated", async () => {
    window.history.replaceState({}, "", "/auth/callback?code=stale-oauth-code&next=/documents");
    exchangeCodeForSession.mockResolvedValueOnce({ error: new Error("code already used") });

    render(<AuthCallbackPage />);

    await waitFor(() => expect(navigateStatic).toHaveBeenCalledWith("/documents"));
    expect(exchangeCodeForSession).toHaveBeenCalledWith("stale-oauth-code");
    expect(screen.queryByText("Sign-in could not be completed")).not.toBeInTheDocument();
  });

  it("sends authenticated users without a workspace to onboarding", async () => {
    window.history.replaceState({}, "", "/auth/callback?code=oauth-code&next=/documents");
    vi.mocked(getCurrentWorkspace).mockRejectedValueOnce(Object.assign(new Error("no workspace"), { code: "WORKSPACE_NOT_FOUND" }));

    render(<AuthCallbackPage />);

    await waitFor(() => expect(navigateStatic).toHaveBeenCalledWith("/onboarding"));
    expect(screen.queryByText("Sign-in could not be completed")).not.toBeInTheDocument();
  });
  it("does not publish an unmounted pending OAuth session", async () => {
    window.history.replaceState({}, "", "/auth/callback?code=synthetic-deferred-code");
    let finish!: (value: unknown) => void;
    exchangeCodeForSession.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const { unmount } = render(<AuthCallbackPage />);
    expect(window.location.search).not.toContain("code="); unmount();
    await act(async () => finish({ error: null }));
    expect(setAuthState).not.toHaveBeenCalled(); expect(getCurrentWorkspace).not.toHaveBeenCalled(); expect(navigateStatic).not.toHaveBeenCalled();
  });
  it("does not publish stale discovery or navigate after callback unmount", async () => {
    window.history.replaceState({}, "", "/auth/callback?code=synthetic-code");
    let finish!: (value: Awaited<ReturnType<typeof getCurrentWorkspace>>) => void;
    vi.mocked(getCurrentWorkspace).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const { unmount } = render(<AuthCallbackPage />);
    await waitFor(() => expect(getCurrentWorkspace).toHaveBeenCalledTimes(1)); unmount();
    await act(async () => finish({ workspace_id: "old-workspace", role: "owner", user_id: "user-1" }));
    expect(setWorkspaceId).not.toHaveBeenCalled(); expect(navigateStatic).not.toHaveBeenCalled();
  });
  it("does not treat discovery outages as permission to create another workspace", async () => {
    window.history.replaceState({}, "", "/auth/callback?code=synthetic-code");
    vi.mocked(getCurrentWorkspace).mockRejectedValue(new Error("Synthetic gateway outage"));
    render(<AuthCallbackPage />);
    await screen.findByText(/workspace discovery is unavailable/);
    expect(navigateStatic).not.toHaveBeenCalledWith("/onboarding");
  });
  it("preserves a sanitized callback failure after hydration remounts and URL scrubbing", async () => {
    window.history.replaceState({}, "", "/auth/callback?error_description=Sensitive+provider+details");
    const view = render(<AuthCallbackPage />);
    await screen.findByText("Authentication could not be completed. Return to sign in and try again.");
    expect(window.location.search).not.toContain("error_description");
    authIdentity.authMode = "signed_out";
    view.rerender(<AuthCallbackPage />);
    await screen.findByText("Authentication could not be completed. Return to sign in and try again.");
    expect(screen.queryByText(/sensitive provider details/i)).not.toBeInTheDocument();
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
    expect(navigateStatic).not.toHaveBeenCalled();
  });

  it.each(["/settings/security", "/workspaces?view=invitations", "/onboarding"])("continues to workspace-independent %s without membership discovery", async next => {
    window.history.replaceState({}, "", `/auth/callback?code=synthetic-code&next=${encodeURIComponent(next)}`);
    vi.mocked(getCurrentWorkspace).mockRejectedValue(new Error("Synthetic unavailable membership"));
    render(<AuthCallbackPage />);
    await waitFor(() => expect(navigateStatic).toHaveBeenCalledWith(next));
    expect(getCurrentWorkspace).not.toHaveBeenCalled();
  });

  it("preserves the safe destination on recovery without reflecting provider errors", async () => {
    window.history.replaceState({}, "", "/auth/callback?error=access_denied&error_description=private-payload&next=%2Fsettings%2Fsecurity");
    render(<AuthCallbackPage />);
    expect(await screen.findByRole("link", { name: "Back to sign in" })).toHaveAttribute("href", "/auth/login?next=%2Fsettings%2Fsecurity");
    expect(screen.queryByText(/private-payload/)).not.toBeInTheDocument();
    expect(window.location.search).not.toContain("error_description");
  });

  it("never forwards an external recovery destination", async () => {
    window.history.replaceState({}, "", "/auth/callback?error=access_denied&next=https%3A%2F%2Fattacker.invalid");
    render(<AuthCallbackPage />);
    expect(await screen.findByRole("link", { name: "Back to sign in" })).toHaveAttribute("href", "/auth/login?next=%2Fdocuments");
  });
  it("does not navigate off-site after normalizing an OAuth destination", async () => {
    window.history.replaceState({}, "", "/auth/callback?code=synthetic-code&next=%2Fdocuments%2F..%2F%2Fattacker.invalid");
    render(<AuthCallbackPage />);
    await waitFor(() => expect(navigateStatic).toHaveBeenCalledWith("/documents"));
    expect(navigateStatic).not.toHaveBeenCalledWith("//attacker.invalid");
  });

  it("bounds a stalled code exchange without publishing its late result", async () => {
    vi.useFakeTimers();
    let finish!: (value: { error: null }) => void;
    exchangeCodeForSession.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    window.history.replaceState({}, "", "/auth/callback?code=synthetic-stalled-code&next=%2Fdocuments");
    try {
      const view = render(<AuthCallbackPage />);
      await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
      expect(screen.getByText("Sign-in could not be completed")).toBeVisible();
      expect(window.location.search).not.toContain("code=");
      await act(async () => { finish({ error: null }); });
      expect(setAuthState).not.toHaveBeenCalled();
      expect(getCurrentWorkspace).not.toHaveBeenCalled();
      expect(navigateStatic).not.toHaveBeenCalled();
      view.unmount();
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });

  it("bounds stalled workspace discovery without accepting its late binding", async () => {
    vi.useFakeTimers();
    let finish!: (value: Awaited<ReturnType<typeof getCurrentWorkspace>>) => void;
    vi.mocked(getCurrentWorkspace).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    window.history.replaceState({}, "", "/auth/callback?code=synthetic-code&next=%2Fdocuments");
    try {
      const view = render(<AuthCallbackPage />);
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(getCurrentWorkspace).toHaveBeenCalledOnce();
      await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
      expect(screen.getByText(/workspace discovery is unavailable/)).toBeVisible();
      await act(async () => { finish({ workspace_id: "late-workspace", role: "owner", user_id: "user-1" }); });
      expect(setWorkspaceId).not.toHaveBeenCalled();
      expect(navigateStatic).not.toHaveBeenCalled();
      view.unmount();
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });

});
