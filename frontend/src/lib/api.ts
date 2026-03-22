/**
 * REST API client for the FastAPI backend.
 *
 * In production (Vercel), all calls go through Next.js rewrites as
 * relative paths (e.g., `/api/v1/...`) so the browser never makes
 * cross-origin requests.  Locally, falls back to http://localhost:8000.
 */

import type {
  AnalyticsSummary,
  AppSettings,
  DocumentListResponse,
  DocumentUploadResponse,
  QueryRequest,
  QueryResponse,
  SettingsUpdate,
} from "@/types";

/**
 * Determine the API base URL.
 * - In the browser: use relative paths (works with Vercel rewrites).
 * - On the server (SSR): use the full backend URL.
 */
function getBase(): string {
  if (typeof window !== "undefined") {
    // Client-side: use relative URL so Vercel rewrites proxy to backend
    return "";
  }
  // Server-side (SSR): need the full URL
  return process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
}

async function request<T>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const url = `${getBase()}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail ?? body.message ?? `HTTP ${res.status}`);
  }
  return res.json();
}

// ── Documents ────────────────────────────────────────────────

/**
 * For file uploads, bypass Vercel rewrites and go DIRECTLY to the backend.
 * Vercel rewrites have a 4.5MB body limit — files can be up to 100MB.
 */
function getDirectBase(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
}

export async function uploadDocument(
  file: File
): Promise<DocumentUploadResponse> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${getDirectBase()}/api/v1/documents/upload`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail ?? `Upload failed (${res.status})`);
  }
  return res.json();
}

export async function listDocuments(): Promise<DocumentListResponse> {
  return request("/api/v1/documents");
}

export async function deleteDocument(
  filename: string
): Promise<{ success: boolean; message: string }> {
  return request(`/api/v1/documents/${encodeURIComponent(filename)}`, {
    method: "DELETE",
  });
}

// ── Chat ─────────────────────────────────────────────────────

export async function chatQuery(body: QueryRequest): Promise<QueryResponse> {
  return request("/api/v1/chat", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function clearSession(
  sessionId: string
): Promise<{ success: boolean }> {
  return request(`/api/v1/chat/sessions/${sessionId}/clear`, {
    method: "POST",
  });
}

// ── Settings ─────────────────────────────────────────────────

export async function getSettings(): Promise<AppSettings> {
  return request("/api/v1/settings");
}

export async function updateSettings(
  body: SettingsUpdate
): Promise<AppSettings> {
  return request("/api/v1/settings", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

// ── Analytics ────────────────────────────────────────────────

export async function getAnalytics(): Promise<AnalyticsSummary> {
  return request("/api/v1/analytics/summary");
}

// ── Health ────────────────────────────────────────────────────

export async function healthCheck(): Promise<{
  status: string;
  total_chunks: number;
}> {
  return request("/health");
}

// ── API Key ──────────────────────────────────────────────────

export async function setApiKey(
  apiKey: string
): Promise<{ success: boolean; message: string }> {
  return request("/api/v1/apikey", {
    method: "POST",
    body: JSON.stringify({ api_key: apiKey }),
  });
}