import { describe, expect, it } from "vitest";
import { buildAuthLoginRedirect } from "@/components/auth/StaticAuthRedirect";

describe("buildAuthLoginRedirect", () => {
  it("preserves a safe requested destination", async () => {
    expect(buildAuthLoginRedirect("?next=%2Fchat")).toBe("/auth/login?next=%2Fchat");
  });

  it("rejects an external requested destination", async () => {
    expect(buildAuthLoginRedirect("?next=https%3A%2F%2Fattacker.example%2Fsteal")).toBe(
      "/auth/login?next=%2Fdocuments"
    );
  });

  it("uses the onboarding destination for signup by default", () => {
    expect(buildAuthLoginRedirect("", "signup")).toBe(
      "/auth/login?intent=signup&next=%2Fonboarding"
    );
  });
});
