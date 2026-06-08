import { describe, expect, it } from "vitest";
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  genericAuthError,
  passwordChecks,
  passwordValidationError,
  publicAuthErrorMessage,
} from "./password-policy";

describe("passwordChecks", () => {
  it("accepts a password that satisfies every requirement", () => {
    expect(passwordChecks("SecurePass1!")).toEqual({
      minLength: true,
      maxLength: true,
      uppercase: true,
      lowercase: true,
      number: true,
      symbol: true,
    });
  });

  it("reports every failed requirement", () => {
    expect(passwordChecks("short")).toEqual({
      minLength: false,
      maxLength: true,
      uppercase: false,
      lowercase: true,
      number: false,
      symbol: false,
    });
  });

  it("enforces the maximum length without trimming surrounding whitespace", () => {
    expect(passwordChecks(` SecurePass1!${"x".repeat(PASSWORD_MAX_LENGTH)}`).maxLength).toBe(false);
    expect(passwordChecks(` ${"A1!".padEnd(PASSWORD_MIN_LENGTH - 1, "a")} `).minLength).toBe(true);
  });
});

describe("passwordValidationError", () => {
  it("returns a safe requirement error for a weak password", () => {
    expect(passwordValidationError("weak", "weak")).toBe(
      "Use 12-128 characters with uppercase, lowercase, a number, and a symbol."
    );
  });

  it("returns a matching error only after the password satisfies the policy", () => {
    expect(passwordValidationError("SecurePass1!", "DifferentPass1!")).toBe(
      "Passwords do not match."
    );
  });

  it("returns null for a valid matching password", () => {
    expect(passwordValidationError("SecurePass1!", "SecurePass1!")).toBeNull();
  });
});

describe("genericAuthError", () => {
  it("does not expose provider or account-existence details", () => {
    expect(genericAuthError("sign-in")).toBe("We could not sign you in with those credentials.");
    expect(genericAuthError("signup")).toBe(
      "We could not create the account. Check your details and try again."
    );
    expect(genericAuthError("password-update")).toBe(
      "We could not update the password. Please try again."
    );
    expect(genericAuthError("email-delivery")).toBe("We could not send the email. Please try again.");
  });
});

describe("publicAuthErrorMessage", () => {
  it("explains temporary email rate limits without exposing provider details", () => {
    expect(
      publicAuthErrorMessage("signup", {
        code: "over_email_send_rate_limit",
        status: 429,
        message: "sensitive provider detail",
      })
    ).toBe("Verification email requests are temporarily rate-limited. Wait a few minutes and try again.");
  });

  it("distinguishes general authentication throttling from email delivery throttling", () => {
    expect(
      publicAuthErrorMessage("sign-in", {
        code: "over_request_rate_limit",
        status: 429,
        message: "sensitive provider detail",
      })
    ).toBe("Too many authentication requests. Wait a few minutes and try again.");
  });

  it("explains when public email delivery is not configured", () => {
    expect(
      publicAuthErrorMessage("signup", {
        code: "email_address_not_authorized",
        message: "sensitive provider detail",
      })
    ).toBe("Public verification email delivery is not configured. Contact the workspace administrator.");
  });

  it("falls back to account-enumeration-safe operation messages", () => {
    expect(
      publicAuthErrorMessage("sign-in", {
        code: "invalid_credentials",
        message: "user not found: sensitive detail",
      })
    ).toBe("We could not sign you in with those credentials.");
  });
});
