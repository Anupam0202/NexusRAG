import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { resetPasswordForEmail } = vi.hoisted(() => ({
  resetPasswordForEmail: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  hasPublicSupabaseConfig: () => true,
  createSupabaseBrowserClient: () => ({ auth: { resetPasswordForEmail } }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

import ForgotPasswordPage from "./page";

describe("ForgotPasswordPage", () => {
  beforeEach(() => {
    resetPasswordForEmail.mockReset();
    resetPasswordForEmail.mockResolvedValue({ error: null });
  });

  it("requests recovery and shows an account-enumeration-safe response", async () => {
    render(<ForgotPasswordPage />);

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "USER@Example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Send reset link" }));

    await waitFor(() =>
      expect(resetPasswordForEmail).toHaveBeenCalledWith(
        "user@example.com",
        expect.objectContaining({
          redirectTo: expect.stringContaining("/auth/confirm?next=%2Fauth%2Fupdate-password"),
        })
      )
    );
    expect(
      await screen.findByText("If an account exists for that email, a password-reset link has been sent.")
    ).toBeVisible();
  });
});
