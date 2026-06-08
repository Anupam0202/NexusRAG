import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { resetPasswordForEmail, toastError } = vi.hoisted(() => ({
  resetPasswordForEmail: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  hasPublicSupabaseConfig: () => true,
  createSupabaseBrowserClient: () => ({ auth: { resetPasswordForEmail } }),
}));
vi.mock("sonner", () => ({ toast: { error: toastError } }));

import ForgotPasswordPage from "./page";

describe("ForgotPasswordPage", () => {
  beforeEach(() => {
    resetPasswordForEmail.mockReset();
    toastError.mockReset();
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

  it("shows an actionable safe message when recovery email delivery is rate-limited", async () => {
    resetPasswordForEmail.mockResolvedValue({
      error: {
        code: "over_email_send_rate_limit",
        status: 429,
        message: "email rate limit exceeded",
      },
    });
    render(<ForgotPasswordPage />);

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "user@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Send reset link" }));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        "Verification email requests are temporarily rate-limited. Wait a few minutes and try again."
      )
    );
  });
});
