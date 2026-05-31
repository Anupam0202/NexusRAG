/**
 * REST API client for the FastAPI backend.
 *
 * All browser API traffic goes directly to the configured backend. This keeps
 * REST, uploads, and WebSockets on the same Render service instead of relying
 * on Vercel rewrites, which cannot proxy WebSockets.
 */

import type {
  AnalyticsSummary,
  AppSettings,
  DocumentListResponse,
  DocumentUploadResponse,
  QueryRequest,
  QueryResponse,
  SettingsUpdate,
  SystemStatusResponse,
} from "@/types";
import { getApiHeaders } from "@/lib/api-context";
import { buildBackendUrl } from "@/lib/backend-url";

async function readErrorMessage(res: Response, fallback: string) {
  const body = await res.json().catch(() => ({}));
  const detail = body.detail ?? body.message;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail) && detail.length > 0) {
    return detail
      .map((item) => item?.msg ?? item?.message ?? String(item))
      .join("; ");
  }
  return fallback;
}

async function request<T>(
  path: string,
  init?: RequestInit
): Promise<T> {
  let res: Response;
  try {
    const headers = await getApiHeaders();
    res = await fetch(buildBackendUrl(path), {
      cache: init?.cache ?? "no-store",
      ...init,
      headers: { ...headers, ...init?.headers },
    });
  } catch {
    throw new Error("Backend connection was interrupted. Please retry after the service is live.");
  }
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, `HTTP ${res.status}`));
  }
  return res.json();
}

// Documents

export async function uploadDocument(
  file: File
): Promise<DocumentUploadResponse> {
  const form = new FormData();
  form.append("file", file);

  let res: Response;
  try {
    const headers = await getApiHeaders({ json: false });
    res = await fetch(buildBackendUrl("/api/v1/documents/upload"), {
      method: "POST",
      headers,
      body: form,
    });
  } catch {
    throw new Error(
      "Upload connection was interrupted before the backend returned a response. " +
        "This usually means the backend restarted or the file exceeded processing limits. " +
        "Try again after the Backend live badge appears, or split large/scanned PDFs."
    );
  }

  if (!res.ok) {
    throw new Error(await readErrorMessage(res, `Upload failed (${res.status})`));
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

// Chat

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

// Settings

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

// Analytics

export async function getAnalytics(): Promise<AnalyticsSummary> {
  return request("/api/v1/analytics/summary");
}

export async function getSystemStatus(): Promise<SystemStatusResponse> {
  return request("/api/v1/status");
}

// Health

export async function healthCheck(): Promise<{
  status: string;
  total_chunks: number;
}> {
  return request("/health");
}

// API Key

export async function setApiKey(
  apiKey: string
): Promise<{ success: boolean; message: string }> {
  return request("/api/v1/apikey", {
    method: "POST",
    body: JSON.stringify({ api_key: apiKey }),
  });
}

export async function getCurrentUser(): Promise<{
  id: string;
  email: string | null;
  role: string;
  is_demo: boolean;
}> {
  return request("/api/v1/auth/me");
}

export async function getCurrentWorkspace(): Promise<{
  workspace_id: string;
  role: "owner" | "admin" | "editor" | "viewer";
  user_id: string;
}> {
  return request("/api/v1/workspaces/current");
}
