const LOCAL_BACKEND_URL = "http://localhost:8000";

const RAILWAY_HOST_SUFFIXES = [".railway.app", ".up.railway.app"];

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function isLocalBrowser(): boolean {
  if (typeof window === "undefined") return false;
  return ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
}

function isRailwayHost(hostname: string): boolean {
  return RAILWAY_HOST_SUFFIXES.some(
    (suffix) => hostname === suffix.slice(1) || hostname.endsWith(suffix)
  );
}

function validateBackendUrl(rawUrl: string): string {
  const normalized = stripTrailingSlash(rawUrl.trim());
  let url: URL;

  try {
    url = new URL(normalized);
  } catch {
    throw new Error(
      "Backend URL is invalid. Set NEXT_PUBLIC_API_URL to the Render backend URL."
    );
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Backend URL must start with http:// or https://.");
  }

  if (isRailwayHost(url.hostname)) {
    throw new Error(
      "Backend URL is still set to Railway. Set NEXT_PUBLIC_API_URL to the Render backend URL and redeploy."
    );
  }

  return normalized;
}

export function getBackendBaseUrl(): string | null {
  const configured = process.env.NEXT_PUBLIC_API_URL;
  if (configured?.trim()) {
    return validateBackendUrl(configured);
  }

  if (isLocalBrowser()) {
    return LOCAL_BACKEND_URL;
  }

  if (process.env.NODE_ENV !== "production") {
    return LOCAL_BACKEND_URL;
  }

  return null;
}

export function requireBackendBaseUrl(): string {
  const backendUrl = getBackendBaseUrl();
  if (!backendUrl) {
    throw new Error(
      "Backend URL is not configured. Set NEXT_PUBLIC_API_URL to the Render backend URL and redeploy."
    );
  }
  return backendUrl;
}

export function buildBackendUrl(path: string): string {
  const backendUrl = requireBackendBaseUrl();
  return `${backendUrl}${path.startsWith("/") ? path : `/${path}`}`;
}

export function getBackendWsBaseUrl(): string | null {
  const backendUrl = getBackendBaseUrl();
  if (!backendUrl) return null;
  return backendUrl.replace("http://", "ws://").replace("https://", "wss://");
}
