import { beforeEach, describe, expect, it, vi } from "vitest";

const { redirect } = vi.hoisted(() => ({
  redirect: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect }));

import AuthConfirmPage from "./page";

describe("AuthConfirmPage", () => {
  beforeEach(() => {
    redirect.mockReset();
  });

  it("preserves a safe requested destination", async () => {
    await AuthConfirmPage({
      searchParams: Promise.resolve({ next: "/chat" }),
    });

    expect(redirect).toHaveBeenCalledWith("/auth/login?next=%2Fchat");
  });

  it("rejects an external requested destination", async () => {
    await AuthConfirmPage({
      searchParams: Promise.resolve({
        next: "https://attacker.example/steal",
      }),
    });

    expect(redirect).toHaveBeenCalledWith("/auth/login?next=%2Fdocuments");
  });
});
