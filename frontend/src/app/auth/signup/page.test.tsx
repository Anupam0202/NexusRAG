import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { replace, signUp } = vi.hoisted(() => ({
  replace: vi.fn(),
  signUp: vi.fn(),
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
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import SignupPage from "./page";

describe("SignupPage", () => {
  beforeEach(() => {
    replace.mockReset();
    signUp.mockReset();
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
});
