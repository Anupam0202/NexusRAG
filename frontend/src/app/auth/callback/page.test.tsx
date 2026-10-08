import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { navigateStatic, setAuthState, setWorkspaceId } = vi.hoisted(() => ({
  navigateStatic: vi.fn(),
  setAuthState: vi.fn(),
  setWorkspaceId: vi.fn(),
}));

vi.mock("@/lib/static-navigation", () => ({ navigateStatic }));
vi.mock("@/hooks/useStore", () => ({
  useStore: (
    selector: (state: {
      setAuthState: typeof setAuthState;
      setWorkspaceId: typeof setWorkspaceId;
    }) => unknown
  ) => selector({ setAuthState, setWorkspaceId }),
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
      "/auth/login"
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

});
