import { describe, expect, it } from "vitest";
import { buildAuthLoginRedirect } from "@/components/auth/StaticAuthRedirect";

describe("signup static redirect", () => {
  it("redirects signup intent to onboarding by default", async () => {
    expect(buildAuthLoginRedirect("", "signup")).toBe(
      "/auth/login?intent=signup&next=%2Fonboarding"
    );
  });

  it("preserves a safe requested destination", async () => {
    expect(buildAuthLoginRedirect("?next=%2Fworkspaces", "signup")).toBe(
      "/auth/login?intent=signup&next=%2Fworkspaces"
    );
  });

  it("rejects an external requested destination", async () => {
    expect(
      buildAuthLoginRedirect(
        "?next=https%3A%2F%2Fattacker.example%2Fsteal",
        "signup"
      )
    ).toBe(
      "/auth/login?intent=signup&next=%2Fonboarding"
    );
  });
});
