import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getUser, setWorkspaceId, signOut, updateUser } = vi.hoisted(() => ({
  getUser: vi.fn(),
  setWorkspaceId: vi.fn(),
  signOut: vi.fn(),
  updateUser: vi.fn(),
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
  createSupabaseBrowserClient: () => ({ auth: { getUser, signOut, updateUser } }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import SecuritySettingsPage from "./page";

describe("SecuritySettingsPage", () => {
  beforeEach(() => {
    getUser.mockReset();
    signOut.mockReset();
    updateUser.mockReset();
    setWorkspaceId.mockReset();
    getUser.mockResolvedValue({
      data: { user: { email: "user@example.com", email_confirmed_at: "2026-06-08T00:00:00Z" } },
    });
    signOut.mockResolvedValue({ error: null });
    updateUser.mockResolvedValue({ error: null });
  });

  it("shows verified account posture and changes the password", async () => {
    render(<SecuritySettingsPage />);

    expect(await screen.findByText("Email verified")).toBeVisible();
    fireEvent.change(screen.getByLabelText("New password"), {
      target: { value: "SecurePass1!" },
    });
    fireEvent.change(screen.getByLabelText("Confirm new password"), {
      target: { value: "SecurePass1!" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Change password" }));

    await waitFor(() =>
      expect(updateUser).toHaveBeenCalledWith({ password: "SecurePass1!" })
    );
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
