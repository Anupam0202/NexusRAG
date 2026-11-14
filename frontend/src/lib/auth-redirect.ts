const FALLBACK_AUTH_PATH = "/documents";
const INTERNAL_URL_BASE = "https://nexusrag.invalid";
export const AUTH_LINK_ERROR_MESSAGE =
  "Authentication could not be completed. Return to sign in and try again.";

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

function hasUnsafeCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (character === "\\" || code < 32 || code === 127) return true;
  }
  return false;
}

function safeInternalPath(value: string | null | undefined): string | null {
  if (!value?.startsWith("/") || value.startsWith("//") || hasUnsafeCharacters(value)) return null;
  try {
    const candidate = new URL(value, INTERNAL_URL_BASE);
    if (candidate.origin !== INTERNAL_URL_BASE) return null;
    // URL normalization can turn dot segments into a protocol-relative path.
    // Validate decoded path variants too, but preserve query/hash encoding.
    let pathname = candidate.pathname;
    for (let depth = 0; depth < 5; depth++) {
      if (pathname.startsWith("//") || hasUnsafeCharacters(pathname)) return null;
      const normalized = new URL(pathname, INTERNAL_URL_BASE);
      if (normalized.origin !== INTERNAL_URL_BASE || normalized.pathname.startsWith("//")) return null;
      const decoded = decodeURIComponent(pathname);
      if (decoded === pathname) return `${candidate.pathname}${candidate.search}${candidate.hash}`;
      pathname = decoded;
    }
    return null;
  } catch {
    return null;
  }
}

export function sanitizeAuthNextPath(value: string | null | undefined, fallback: string) {
  return safeInternalPath(value) ?? safeInternalPath(fallback) ?? FALLBACK_AUTH_PATH;
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
