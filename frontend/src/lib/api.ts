/**
 * REST API client for the FastAPI backend.
 *
<<<<<<< HEAD
 * In production (Vercel), all calls go through Next.js rewrites as
 * relative paths (e.g., `/api/v1/...`) so the browser never makes
 * cross-origin requests.  Locally, falls back to http://localhost:8000.
=======
 * ALL calls use relative paths (e.g., `/api/v1/...`).
 * In production, Vercel rewrites proxy these to the Render backend.
 * Locally, Next.js rewrites proxy to http://localhost:8000.
 *
 * This approach eliminates CORS entirely — the browser only ever
 * talks to the same origin.
>>>>>>> 9f6de5d (fix: permanent fix for 'Failed to fetch' — relative URLs + HEAD endpoint)
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

<<<<<<< HEAD
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

=======
>>>>>>> 9f6de5d (fix: permanent fix for 'Failed to fetch' — relative URLs + HEAD endpoint)
async function request<T>(
  path: string,
  init?: RequestInit
): Promise<T> {
<<<<<<< HEAD
  const url = `${getBase()}${path}`;
  const res = await fetch(url, {
=======
  const res = await fetch(path, {
>>>>>>> 9f6de5d (fix: permanent fix for 'Failed to fetch' — relative URLs + HEAD endpoint)
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

<<<<<<< HEAD
/**
 * For file uploads, bypass Vercel rewrites and go DIRECTLY to the backend.
 * Vercel rewrites have a 4.5MB body limit — files can be up to 100MB.
 */
function getDirectBase(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
}

=======
>>>>>>> 9f6de5d (fix: permanent fix for 'Failed to fetch' — relative URLs + HEAD endpoint)
export async function uploadDocument(
  file: File
): Promise<DocumentUploadResponse> {
  const form = new FormData();
  form.append("file", file);
<<<<<<< HEAD
  const res = await fetch(`${getDirectBase()}/api/v1/documents/upload`, {
    method: "POST",
    body: form,
=======
  // Use relative URL — Vercel rewrites proxy to backend
  const res = await fetch("/api/v1/documents/upload", {
    method: "POST",
    body: form,
    // No Content-Type header — browser sets multipart boundary automatically
>>>>>>> 9f6de5d (fix: permanent fix for 'Failed to fetch' — relative URLs + HEAD endpoint)
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