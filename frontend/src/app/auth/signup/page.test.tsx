import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { replace, signUp, toastSuccess } = vi.hoisted(() => ({
  replace: vi.fn(),
  signUp: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
}));
vi.mock("@/hooks/useStore", () => ({
  useStore: (selector: (state: { authMode: string }) => unknown) =>
    selector({ authMode: "signed_out" }),
}));
vi.mock("@/lib/supabase/client", () => ({
  hasPublicSupabaseConfig: () => true,
  createSupabaseBrowserClient: () => ({ auth: { signUp } }),
}));
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: vi.fn() } }));

import SignupPage from "./page";

describe("SignupPage", () => {
  beforeEach(() => {
    replace.mockReset();
    signUp.mockReset();
    toastSuccess.mockReset();
    signUp.mockResolvedValue({ error: null });
  });

  it("creates a password account and requires email verification", async () => {
    render(<SignupPage />);

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "USER@Example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "SecurePass1!" } });
    fireEvent.change(screen.getByLabelText("Confirm password"), {
      target: { value: "SecurePass1!" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() =>
      expect(signUp).toHaveBeenCalledWith({
        email: "user@example.com",
        password: "SecurePass1!",
        options: expect.objectContaining({
          emailRedirectTo: expect.stringContaining("/auth/callback"),
        }),
      })
    );
    expect(await screen.findByText("Verify your email")).toBeVisible();
    expect(
      screen.getByText(/If this address can be registered, a confirmation link has been requested/i)
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/auth/login");
    expect(screen.getByRole("link", { name: "Reset password" })).toHaveAttribute(
      "href",
      "/auth/forgot-password"
    );
    expect(toastSuccess).toHaveBeenCalledWith("Verification requested");
  });

  it("does not call Supabase for a weak or mismatched password", () => {
    render(<SignupPage />);

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "user@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "weak" } });
    fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "different" } });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    expect(signUp).not.toHaveBeenCalled();
    expect(
      screen.getByText("Use 12-128 characters with uppercase, lowercase, a number, and a symbol.")
    ).toBeVisible();
  });

  it("shows an actionable safe message when verification email delivery is rate-limited", async () => {
    signUp.mockResolvedValue({
      error: {
        code: "over_email_send_rate_limit",
        status: 429,
        message: "email rate limit exceeded",
      },
    });
    render(<SignupPage />);

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "user@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "SecurePass1!" } });
    fireEvent.change(screen.getByLabelText("Confirm password"), {
      target: { value: "SecurePass1!" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    expect(
      await screen.findByText(
        "Verification email requests are temporarily rate-limited. Wait a few minutes and try again."
      )
    ).toBeVisible();
  });
});
