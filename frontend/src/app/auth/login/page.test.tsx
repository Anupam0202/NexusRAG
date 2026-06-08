import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { replace, signInWithOtp, signInWithPassword } = vi.hoisted(() => ({
  replace: vi.fn(),
  signInWithOtp: vi.fn(),
  signInWithPassword: vi.fn(),
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
  createSupabaseBrowserClient: () => ({
    auth: { signInWithOtp, signInWithPassword },
  }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import LoginPage from "./page";

describe("LoginPage", () => {
  beforeEach(() => {
    replace.mockReset();
    signInWithOtp.mockReset();
    signInWithPassword.mockReset();
    signInWithOtp.mockResolvedValue({ error: null });
    signInWithPassword.mockResolvedValue({ error: null });
  });

  it("defaults to password sign-in", async () => {
    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "USER@Example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "SecurePass1!" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() =>
      expect(signInWithPassword).toHaveBeenCalledWith({
        email: "user@example.com",
        password: "SecurePass1!",
      })
    );
    expect(signInWithOtp).not.toHaveBeenCalled();
  });

  it("keeps magic-link sign-in as an optional secondary method", async () => {
    render(<LoginPage />);

    fireEvent.click(screen.getByRole("button", { name: "Magic link" }));
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "user@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Send magic link" }));

    await waitFor(() =>
      expect(signInWithOtp).toHaveBeenCalledWith(
        expect.objectContaining({
          email: "user@example.com",
          options: expect.objectContaining({ shouldCreateUser: false }),
        })
      )
    );
  });

  it("shows a generic inline error instead of provider details", async () => {
    signInWithPassword.mockResolvedValue({ error: new Error("user not found: sensitive detail") });
    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "user@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "WrongPass1!" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(
      await screen.findByText("We could not sign you in with those credentials.")
    ).toBeVisible();
    expect(screen.queryByText(/sensitive detail/i)).not.toBeInTheDocument();
  });

  it("shows an actionable safe message when magic-link email delivery is rate-limited", async () => {
    signInWithOtp.mockResolvedValue({
      error: {
        code: "over_email_send_rate_limit",
        status: 429,
        message: "email rate limit exceeded",
      },
    });
    render(<LoginPage />);

    fireEvent.click(screen.getByRole("button", { name: "Magic link" }));
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "user@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Send magic link" }));

    expect(
      await screen.findByText(
        "Verification email requests are temporarily rate-limited. Wait a few minutes and try again."
      )
    ).toBeVisible();
  });
});
