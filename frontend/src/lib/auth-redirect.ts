const FALLBACK_AUTH_PATH = "/documents";
const INTERNAL_URL_BASE = "https://nexusrag.invalid";
export const AUTH_LINK_ERROR_MESSAGE =
  "This sign-in link is invalid or expired. Request a new one.";

function isLoopbackHost(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function requireSecureAppOrigin(value: string, label: string) {
  const url = new URL(value);
  const local = isLoopbackHost(url.hostname);

  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new Error(`${label} must use HTTPS outside local development.`);
  }

  if (url.username || url.password) {
    throw new Error(`${label} must not include credentials.`);
  }

  return url.origin;
}

export function sanitizeAuthNextPath(value: string | null | undefined, fallback: string) {
  const safeFallback =
    fallback.startsWith("/") && !fallback.startsWith("//") && !fallback.includes("\\")
      ? fallback
      : FALLBACK_AUTH_PATH;

  if (!value?.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return safeFallback;
  }

  try {
    const candidate = new URL(value, INTERNAL_URL_BASE);
    if (candidate.origin !== INTERNAL_URL_BASE) return safeFallback;
    return `${candidate.pathname}${candidate.search}${candidate.hash}`;
  } catch {
    return safeFallback;
  }
}

export function buildAuthCallbackUrl(
  currentOrigin: string,
  nextPath: string,
  configuredSiteUrl?: string
) {
  const currentUrl = new URL(currentOrigin);
  const localDevelopment = isLoopbackHost(currentUrl.hostname);
  const callbackOrigin =
    !localDevelopment && configuredSiteUrl?.trim()
      ? requireSecureAppOrigin(configuredSiteUrl.trim(), "NEXT_PUBLIC_SITE_URL")
      : requireSecureAppOrigin(currentOrigin, "Authentication origin");

  const callback = new URL("/auth/callback", callbackOrigin);
  callback.searchParams.set("next", sanitizeAuthNextPath(nextPath, FALLBACK_AUTH_PATH));
  return callback.toString();
}

export function buildAuthRecoveryUrl(currentOrigin: string, configuredSiteUrl?: string) {
  const currentUrl = new URL(currentOrigin);
  const localDevelopment = isLoopbackHost(currentUrl.hostname);
  const recoveryOrigin =
    !localDevelopment && configuredSiteUrl?.trim()
      ? requireSecureAppOrigin(configuredSiteUrl.trim(), "NEXT_PUBLIC_SITE_URL")
      : requireSecureAppOrigin(currentOrigin, "Authentication origin");

  const recovery = new URL("/auth/confirm", recoveryOrigin);
  recovery.searchParams.set("next", "/auth/update-password");
  return recovery.toString();
}

export function isWorkspaceIndependentAuthDestination(path: string) {
  return path === "/auth/update-password";
}

export function getAuthCallbackError(url: URL) {
  const fragmentParams = new URLSearchParams(url.hash.replace(/^#/, ""));
  const providerError =
    url.searchParams.get("error_description") ||
    fragmentParams.get("error_description") ||
    url.searchParams.get("error") ||
    fragmentParams.get("error");
  return providerError ? AUTH_LINK_ERROR_MESSAGE : null;
}

export function getSafeAuthErrorMessage() {
  return AUTH_LINK_ERROR_MESSAGE;
}
