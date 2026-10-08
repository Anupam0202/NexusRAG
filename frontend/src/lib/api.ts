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

export async function listDocuments(context: ApiRequestContext = {}): Promise<DocumentListResponse> {
  const documents: DocumentListResponse["documents"] = [];
  const seen = new Set<string>();
  let after: string | null = null;
  for (let page = 0; page < 10; page++) {
    const response: DocumentListResponse = await request(
      `/api/v1/documents${after ? `?after=${encodeURIComponent(after)}` : ""}`, undefined, context);
    for (const document of response.documents) {
      if (seen.has(document.document_id)) throw new Error("Document inventory changed while loading. Refresh and retry.");
      seen.add(document.document_id); documents.push(document);
    }
    if (!response.next_after) return { documents, total: documents.length, total_is_exact: true, next_after: null };
    if (response.next_after === after) throw new Error("Document pagination did not advance. Refresh and retry.");
    after = response.next_after;
  }
  throw new Error("Workspace inventory exceeds this bounded view. No documents were silently omitted; use a narrower inventory view.");
}

export async function deleteDocument(
  documentIdentifier: string, context: ApiRequestContext = {}
): Promise<{ success: boolean; message: string }> {
  return request(`/api/v1/documents/${encodeURIComponent(documentIdentifier)}/delete`, {
    method: "POST",
  }, context);
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
  sessionId: string, context: ApiRequestContext = {}
): Promise<{ success: boolean; durable_messages_deleted?: number }> {
  return request(`/api/v1/chat/sessions/${sessionId}/clear`, {
    method: "POST",
  }, context);
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

export async function getPrivacySettings(context: ApiRequestContext = {}): Promise<PrivacySettingsResponse> {
  return request("/api/v1/privacy/settings", undefined, context);
}

export async function updatePrivacySettings(body: {
  retention_enabled: boolean;
  retention_days: number;
}, context: ApiRequestContext = {}): Promise<PrivacySettingsResponse> {
  return request("/api/v1/privacy/settings", {
    method: "PATCH",
    body: JSON.stringify(body),
  }, context);
}

export async function runRetention(context: ApiRequestContext = {}): Promise<WorkspaceLifecycleResponse> {
  return request("/api/v1/privacy/retention/run", { method: "POST" }, context);
}

export async function deleteCurrentWorkspace(context: ApiRequestContext = {}): Promise<WorkspaceLifecycleResponse> {
  return request("/api/v1/workspaces/current/delete", {
    method: "POST",
    body: JSON.stringify({ confirmation: "DELETE WORKSPACE" }),
  }, context);
}

export async function getAuditEvents(limit = 20, context: ApiRequestContext = {}): Promise<AuditEventListResponse> {
  return request(`/api/v1/audit?limit=${encodeURIComponent(String(limit))}`, undefined, context);
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
  total_chunks?: number;
  readiness?: string;
  probe?: string;
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

export async function getCurrentWorkspace(context: ApiRequestContext = {}): Promise<{
  workspace_id: string;
  role: "owner" | "admin" | "editor" | "viewer";
  user_id: string;
}> {
  return request("/api/v1/workspaces/current", undefined, context);
}

export interface FindingSummary {
  id: string;
  workspace_id: string;
  owner_id: string;
  title: string;
  revision: number;
  source_run_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface FindingDetail extends FindingSummary {
  author_id: string | null;
  permission: "owner" | "read" | "contribute";
  authored_markdown: string;
  generated_markdown: string | null;
  source_unavailable: boolean;
  evidence: Array<{ id: string; document_id: string; version_id: string; original_text?: string; available: boolean; freshness: string }>;
  reviews: Array<{ reviewer_id: string; revision: number; decision: string; comment: string }>;
  participants: Array<{ user_id: string; permission: "read" | "contribute" }>;
}

export function listFindings(context: ApiRequestContext, after?: string) {
  return request<{ items: FindingSummary[]; next_after: string | null }>(
    `/api/v2/findings?limit=20${after ? `&after=${encodeURIComponent(after)}` : ""}`, undefined, context);
}

export function readFinding(id: string, context: ApiRequestContext) {
  return request<FindingDetail>(`/api/v2/findings/${encodeURIComponent(id)}`, undefined, context);
}

export function createFinding(
  body: { title: string; authored_markdown: string }, key: string, context: ApiRequestContext
) {
  return request<FindingSummary>("/api/v2/findings",
    { method: "POST", headers: { "Idempotency-Key": key }, body: JSON.stringify(body) }, context);
}

export function editFinding(id: string, body: { title: string; authored_markdown: string; revision: number }, context: ApiRequestContext) {
  return request<FindingSummary>(`/api/v2/findings/${encodeURIComponent(id)}`,
    { method: "PATCH", body: JSON.stringify(body) }, context);
}

export function reviewFinding(id: string, body: { revision: number; decision: "approved" | "changes_requested"; comment: string }, context: ApiRequestContext) {
  return request<FindingDetail>(`/api/v2/findings/${encodeURIComponent(id)}/review`,
    { method: "POST", body: JSON.stringify(body) }, context);
}

export function shareFinding(id: string, body: { user_id: string; permission: "read" | "contribute" }, context: ApiRequestContext) {
  return request<FindingDetail>(`/api/v2/findings/${encodeURIComponent(id)}/share`,
    { method: "POST", body: JSON.stringify(body) }, context);
}

export function unshareFinding(id: string, userId: string, context: ApiRequestContext) {
  return request<FindingDetail>(`/api/v2/findings/${encodeURIComponent(id)}/unshare`,
    { method: "POST", body: JSON.stringify({ user_id: userId }) }, context);
}

export function removeFinding(id: string, context: ApiRequestContext) {
  return request<{ id: string; state: string }>(`/api/v2/findings/${encodeURIComponent(id)}`, { method: "DELETE" }, context);
}

export function exportFinding(id: string, context: ApiRequestContext) {
  return request<{ receipt: { id: string }; manifest: unknown; manifest_hash: string }>(
    `/api/v2/findings/${encodeURIComponent(id)}/export`, { method: "POST" }, context);
}

export async function listWorkspaces(): Promise<WorkspaceListResponse> {
  return request("/api/v1/workspaces");
}

export async function createWorkspace(
  body: WorkspaceCreateRequest
): Promise<WorkspaceSummary> {
  const normalized = { ...body, name: body.name.trim() };
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(normalized)));
  const key = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, "0")).join("");
  return request("/api/v1/workspaces", {
    method: "POST",
    headers: { "Idempotency-Key": `workspace-create:${key}` },
    body: JSON.stringify(normalized),
  });
}

export async function listCurrentWorkspaceMembers(context: ApiRequestContext = {}): Promise<WorkspaceMembersResponse> {
  return request("/api/v1/workspaces/current/members", undefined, context);
}

export async function addCurrentWorkspaceMember(
  body: WorkspaceMemberCreateRequest,
  context: ApiRequestContext = {}
): Promise<WorkspaceMember> {
  return request("/api/v1/workspaces/current/members", {
    method: "POST",
    body: JSON.stringify(body),
  }, context);
}

export async function updateCurrentWorkspaceMember(
  userId: string,
  body: WorkspaceMemberUpdateRequest,
  context: ApiRequestContext = {}
): Promise<WorkspaceMember> {
  return request(`/api/v1/workspaces/current/members/${encodeURIComponent(userId)}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  }, context);
}

export async function removeCurrentWorkspaceMember(
  userId: string, context: ApiRequestContext = {}
): Promise<{ success: boolean; removed: number; user_id: string }> {
  return request(`/api/v1/workspaces/current/members/${encodeURIComponent(userId)}`, {
    method: "DELETE",
  }, context);
}
