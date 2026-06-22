import { describe, expect, it, vi } from "vitest";

const { redirect } = vi.hoisted(() => ({
  redirect: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect }));

import UpdatePasswordPage from "./page";

describe("UpdatePasswordPage", () => {
  it("redirects the retired password flow to OAuth sign-in", () => {
    UpdatePasswordPage();

    expect(redirect).toHaveBeenCalledWith("/auth/login");
  });
});
