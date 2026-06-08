export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

export interface PasswordChecks {
  minLength: boolean;
  maxLength: boolean;
  uppercase: boolean;
  lowercase: boolean;
  number: boolean;
  symbol: boolean;
}

export type AuthOperation = "sign-in" | "signup" | "password-update";

export function passwordChecks(password: string): PasswordChecks {
  return {
    minLength: password.length >= PASSWORD_MIN_LENGTH,
    maxLength: password.length <= PASSWORD_MAX_LENGTH,
    uppercase: /[A-Z]/.test(password),
    lowercase: /[a-z]/.test(password),
    number: /\d/.test(password),
    symbol: /[^A-Za-z0-9]/.test(password),
  };
}

export function passwordValidationError(password: string, confirmation?: string) {
  const checks = passwordChecks(password);
  if (Object.values(checks).some((passed) => !passed)) {
    return "Use 12-128 characters with uppercase, lowercase, a number, and a symbol.";
  }
  if (confirmation !== undefined && password !== confirmation) {
    return "Passwords do not match.";
  }
  return null;
}

export function genericAuthError(operation: AuthOperation) {
  if (operation === "sign-in") {
    return "We could not sign you in with those credentials.";
  }
  if (operation === "signup") {
    return "We could not create the account. Check your details and try again.";
  }
  return "We could not update the password. Please try again.";
}
