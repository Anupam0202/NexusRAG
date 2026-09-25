/**
 * REST API client for the FastAPI backend.
 *
 * All browser API traffic goes to the configured Cloudflare gateway. The
 * gateway is the public authorization and routing boundary for Supabase,
 * Qdrant, Gemini, and explicitly scheduled computer-worker operations.
 */

import type {
  AnalyticsSummary,
  AppSettings,
  ApiKeyStatusResponse,
  AuditEventListResponse,
  BillingUsageResponse,
  ChatHistoryResponse,
  DocumentChunkListResponse,
  DocumentListResponse,
  DocumentUploadResponse,
  EvaluationReportResponse,
  EvaluationRunRequest,
  IngestionJobStatusResponse,
  QueryRequest,
  QueryResponse,
  PrivacySettingsResponse,
  SettingsUpdate,
  SystemStatusResponse,
  WorkspaceCreateRequest,
  WorkspaceListResponse,
  WorkspaceMember,
  WorkspaceMemberCreateRequest,
  WorkspaceMemberUpdateRequest,
  WorkspaceMembersResponse,
  WorkspaceLifecycleResponse,
  WorkspaceSummary,
} from "@/types";
import { getApiHeaders } from "@/lib/api-context";
import { buildBackendUrl } from "@/lib/backend-url";

export interface ApiRequestContext {
  workspaceId?: string | null;
}

export function formatApiErrorDetail(detail: unknown, fallback: string): string {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail) && detail.length > 0) {
    return detail
      .map((item) => item?.msg ?? item?.message ?? String(item))
      .join("; ");
  }
  if (detail && typeof detail === "object") {
    const record = detail as Record<string, unknown>;
    const message = typeof record.message === "string" ? record.message : null;
    const failures = Array.isArray(record.failures)
      ? record.failures
          .map((failure) => {
            if (!failure || typeof failure !== "object") return null;
            const item = failure as Record<string, unknown>;
            const resource = item.resource ?? item.document_id;
            const failureMessage = item.message;
            if (typeof resource !== "string" || typeof failureMessage !== "string") {
              return null;
            }
            return `${resource}: ${failureMessage}`;
          })
          .filter((failure): failure is string => Boolean(failure))
      : [];

    if (message && failures.length > 0) return `${message} ${failures.join("; ")}`;
    if (message) return message;
    if (failures.length > 0) return failures.join("; ");
  }
  return fallback;
}

async function readErrorMessage(res: Response, fallback: string) {
  const body = await res.json().catch(() => ({}));
  const detail = body && typeof body === "object" ? body.error ?? body.detail ?? body.message ?? body : body;
  const message = detail && typeof detail === "object" && typeof detail.message === "string"
    ? detail.message
    : formatApiErrorDetail(detail, fallback);
  const code = detail && typeof detail === "object" && typeof detail.code === "string"
    ? detail.code
    : undefined;
  return { message, code };
}

export class ApiRequestError extends Error {
  readonly code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.name = "ApiRequestError";
    this.code = code;
  }
}

async function request<T>(
  path: string,
  init?: RequestInit,
  context: ApiRequestContext = {}
): Promise<T> {
  let res: Response;
  try {
    const headers = await getApiHeaders({ workspaceId: context.workspaceId });
    res = await fetch(buildBackendUrl(path), {
      cache: init?.cache ?? "no-store",
      ...init,
      headers: { ...headers, ...init?.headers },
    });
  } catch {
    throw new Error("Backend connection was interrupted. Please retry after the service is live.");
  }
  if (!res.ok) {
    const error = await readErrorMessage(res, `HTTP ${res.status}`);
    throw new ApiRequestError(error.message, error.code);
  }
  return res.json();
}

// Documents

export async function uploadDocument(
  file: File,
  classification: "non_sensitive"
): Promise<DocumentUploadResponse> {
  const form = new FormData();
  form.append("file", file);
  form.append("data_classification", classification);
  form.append("non_sensitive_attested", "true");

  let res: Response;
  try {
    const headers = new Headers(await getApiHeaders({ json: false }));
    headers.set("Idempotency-Key", crypto.randomUUID());
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
    const error = await readErrorMessage(res, `Upload failed (${res.status})`);
    throw new ApiRequestError(error.message, error.code);
  }
  return res.json();
}

export async function listDocuments(): Promise<DocumentListResponse> {
  return request("/api/v1/documents");
}

export async function deleteDocument(
  documentIdentifier: string
): Promise<{ success: boolean; message: string }> {
  return request(`/api/v1/documents/${encodeURIComponent(documentIdentifier)}/delete`, {
    method: "POST",
  });
}

export async function getIngestionJob(
  jobId: string
): Promise<IngestionJobStatusResponse> {
  return request(`/api/v1/documents/jobs/${encodeURIComponent(jobId)}`);
}

export async function getDocumentIngestionStatus(
  documentId: string
): Promise<IngestionJobStatusResponse> {
  return request(`/api/v1/documents/${encodeURIComponent(documentId)}/status`);
}

