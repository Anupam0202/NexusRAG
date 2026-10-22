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
import { modeLimits, researchModes, type ResearchPlanInput, type ResearchPlanRecord } from "@/lib/research-plan";
import { confirmedResearchRun, type ResearchRun } from "@/lib/research-run";
import { confirmedCalculation, type CalculationInput, type CalculationRecord } from "@/lib/research-calculation";
import { canonicalAggregationInput, confirmedAggregation, type AggregationInput, type AggregationRecord } from "@/lib/research-aggregation";
import {canonicalConversionInput,confirmedConversion,type ConversionInput,type ConversionRecord} from "@/lib/research-conversion";
import {canonicalQuantityCapture,confirmedQuantityCapture,type QuantityCaptureInput,type QuantityCaptureRecord} from "@/lib/research-quantity";
import { readOriginalDownload, originalTransferPolicy, type OriginalDownloadOptions } from "@/lib/document-original";

export interface ApiRequestContext {
  expectedUserId?: string | null;
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

function unconfirmedCleanup(action: string) {
  return new ApiRequestError(
    `${action} was not confirmed. Refresh the workspace and inspect its state before retrying.`,
    "CLEANUP_UNCONFIRMED"
  );
}

function isConfirmedLifecycleResponse(value: unknown, workspaceDeleted: boolean): value is WorkspaceLifecycleResponse {
  if (!value || typeof value !== "object") return false;
  const receipt = value as Record<string, unknown>;
  if (receipt.workspace_deleted !== workspaceDeleted || !Array.isArray(receipt.failures) || receipt.failures.length !== 0) return false;
  return ["documents_deleted", "chat_sessions_deleted", "local_chunks_deleted", "qdrant_chunks_deleted"].every(key => {
    const count = receipt[key];
    return typeof count === "number" && Number.isSafeInteger(count) && count >= 0;
  });
}

async function request<T>(
  path: string,
  init?: RequestInit,
  context: ApiRequestContext = {}
): Promise<T> {
  let res: Response;
  try {
    const headers = await getApiHeaders({ workspaceId: context.workspaceId, expectedUserId: context.expectedUserId });
    res = await fetch(buildBackendUrl(path), {
      cache: init?.cache ?? "no-store",
      ...init,
      headers: { ...headers, ...init?.headers },
    });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "AUTH_CONTEXT_CHANGED") throw error;
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
  classification: "non_sensitive",
  context: ApiRequestContext = {}
): Promise<DocumentUploadResponse> {
  const form = new FormData();
  form.append("file", file);
  form.append("data_classification", classification);
  form.append("non_sensitive_attested", "true");

  let res: Response;
  try {
    const headers = new Headers(await getApiHeaders({ json: false, workspaceId: context.workspaceId, expectedUserId: context.expectedUserId }));
    headers.set("Idempotency-Key", crypto.randomUUID());
    res = await fetch(buildBackendUrl("/api/v1/documents/upload"), {
      method: "POST",
      headers,
      body: form,
    });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "AUTH_CONTEXT_CHANGED") throw error;
    throw new Error(
      "Upload connection was interrupted before the backend returned a response. " +
        "The upload outcome is unknown; a same-named file does not prove this upload completed. " +
        "Refresh the document library and inspect the ingestion state before retrying."
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
  const receipt = await request<{ success: boolean; message: string } | null>(`/api/v1/documents/${encodeURIComponent(documentIdentifier)}/delete`, {
    method: "POST",
  }, context);
  if (receipt?.success !== true || typeof receipt.message !== "string") throw unconfirmedCleanup("Document deletion");
  return receipt;
}

export async function getIngestionJob(
  jobId: string, context: ApiRequestContext = {}
): Promise<IngestionJobStatusResponse> {
  return request(`/api/v1/documents/jobs/${encodeURIComponent(jobId)}`, undefined, context);
}

export async function getDocumentIngestionStatus(
  documentId: string, context: ApiRequestContext = {}
): Promise<IngestionJobStatusResponse> {
  return request(`/api/v1/documents/${encodeURIComponent(documentId)}/status`, undefined, context);
}

export async function reindexDocument(
  documentId: string, context: ApiRequestContext = {}
): Promise<IngestionJobStatusResponse> {
  return request(`/api/v1/documents/${encodeURIComponent(documentId)}/reindex`, {
    method: "POST",
  }, context);
}

export async function retryIngestionJob(
  jobId: string, context: ApiRequestContext = {}
): Promise<IngestionJobStatusResponse> {
  return request(`/api/v1/documents/jobs/${encodeURIComponent(jobId)}/retry`, {
    method: "POST",
  }, context);
}

export async function getDocumentChunks(
  documentId: string,
  options: { search?: string; limit?: number; after?: number; versionId?: string } = {},
  context: ApiRequestContext = {}
): Promise<DocumentChunkListResponse> {
  const params = new URLSearchParams();
  if (options.search?.trim()) params.set("search", options.search.trim());
  if (options.limit) params.set("limit", String(options.limit));
  if (options.after !== undefined) params.set("after", String(options.after));
  if (options.versionId) params.set("version_id", options.versionId);
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return request(`/api/v1/documents/${encodeURIComponent(documentId)}/chunks${suffix}`, undefined, context);
}

export async function downloadDocumentOriginal(documentId: string, versionId: string,
  context: ApiRequestContext = {}, options: OriginalDownloadOptions = {}) {
  const timeout = AbortSignal.timeout(originalTransferPolicy.timeout_ms);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  try {
    const headers = await getApiHeaders({ json: false, workspaceId: context.workspaceId, expectedUserId: context.expectedUserId });
    const response = await fetch(buildBackendUrl(`/api/v1/documents/${encodeURIComponent(documentId)}/original?version_id=${encodeURIComponent(versionId)}`), {
      headers, signal, cache: "no-store",
    });
    if (!response.ok) {
      const error = await readErrorMessage(response, "The original file is unavailable.");
      throw new ApiRequestError(error.message, error.code);
    }
    return await readOriginalDownload(response, documentId, versionId, { ...options, signal });
  } catch (error) {
    if (timeout.aborted && !options.signal?.aborted) throw new Error("The original transfer timed out. Retry when the connection improves.");
    if (error instanceof TypeError) throw new Error("The original connection was interrupted. Retry to download it again; transfer quota may still have been charged.");
    throw error;
  }
}

// Chat

export async function chatQuery(body: QueryRequest, context: ApiRequestContext = {}): Promise<QueryResponse> {
  return request("/api/v1/chat", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Idempotency-Key": crypto.randomUUID() },
  }, context);
}

export async function clearSession(
  sessionId: string, context: ApiRequestContext = {}
): Promise<{ success: boolean; durable_messages_deleted?: number }> {
  const receipt = await request<{ success: boolean; durable_messages_deleted?: number } | null>(`/api/v1/chat/sessions/${encodeURIComponent(sessionId)}/clear`, {
    method: "POST",
  }, context);
  if (receipt?.success !== true || (receipt.durable_messages_deleted !== undefined &&
    (!Number.isSafeInteger(receipt.durable_messages_deleted) || receipt.durable_messages_deleted < 0))) {
    throw unconfirmedCleanup("Chat history clearing");
  }
  return receipt;
}

export async function getSessionMessages(
  sessionId: string, context: ApiRequestContext = {}
): Promise<ChatHistoryResponse> {
  return request(`/api/v1/chat/sessions/${encodeURIComponent(sessionId)}/messages`, undefined, context);
}

// Settings

export async function getSettings(context: ApiRequestContext = {}): Promise<AppSettings> {
  return request("/api/v1/settings", undefined, context);
}

export async function updateSettings(
  body: SettingsUpdate,
  context: ApiRequestContext = {}
): Promise<AppSettings> {
  return request("/api/v1/settings", {
    method: "PATCH",
    body: JSON.stringify(body),
  }, context);
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
  const receipt = await request<unknown>("/api/v1/privacy/retention/run", { method: "POST" }, context);
  if (!isConfirmedLifecycleResponse(receipt, false)) throw unconfirmedCleanup("Retention cleanup");
  return receipt;
}

export async function deleteCurrentWorkspace(context: ApiRequestContext = {}): Promise<WorkspaceLifecycleResponse> {
  const receipt = await request<unknown>("/api/v1/workspaces/current/delete", {
    method: "POST",
    body: JSON.stringify({ confirmation: "DELETE WORKSPACE" }),
  }, context);
  if (!isConfirmedLifecycleResponse(receipt, true)) throw unconfirmedCleanup("Workspace erasure");
  return receipt;
}

export async function getAuditEvents(limit = 20, context: ApiRequestContext = {}): Promise<AuditEventListResponse> {
  return request(`/api/v1/audit?limit=${encodeURIComponent(String(limit))}`, undefined, context);
}

export async function runSampleEvaluation(
  body: EvaluationRunRequest = {},
  context: ApiRequestContext = {}
): Promise<EvaluationReportResponse> {
  return request("/api/v1/evaluations/sample", {
    method: "POST",
    body: JSON.stringify(body),
  }, context);
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
  costConsentAccepted: boolean,
  context: ApiRequestContext = {}
): Promise<ApiKeyStatusResponse> {
  return request("/api/v1/apikey", {
    method: "POST",
    body: JSON.stringify({ api_key: apiKey, cost_consent: costConsentAccepted }),
  }, context);
}

export async function getApiKeyStatus(
  context: ApiRequestContext = {}
): Promise<ApiKeyStatusResponse> {
  return request("/api/v1/apikey", undefined, context);
}

export async function deleteApiKey(context: ApiRequestContext = {}): Promise<ApiKeyStatusResponse> {
  return request("/api/v1/apikey", {
    method: "DELETE",
  }, context);
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

function confirmedResearchPlan(value: unknown): value is ResearchPlanRecord {
  if (!value || typeof value !== "object") return false;
  const row = value as ResearchPlanRecord;
  return typeof row.id === "string" && typeof row.workspace_id === "string" && typeof row.owner_id === "string" &&
    row.schema_version === "research-plan/1" && row.persistence_state === "PERSISTED" && row.state === "planned" &&
    row.execution_supported === false && typeof row.plan?.question === "string" && typeof row.plan.plan_id === "string" &&
    researchModes.includes(row.plan.mode) &&
    (["subquestions", "private_source_ids", "public_provider_ids", "entity_scope", "rights_constraints", "expected_calculations", "completion_criteria"] as const)
      .every(key => Array.isArray(row.plan[key]) && row.plan[key].every(item => typeof item === "string")) &&
    !!row.limits && (Object.keys(modeLimits.QUICK_LOOKUP) as Array<keyof typeof modeLimits.QUICK_LOOKUP>)
      .every(key => row.limits[key] === modeLimits[row.plan.mode][key]);
}
export async function listResearchPlans(context: ApiRequestContext, after?: string) {
  const result = await request<{ items: ResearchPlanRecord[]; next_after: string | null }>(
    `/api/v2/research/plans?limit=20${after ? `&after=${encodeURIComponent(after)}` : ""}`, undefined, context);
  if (!result || !Array.isArray(result.items) || result.items.some(item => !confirmedResearchPlan(item)) ||
    (result.next_after !== null && typeof result.next_after !== "string"))
    throw new ApiRequestError("Research plan list was not confirmed.", "PERSISTENCE_UNCONFIRMED");
  return result;
}
export async function readResearchPlan(id: string, context: ApiRequestContext) {
  const result = await request<ResearchPlanRecord>(`/api/v2/research/plans/${encodeURIComponent(id)}`, undefined, context);
  if (!confirmedResearchPlan(result)) throw new ApiRequestError("Research plan could not be confirmed.", "PERSISTENCE_UNCONFIRMED");
  return result;
}
export async function createResearchPlan(body: ResearchPlanInput, key: string, context: ApiRequestContext) {
  const result = await request<ResearchPlanRecord>("/api/v2/research/plans", {
    method: "POST", headers: { "Idempotency-Key": key }, body: JSON.stringify(body),
  }, context);
  if (!confirmedResearchPlan(result) || result.plan.plan_id !== body.plan_id)
    throw new ApiRequestError("Research plan save was not confirmed. Refresh before retrying.", "PERSISTENCE_UNCONFIRMED");
  return result;
}

export async function listResearchRuns(planId:string,context:ApiRequestContext,after?:string) {
  const result=await request<{items:ResearchRun[];next_after:string|null}>(`/api/v2/research/plans/${encodeURIComponent(planId)}/runs?limit=20${after?`&after=${encodeURIComponent(after)}`:""}`,undefined,context);
  if(!result||!Array.isArray(result.items)||result.items.length>50||result.items.some(item=>!confirmedResearchRun(item,planId))
    ||(result.next_after!==null&&typeof result.next_after!=="string"))throw new ApiRequestError("Research run list was not confirmed.","PERSISTENCE_UNCONFIRMED");
  return result;
}
export async function researchRunCommand(planId:string,context:ApiRequestContext,operation:"create"|"read"|"cancel"|"resume",runId?:string,key?:string,mode?:string) {
  const result=await request<ResearchRun>(`/api/v2/research/plans/${encodeURIComponent(planId)}/runs${runId?`/${encodeURIComponent(runId)}`:""}${["cancel","resume"].includes(operation)?`/${operation}`:""}`,
    operation==="read"?undefined:{method:"POST",headers:key?{"Idempotency-Key":key}:undefined,body:JSON.stringify({non_sensitive_attested:true,...(["COMPARE","TIMELINE","CONTRADICTION_ANALYSIS","DEEP_RESEARCH","OBLIGATION_ANALYSIS","ENTITY_INVESTIGATION","DUE_DILIGENCE"].includes(mode||"")?{execution_mode:mode}:{})})},context);
  if(!confirmedResearchRun(result,planId)||result.results_included===false||(runId&&result.id!==runId)||(["COMPARE","DEEP_RESEARCH","OBLIGATION_ANALYSIS","ENTITY_INVESTIGATION","DUE_DILIGENCE"].includes(mode||"")&&result.mode!==mode))throw new ApiRequestError("Research run was not confirmed. Refresh before retrying.","PERSISTENCE_UNCONFIRMED");
  return result;
}

export async function listResearchCalculations(planId: string, context: ApiRequestContext) {
  const result=await request<{items: CalculationRecord[]}>(`/api/v2/research/plans/${encodeURIComponent(planId)}/calculations`,undefined,context);
  if(!result || !Array.isArray(result.items) || result.items.length>100 || result.items.some(item=>!confirmedCalculation(item,planId)))
    throw new ApiRequestError("Stored calculations were not confirmed.","PERSISTENCE_UNCONFIRMED");
  return result;
}
export async function createResearchCalculation(planId: string, input: CalculationInput, key: string, context: ApiRequestContext) {
  const result=await request<CalculationRecord>(`/api/v2/research/plans/${encodeURIComponent(planId)}/calculations`,{
    method:"POST",headers:{"Idempotency-Key":key},body:JSON.stringify(input),
  },context);
  if(!confirmedCalculation(result,planId) || result.input.operation!==input.operation || result.input.precision!==input.precision ||
    (["left","right"] as const).some(side=>result.input[side].value!==input[side].value || result.input[side].unit!==input[side].unit ||
      JSON.stringify(result.input[side].evidence_ids)!==JSON.stringify(input[side].evidence_ids)))
    throw new ApiRequestError("Calculation save was not confirmed. Refresh before retrying.","PERSISTENCE_UNCONFIRMED");
  return result;
}

export async function listResearchAggregations(planId:string,context:ApiRequestContext,after?:string) {
  const result=await request<{items:AggregationRecord[];next_after:string|null}>(
    `/api/v2/research/plans/${encodeURIComponent(planId)}/aggregations?limit=20${after?`&after=${encodeURIComponent(after)}`:""}`,undefined,context);
  if(!result || !Array.isArray(result.items) || result.items.some(item=>!confirmedAggregation(item,planId)) ||
    (result.next_after!==null && typeof result.next_after!=="string"))throw new ApiRequestError("Stored aggregate list was not confirmed.","PERSISTENCE_UNCONFIRMED");
  return result;
}
export async function createResearchAggregation(planId:string,input:AggregationInput,key:string,context:ApiRequestContext) {
  const body=canonicalAggregationInput(input);
  const result=await request<AggregationRecord>(`/api/v2/research/plans/${encodeURIComponent(planId)}/aggregations`,{
    method:"POST",headers:{"Idempotency-Key":key},body:JSON.stringify(body),
  },context);
  if(!confirmedAggregation(result,planId) || JSON.stringify(canonicalAggregationInput(result.input))!==JSON.stringify(body))
    throw new ApiRequestError("Aggregate save was not confirmed. Refresh before retrying.","PERSISTENCE_UNCONFIRMED");
  return result;
}

export async function listResearchConversions(planId:string,context:ApiRequestContext,after?:string) {
  const result=await request<{items:ConversionRecord[];next_after:string|null}>(
    `/api/v2/research/plans/${encodeURIComponent(planId)}/conversions?limit=20${after?`&after=${encodeURIComponent(after)}`:""}`,undefined,context);
  if(!result || !Array.isArray(result.items) || result.items.some(item=>!confirmedConversion(item,planId)) ||
    (result.next_after!==null && typeof result.next_after!=="string"))throw new ApiRequestError("Stored conversion list was not confirmed.","PERSISTENCE_UNCONFIRMED");
  return result;
}
export async function createResearchConversion(planId:string,input:ConversionInput,key:string,context:ApiRequestContext) {
  const body=canonicalConversionInput(input);
  const result=await request<ConversionRecord>(`/api/v2/research/plans/${encodeURIComponent(planId)}/conversions`,{
    method:"POST",headers:{"Idempotency-Key":key},body:JSON.stringify(body)},context);
  if(!confirmedConversion(result,planId) || JSON.stringify(canonicalConversionInput(result.input))!==JSON.stringify(body))
    throw new ApiRequestError("Conversion save was not confirmed. Refresh before retrying.","PERSISTENCE_UNCONFIRMED");
  return result;
}

export async function listResearchQuantities(planId:string,context:ApiRequestContext,after?:string){
  const page=await request<{items:QuantityCaptureRecord[];next_after:string|null}>(`/api/v2/research/plans/${encodeURIComponent(planId)}/quantities?limit=20${after?`&after=${encodeURIComponent(after)}`:""}`,undefined,context);
  if(!page || !Array.isArray(page.items) || page.items.some(row=>!confirmedQuantityCapture(row,planId)) || (page.next_after!==null && typeof page.next_after!=="string"))
    throw new ApiRequestError("Stored source quantities were not confirmed.","PERSISTENCE_UNCONFIRMED");
  return page;
}
export async function createResearchQuantity(planId:string,input:QuantityCaptureInput,key:string,context:ApiRequestContext){
  const body=canonicalQuantityCapture(input),row=await request<QuantityCaptureRecord>(`/api/v2/research/plans/${encodeURIComponent(planId)}/quantities`,{
    method:"POST",headers:{"Idempotency-Key":key},body:JSON.stringify(body)},context);
  if(!confirmedQuantityCapture(row,planId) || JSON.stringify(canonicalQuantityCapture(row.input))!==JSON.stringify(body))
    throw new ApiRequestError("Source quantity capture was not confirmed. Refresh before retrying.","PERSISTENCE_UNCONFIRMED");
  return row;
}

export interface FindingSummary {
  id: string;
  workspace_id: string;
  owner_id: string;
  title: string;
  revision: number;
  source_run_id: string | null;
  source_research_run_id?: string | null;
  source_research_position?: number | null;
  created_at: string;
  updated_at: string;
}

export interface FindingDetail extends FindingSummary {
  author_id: string | null;
  permission: "owner" | "read" | "contribute";
  authored_markdown: string;
  generated_markdown: string | null;
  source_unavailable: boolean;
  research_origin?: {run_id:string|null;result_index:number;plan_id:string|null;question:string|null;claim_state:string;source_state:string;comparison?:import("./research-run").ResearchComparison|null;timeline?:import("./research-run").ResearchTimeline|null;contradiction?:import("./research-run").ResearchContradiction|null;deep?:import("./research-run").ResearchDeep|null;obligations?:import("./research-obligations").ResearchObligations|null;entities?:import("./research-entities").ResearchEntities|null;diligence?:import("./research-diligence").ResearchDiligence|null;query_retrieval?:import("./research-run").ResearchQueryRetrieval|null};
  export_state?: "RIGHTS_REVIEW_REQUIRED";
  evidence: Array<{ id: string; document_id: string; version_id: string; original_text?: string; available: boolean; freshness: string;
    citation_id?:string;filename?:string;original_content_hash?:string;location?:unknown }>;
  reviews: Array<{ reviewer_id: string; revision: number; decision: string; comment: string; created_at?:string }>;
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

export async function createResearchFinding(title:string,runId:string,resultIndex:number,key:string,context:ApiRequestContext) {
  const result=await request<FindingSummary>("/api/v2/findings",{method:"POST",headers:{"Idempotency-Key":key},
    body:JSON.stringify({title,research_run_id:runId,result_index:resultIndex,authored_markdown:""})},context);
  if(!result || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(result.id)
    || result.workspace_id!==context.workspaceId || result.source_research_run_id!==runId || result.source_research_position!==resultIndex)
    throw new ApiRequestError("The research finding was not confirmed. Refresh Findings before retrying.","PERSISTENCE_UNCONFIRMED");
  return result;
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

export async function listWorkspaces(
  context: ApiRequestContext = {},
  page: { after?: string; limit?: number } = {}
): Promise<WorkspaceListResponse> {
  const params = new URLSearchParams();
  if (page.after !== undefined) params.set("after", page.after);
  if (page.limit !== undefined) params.set("limit", String(page.limit));
  return request(`/api/v1/workspaces${params.size ? `?${params}` : ""}`, undefined, context);
}

export async function createWorkspace(
  body: WorkspaceCreateRequest,
  context: ApiRequestContext = {}
): Promise<WorkspaceSummary> {
  const normalized = { ...body, name: body.name.trim() };
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(normalized)));
  const key = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, "0")).join("");
  return request("/api/v1/workspaces", {
    method: "POST",
    headers: { "Idempotency-Key": `workspace-create:${key}` },
    body: JSON.stringify(normalized),
  }, context);
}

