import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { replace, updateUser } = vi.hoisted(() => ({
  replace: vi.fn(),
  updateUser: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
}));
vi.mock("@/hooks/useStore", () => ({
  useStore: (selector: (state: { authMode: string }) => unknown) =>
    selector({ authMode: "authenticated" }),
}));
vi.mock("@/lib/supabase/client", () => ({
  createSupabaseBrowserClient: () => ({ auth: { updateUser } }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import UpdatePasswordPage from "./page";

describe("UpdatePasswordPage", () => {
  beforeEach(() => {
    replace.mockReset();
    updateUser.mockReset();
    updateUser.mockResolvedValue({ error: null });
  });

  it("updates a strong matching password", async () => {
    render(<UpdatePasswordPage />);

    fireEvent.change(screen.getByLabelText("New password"), {
      target: { value: "SecurePass1!" },
    });
    fireEvent.change(screen.getByLabelText("Confirm new password"), {
      target: { value: "SecurePass1!" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Update password" }));

    await waitFor(() =>
      expect(updateUser).toHaveBeenCalledWith({ password: "SecurePass1!" })
    );
    expect(replace).toHaveBeenCalledWith("/settings/security");
  });

  it("does not update a weak password", () => {
    render(<UpdatePasswordPage />);

    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "weak" } });
    fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: "weak" } });
    fireEvent.click(screen.getByRole("button", { name: "Update password" }));

    expect(updateUser).not.toHaveBeenCalled();
    expect(
      screen.getByText("Use 12-128 characters with uppercase, lowercase, a number, and a symbol.")
    ).toBeVisible();
  });
});