export async function reindexDocument(
  documentId: string
): Promise<IngestionJobStatusResponse> {
  return request(`/api/v1/documents/${encodeURIComponent(documentId)}/reindex`, {
    method: "POST",
  });
}

export async function retryIngestionJob(
  jobId: string
): Promise<IngestionJobStatusResponse> {
  return request(`/api/v1/documents/jobs/${encodeURIComponent(jobId)}/retry`, {
    method: "POST",
  });
}

export async function getDocumentChunks(
  documentId: string,
  options: { search?: string; limit?: number } = {}
): Promise<DocumentChunkListResponse> {
  const params = new URLSearchParams();
  if (options.search?.trim()) params.set("search", options.search.trim());
  if (options.limit) params.set("limit", String(options.limit));
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return request(`/api/v1/documents/${encodeURIComponent(documentId)}/chunks${suffix}`);
}

// Chat

export async function chatQuery(body: QueryRequest): Promise<QueryResponse> {
  return request("/api/v1/chat", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Idempotency-Key": crypto.randomUUID() },
  });
}

export async function clearSession(
  sessionId: string
): Promise<{ success: boolean; durable_messages_deleted?: number }> {
  return request(`/api/v1/chat/sessions/${sessionId}/clear`, {
    method: "POST",
  });
}

export async function getSessionMessages(
  sessionId: string
): Promise<ChatHistoryResponse> {
  return request(`/api/v1/chat/sessions/${encodeURIComponent(sessionId)}/messages`);
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

export async function getAnalytics(
  context: ApiRequestContext = {}
): Promise<AnalyticsSummary> {
  return request("/api/v1/analytics/summary", undefined, context);
}

export async function getBillingUsage(
  context: ApiRequestContext = {}
): Promise<BillingUsageResponse> {
  return request("/api/v1/billing/usage", undefined, context);
}

export async function getPrivacySettings(): Promise<PrivacySettingsResponse> {
  return request("/api/v1/privacy/settings");
}

export async function updatePrivacySettings(body: {
  retention_enabled: boolean;
  retention_days: number;
}): Promise<PrivacySettingsResponse> {
  return request("/api/v1/privacy/settings", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function runRetention(): Promise<WorkspaceLifecycleResponse> {
  return request("/api/v1/privacy/retention/run", { method: "POST" });
}

export async function deleteCurrentWorkspace(): Promise<WorkspaceLifecycleResponse> {
  return request("/api/v1/workspaces/current/delete", {
    method: "POST",
    body: JSON.stringify({ confirmation: "DELETE WORKSPACE" }),
  });
}

export async function getAuditEvents(limit = 20): Promise<AuditEventListResponse> {
  return request(`/api/v1/audit?limit=${encodeURIComponent(String(limit))}`);
}

export async function runSampleEvaluation(
  body: EvaluationRunRequest = {}
): Promise<EvaluationReportResponse> {
  return request("/api/v1/evaluations/sample", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function getSystemStatus(
  context: ApiRequestContext = {}
): Promise<SystemStatusResponse> {
  return request("/api/v1/status", undefined, context);
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
  apiKey: string,
  costConsentAccepted: boolean
): Promise<ApiKeyStatusResponse> {
  return request("/api/v1/apikey", {
    method: "POST",
    body: JSON.stringify({ api_key: apiKey, cost_consent: costConsentAccepted }),
  });
}

export async function getApiKeyStatus(
  context: ApiRequestContext = {}
): Promise<ApiKeyStatusResponse> {
  return request("/api/v1/apikey", undefined, context);
}

export async function deleteApiKey(): Promise<ApiKeyStatusResponse> {
  return request("/api/v1/apikey", {
    method: "DELETE",
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

export async function listWorkspaces(): Promise<WorkspaceListResponse> {
  return request("/api/v1/workspaces");
}

export async function createWorkspace(
  body: WorkspaceCreateRequest
): Promise<WorkspaceSummary> {
  return request("/api/v1/workspaces", {
    method: "POST",
    headers: { "Idempotency-Key": `workspace-create:${body.slug}` },
    body: JSON.stringify(body),
  });
}

export async function listCurrentWorkspaceMembers(): Promise<WorkspaceMembersResponse> {
  return request("/api/v1/workspaces/current/members");
}

export async function addCurrentWorkspaceMember(
  body: WorkspaceMemberCreateRequest
): Promise<WorkspaceMember> {
  return request("/api/v1/workspaces/current/members", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function updateCurrentWorkspaceMember(
  userId: string,
  body: WorkspaceMemberUpdateRequest
): Promise<WorkspaceMember> {
  return request(`/api/v1/workspaces/current/members/${encodeURIComponent(userId)}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function removeCurrentWorkspaceMember(
  userId: string
): Promise<{ success: boolean; removed: number; user_id: string }> {
  return request(`/api/v1/workspaces/current/members/${encodeURIComponent(userId)}`, {
    method: "DELETE",
  });
}
