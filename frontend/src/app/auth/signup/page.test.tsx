import { beforeEach, describe, expect, it, vi } from "vitest";

const { redirect } = vi.hoisted(() => ({
  redirect: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect }));

import SignupPage from "./page";

type SignupRoute = (props: {
  searchParams: Promise<{ next?: string }>;
}) => Promise<unknown>;

describe("SignupPage", () => {
  beforeEach(() => {
    redirect.mockReset();
  });

  it("redirects signup intent to onboarding by default", async () => {
    await (SignupPage as unknown as SignupRoute)({
      searchParams: Promise.resolve({}),
    });

    expect(redirect).toHaveBeenCalledWith(
      "/auth/login?intent=signup&next=%2Fonboarding"
    );
  });

  it("preserves a safe requested destination", async () => {
    await (SignupPage as unknown as SignupRoute)({
      searchParams: Promise.resolve({ next: "/workspaces" }),
    });

    expect(redirect).toHaveBeenCalledWith(
      "/auth/login?intent=signup&next=%2Fworkspaces"
    );
  });

  it("rejects an external requested destination", async () => {
    await (SignupPage as unknown as SignupRoute)({
      searchParams: Promise.resolve({ next: "https://attacker.example/steal" }),
    });

    expect(redirect).toHaveBeenCalledWith(
      "/auth/login?intent=signup&next=%2Fonboarding"
    );
  });
});
