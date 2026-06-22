import { describe, expect, it, vi } from "vitest";

const { redirect } = vi.hoisted(() => ({
  redirect: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect }));

import ForgotPasswordPage from "./page";

describe("ForgotPasswordPage", () => {
  it("redirects the retired recovery flow to OAuth sign-in", () => {
    ForgotPasswordPage();

    expect(redirect).toHaveBeenCalledWith("/auth/login");
  });
});
