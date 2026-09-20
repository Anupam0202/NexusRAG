import { describe, expect, it } from "vitest";
import {
  AUTH_LINK_ERROR_MESSAGE,
  buildAuthCallbackUrl,
  getAuthCallbackError,
  getSafeAuthErrorMessage,
  sanitizeAuthNextPath,
} from "./auth-redirect";

describe("sanitizeAuthNextPath", () => {
  it("keeps an internal path with its query and hash", () => {
    expect(sanitizeAuthNextPath("/documents?status=ready#library", "/documents")).toBe(
      "/documents?status=ready#library"
    );
  });

  it.each([
    "https://evil.example/steal",
    "//evil.example/steal",
    "/\\evil.example/steal",
    "documents",
    "",
  ])("rejects unsafe destination %s", (value) => {
    expect(sanitizeAuthNextPath(value, "/documents")).toBe("/documents");
  });
});

describe("buildAuthCallbackUrl", () => {
  it("uses the canonical production site outside local development", () => {
    expect(
      buildAuthCallbackUrl(
        "https://preview.nexusrag.example",
        "/documents",
        "https://nexusrag.example"
      )
    ).toBe("https://nexusrag.example/auth/callback?next=%2Fdocuments");
  });

  it("keeps localhost callbacks local for deliberate development", () => {
    expect(
      buildAuthCallbackUrl(
        "http://localhost:3000",
        "/onboarding",
        "https://nexusrag.example"
      )
    ).toBe("http://localhost:3000/auth/callback?next=%2Fonboarding");
  });

  it("rejects an insecure configured production site", () => {
    expect(() =>
      buildAuthCallbackUrl(
        "https://other-preview.example",
        "/documents",
        "http://nexusrag.example.com"
      )
    ).toThrow("NEXT_PUBLIC_SITE_URL must use HTTPS");
  });
});

describe("getAuthCallbackError", () => {
  it("reads callback failures from query parameters", () => {
    expect(
      getAuthCallbackError(
        new URL("https://nexusrag.example/auth/callback?error_description=Link+expired")
      )
    ).toBe(AUTH_LINK_ERROR_MESSAGE);
  });

  it("reads callback failures from URL fragments", () => {
    expect(
      getAuthCallbackError(
        new URL("https://nexusrag.example/auth/callback#error=access_denied&error_description=Try+again")
      )
    ).toBe(AUTH_LINK_ERROR_MESSAGE);
  });

  it("returns null for a successful callback", () => {
    expect(
      getAuthCallbackError(
        new URL("https://nexusrag.example/auth/callback?code=valid-code")
      )
    ).toBeNull();
  });
});

describe("getSafeAuthErrorMessage", () => {
  it("uses provider-neutral recovery guidance", () => {
    expect(getSafeAuthErrorMessage()).toBe(
      "Authentication could not be completed. Return to sign in and try again."
    );
  });
});
