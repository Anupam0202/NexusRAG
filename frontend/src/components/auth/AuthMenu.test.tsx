import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { replace, setWorkspaceId, signOut, toastError } = vi.hoisted(() => ({
  replace: vi.fn(),
  setWorkspaceId: vi.fn(),
  signOut: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
}));
vi.mock("@/hooks/useStore", () => ({
  useStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      authMode: "authenticated",
      authUser: { id: "user-1", email: "user@example.com" },
      workspaceId: "workspace-1",
      setWorkspaceId,
    }),
}));
vi.mock("@/lib/supabase/client", () => ({
  hasPublicSupabaseConfig: () => true,
  createSupabaseBrowserClient: () => ({ auth: { signOut } }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: toastError } }));

import { AuthMenu } from "./AuthMenu";

describe("AuthMenu", () => {
  beforeEach(() => {
    replace.mockReset();
    setWorkspaceId.mockReset();
    signOut.mockReset();
    toastError.mockReset();
    signOut.mockResolvedValue({ error: null });
  });

  it("returns the user to sign in after ending the local session", async () => {
    render(<AuthMenu />);

    fireEvent.click(screen.getByRole("button", { name: "user@example.com" }));
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));

    await waitFor(() => expect(signOut).toHaveBeenCalledWith({ scope: "local" }));
    expect(setWorkspaceId).toHaveBeenCalledWith(null);
    expect(replace).toHaveBeenCalledWith("/auth/login");
  });

  it("does not expose raw provider errors when sign out fails", async () => {
    signOut.mockResolvedValue({ error: new Error("sensitive provider detail") });
    render(<AuthMenu />);

    fireEvent.click(screen.getByRole("button", { name: "user@example.com" }));
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("Unable to sign out. Please try again.")
    );
    expect(toastError).not.toHaveBeenCalledWith("sensitive provider detail");
    expect(replace).not.toHaveBeenCalled();
  });
});
