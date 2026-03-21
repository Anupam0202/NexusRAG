/**
 * REST API client for the FastAPI backend.
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

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

async function request<T>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const url = `${BASE}${path}`;
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

export async function uploadDocument(
  file: File
): Promise<DocumentUploadResponse> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${BASE}/api/v1/documents/upload`, {
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