export async function listCurrentWorkspaceMembers(
  context: ApiRequestContext = {},
  options: { after?: string; limit?: number } = {},
): Promise<WorkspaceMembersResponse> {
  const params = new URLSearchParams();
  if (options.after !== undefined) params.set("after", options.after);
  if (options.limit !== undefined) params.set("limit", String(options.limit));
  const query = params.toString();
  return request(`/api/v1/workspaces/current/members${query ? `?${query}` : ""}`, undefined, context);
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

// Workspace-owner review is separate from provider rights, trial quota and BYOK consent.
export async function getProcessingPolicy(context: ApiRequestContext = {}): Promise<import("./processing-policy").ProcessingPolicy> {
  return request("/api/v1/privacy/processing-policy", undefined, context);
}
export async function updateProcessingPolicy(body: import("./processing-policy").ProcessingPolicyDecision,
  context: ApiRequestContext = {}): Promise<import("./processing-policy").ProcessingPolicy> {
  return request("/api/v1/privacy/processing-policy", { method: "PATCH", body: JSON.stringify(body) }, context);
}

// Codes are ephemeral and POST-body-only, never query parameters or persisted browser state.
export interface WorkspaceInvitation {
  id: string; workspace_id: string; recipient_email: string;
  role: Exclude<import('@/types').WorkspaceRole, 'owner'>;
  state: 'pending' | 'accepted' | 'revoked' | 'expired';
  expires_at: string; created_at: string; created_by: string;
}
export interface InvitationInventory {
  invitations: WorkspaceInvitation[]; total: number; total_is_exact: true;
  next_after: string | null; schema_version: '040';
}
export function listWorkspaceInvitations(context: ApiRequestContext, after?: string): Promise<InvitationInventory> {
  return request(`/api/v1/workspaces/current/invitations${after ? `?after=${encodeURIComponent(after)}` : ''}`,undefined,context);
}
export function createWorkspaceInvitation(body: {recipient_email: string; role: WorkspaceInvitation['role']; token: string; idempotency_key: string},context: ApiRequestContext): Promise<WorkspaceInvitation> {
  return request('/api/v1/workspaces/current/invitations',{method:'POST',body:JSON.stringify(body)},context);
}
export function revokeWorkspaceInvitation(id: string,context: ApiRequestContext): Promise<{success:boolean}> {
  return request(`/api/v1/workspaces/current/invitations/${encodeURIComponent(id)}`,{method:'DELETE'},context);
}
export function acceptWorkspaceInvitation(token: string,context: ApiRequestContext): Promise<{workspace_id:string; role:string; accepted:true; schema_version:'040'}> {
  return request('/api/v1/workspaces/invitations/accept',{method:'POST',body:JSON.stringify({token})},{...context,workspaceId:null});
}

export function getInvitationCapabilities(context: ApiRequestContext): Promise<{invitation_supported:boolean;schema_version?:'040';state?:string}> {
  return request('/api/v1/workspaces/invitations/capabilities',undefined,{...context,workspaceId:null});
}
