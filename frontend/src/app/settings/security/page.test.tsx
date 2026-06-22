import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getUser, getUserIdentities, setWorkspaceId, signOut } = vi.hoisted(() => ({
  getUser: vi.fn(),
  getUserIdentities: vi.fn(),
  setWorkspaceId: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("@/hooks/useStore", () => ({
  useStore: (selector: (state: object) => unknown) =>
    selector({
      authMode: "authenticated",
      authUser: { id: "user-1", email: "user@example.com" },
      setWorkspaceId,
    }),
}));
vi.mock("@/lib/supabase/client", () => ({
  createSupabaseBrowserClient: () => ({
    auth: { getUser, getUserIdentities, signOut },
  }),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import SecuritySettingsPage from "./page";

describe("SecuritySettingsPage", () => {
  beforeEach(() => {
    getUser.mockReset();
    getUserIdentities.mockReset();
    signOut.mockReset();
    setWorkspaceId.mockReset();
    getUser.mockResolvedValue({
      data: {
        user: {
          email: "user@example.com",
          email_confirmed_at: "2026-06-08T00:00:00Z",
        },
      },
      error: null,
    });
    getUserIdentities.mockResolvedValue({
      data: {
        identities: [
          { id: "private-google-subject", provider: "google" },
          { id: "private-github-subject", provider: "github" },
        ],
      },
      error: null,
    });
    signOut.mockResolvedValue({ error: null });
  });

  it("shows linked OAuth providers without password controls or identity metadata", async () => {
    render(<SecuritySettingsPage />);

    expect(await screen.findByText("Identity verified")).toBeVisible();
    expect(screen.getByText("Google")).toBeVisible();
    expect(screen.getByText("GitHub")).toBeVisible();
    expect(screen.getAllByText("Connected")).toHaveLength(2);
    expect(screen.queryByText(/password/i)).not.toBeInTheDocument();
    expect(screen.queryByText("private-google-subject")).not.toBeInTheDocument();
    expect(screen.queryByText("private-github-subject")).not.toBeInTheDocument();
  });

  it("shows safe guidance when only one provider is linked", async () => {
    getUserIdentities.mockResolvedValue({
      data: {
        identities: [{ id: "private-google-subject", provider: "google" }],
      },
      error: null,
    });

    render(<SecuritySettingsPage />);

    expect(await screen.findByText("Google")).toBeVisible();
    expect(screen.getByText("GitHub")).toBeVisible();
    expect(screen.getByText("Not connected")).toBeVisible();
    expect(
      screen.getByText(
        "One provider is connected. Keep access to that provider account to retain NexusRAG access."
      )
    ).toBeVisible();
  });

  it("supports explicit current-session and all-session sign out scopes", async () => {
    render(<SecuritySettingsPage />);

    fireEvent.click(screen.getByRole("button", { name: "Sign out current session" }));
    await waitFor(() => expect(signOut).toHaveBeenCalledWith({ scope: "local" }));

    fireEvent.click(screen.getByRole("button", { name: "Sign out all sessions" }));
    await waitFor(() => expect(signOut).toHaveBeenCalledWith({ scope: "global" }));
    expect(setWorkspaceId).toHaveBeenCalledWith(null);
  });
});
