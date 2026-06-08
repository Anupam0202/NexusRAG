import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { replace, resend, signUp, toastError, toastSuccess } = vi.hoisted(() => ({
  replace: vi.fn(),
  resend: vi.fn(),
  signUp: vi.fn(),
  toastError: vi.fn(),
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
  createSupabaseBrowserClient: () => ({ auth: { resend, signUp } }),
}));
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: toastError } }));

import SignupPage from "./page";

describe("SignupPage", () => {
  beforeEach(() => {
    replace.mockReset();
    resend.mockReset();
    signUp.mockReset();
    toastError.mockReset();
    toastSuccess.mockReset();
    resend.mockResolvedValue({ error: null });
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

  it("allows a safe confirmation email resend after signup", async () => {
    render(<SignupPage />);

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "USER@Example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "SecurePass1!" } });
    fireEvent.change(screen.getByLabelText("Confirm password"), {
      target: { value: "SecurePass1!" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    const resendButton = await screen.findByRole("button", { name: "Resend confirmation email" });
    fireEvent.click(resendButton);

    await waitFor(() =>
      expect(resend).toHaveBeenCalledWith({
        type: "signup",
        email: "user@example.com",
        options: expect.objectContaining({
          emailRedirectTo: expect.stringContaining("/auth/callback"),
        }),
      })
    );
    expect(
      await screen.findByText(
        "If the account is awaiting verification, a new confirmation link has been requested."
      )
    ).toBeVisible();
  });

  it("rate-limits failed confirmation email resend attempts in the UI", async () => {
    resend.mockResolvedValue({
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
    fireEvent.click(await screen.findByRole("button", { name: "Resend confirmation email" }));

    expect(
      await screen.findByText(
        "Verification email requests are temporarily rate-limited. Wait a few minutes and try again."
      )
    ).toBeVisible();
    expect(screen.getByRole("button", { name: /Resend available in/ })).toBeDisabled();
    expect(toastError).toHaveBeenCalled();
  });
});
