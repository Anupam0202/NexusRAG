import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { authState, configState, replace, signInWithOAuth, toastError } = vi.hoisted(() => ({
  authState: { mode: "signed_out" },
  configState: { ready: true },
  replace: vi.fn(),
  signInWithOAuth: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
}));
vi.mock("@/hooks/useStore", () => ({
  useStore: (selector: (state: { authMode: string }) => unknown) =>
    selector({ authMode: authState.mode }),
}));
vi.mock("@/lib/supabase/client", () => ({
  hasPublicSupabaseConfig: () => configState.ready,
  createSupabaseBrowserClient: () => ({
    auth: { signInWithOAuth },
  }),
}));
vi.mock("sonner", () => ({ toast: { error: toastError } }));

import LoginPage from "./page";

describe("LoginPage", () => {
  beforeEach(() => {
    authState.mode = "signed_out";
    configState.ready = true;
    replace.mockReset();
    signInWithOAuth.mockReset();
    toastError.mockReset();
    signInWithOAuth.mockResolvedValue({ error: null });
    process.env.NEXT_PUBLIC_SITE_URL = "https://nexusrag.vercel.app";
    delete process.env.NEXT_PUBLIC_OAUTH_PROVIDERS;
    window.history.replaceState({}, "", "/auth/login");
  });

  it("defaults to the verified GitHub provider", () => {
    render(<LoginPage />);

    expect(
      screen.getAllByRole("button").map((button) => button.textContent?.trim())
    ).toEqual(["Continue with GitHub"]);
  });

  it("renders Google before GitHub when both providers are enabled", () => {
    process.env.NEXT_PUBLIC_OAUTH_PROVIDERS = "google,github";

    render(<LoginPage />);

    expect(
      screen.getAllByRole("button").map((button) => button.textContent?.trim())
    ).toEqual(["Continue with Google", "Continue with GitHub"]);
  });

  it("keeps provider choices visible but disabled when Supabase is not configured", () => {
    configState.ready = false;
    process.env.NEXT_PUBLIC_OAUTH_PROVIDERS = "google,github";

    render(<LoginPage />);

    expect(screen.getByRole("button", { name: "Continue with Google" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Continue with GitHub" })).toBeDisabled();
    expect(
      screen.getByText(
        "Supabase browser variables are missing from this frontend deployment."
      )
    ).toBeVisible();
  });

  it.each(["google", "github"] as const)("starts the %s OAuth flow", async (provider) => {
    process.env.NEXT_PUBLIC_OAUTH_PROVIDERS = "google,github";
    render(<LoginPage />);

    const button = screen.getByRole("button", {
      name: provider === "google" ? "Continue with Google" : "Continue with GitHub",
    });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);

    await waitFor(() =>
      expect(signInWithOAuth).toHaveBeenCalledWith({
        provider,
        options: {
          redirectTo: "http://localhost:3000/auth/callback?next=%2Fdocuments",
        },
      })
    );
  });

  it("uses onboarding for signup intent and blocks duplicate starts", async () => {
    process.env.NEXT_PUBLIC_OAUTH_PROVIDERS = "google,github";
    window.history.replaceState({}, "", "/auth/login?intent=signup");
    let resolveRequest: (value: { error: null }) => void = () => undefined;
    signInWithOAuth.mockReturnValue(
      new Promise((resolve) => {
        resolveRequest = resolve;
      })
    );
    render(<LoginPage />);

    expect(await screen.findByText("Create your NexusRAG account")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Continue with Google" }));

    expect(
      await screen.findByRole("button", { name: "Connecting with Google" })
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Continue with GitHub" })).toBeDisabled();
    expect(signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: {
        redirectTo: "http://localhost:3000/auth/callback?next=%2Fonboarding",
      },
    });

    resolveRequest({ error: null });
  });

  it("sanitizes unsafe requested destinations", async () => {
    window.history.replaceState(
      {},
      "",
      "/auth/login?next=https%3A%2F%2Fattacker.example%2Fsteal"
    );
    render(<LoginPage />);

    const button = screen.getByRole("button", { name: "Continue with GitHub" });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);

    await waitFor(() =>
      expect(signInWithOAuth).toHaveBeenCalledWith({
        provider: "github",
        options: {
          redirectTo: "http://localhost:3000/auth/callback?next=%2Fdocuments",
        },
      })
    );
  });

  it("shows a safe error instead of provider details", async () => {
    signInWithOAuth.mockResolvedValue({
      error: new Error("sensitive provider payload"),
    });
    render(<LoginPage />);

    const button = screen.getByRole("button", { name: "Continue with GitHub" });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);

    expect(
      await screen.findByText("We could not start secure sign-in. Please try again.")
    ).toBeVisible();
    expect(screen.queryByText(/sensitive provider payload/i)).not.toBeInTheDocument();
    expect(toastError).toHaveBeenCalledWith(
      "We could not start secure sign-in. Please try again."
    );
  });

  it("redirects an authenticated user without starting OAuth", async () => {
    authState.mode = "authenticated";
    render(<LoginPage />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/documents"));
    expect(signInWithOAuth).not.toHaveBeenCalled();
  });
});
