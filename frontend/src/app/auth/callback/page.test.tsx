import { render, screen } from "@testing-library/react";
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

describe("AuthCallbackPage", () => {
  beforeEach(() => {
    replace.mockReset();
    setAuthState.mockReset();
    setWorkspaceId.mockReset();
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
});
