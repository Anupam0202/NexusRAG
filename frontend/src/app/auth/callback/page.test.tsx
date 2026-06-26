import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { replace, setAuthState, setWorkspaceId } = vi.hoisted(() => ({
  replace: vi.fn(),
  setAuthState: vi.fn(),
  setWorkspaceId: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
}));
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
    replace.mockReset();
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
      user: {
        id: "user-1",
        email: "user@example.com",
        is_demo: false,
      },
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

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/documents"));
    expect(exchangeCodeForSession).toHaveBeenCalledWith("oauth-code");
    expect(setAuthState).toHaveBeenCalledWith("authenticated", {
      id: "user-1",
      email: "user@example.com",
    });
    expect(setWorkspaceId).toHaveBeenCalledWith("workspace-1");
  });

  it("sends authenticated users without a workspace to onboarding", async () => {
    window.history.replaceState({}, "", "/auth/callback?code=oauth-code&next=/documents");
    vi.mocked(getCurrentWorkspace).mockRejectedValueOnce(new Error("no workspace"));

    render(<AuthCallbackPage />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/onboarding"));
    expect(screen.queryByText("Sign-in could not be completed")).not.toBeInTheDocument();
  });
});
