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
import { passportSubjectIdentity } from "@/lib/product-passport-subject";
import { confirmedResearchRun, type ResearchRun } from "@/lib/research-run";
import {confirmedRadarSource,confirmedRadarSnapshot,confirmedRadarChange,confirmedRadarChangeDetail,confirmedRadarPage,confirmedRadarChunks,confirmedRadarRights,confirmedRadarReview,confirmedRadarRuns,confirmedRadarFindingCreation,radarUuid,
  type RadarSource,type RadarSourceDetail,type RadarCapture,type RadarChangeDetail,type RadarKind,type RadarProvider,type RadarChunks,type RadarReview,type RadarOrigin} from "@/lib/radar";
import { confirmedCalculation, type CalculationInput, type CalculationRecord } from "@/lib/research-calculation";
import { canonicalAggregationInput, confirmedAggregation, type AggregationInput, type AggregationRecord } from "@/lib/research-aggregation";
import {canonicalConversionInput,confirmedConversion,type ConversionInput,type ConversionRecord} from "@/lib/research-conversion";
import {canonicalQuantityCapture,confirmedQuantityCapture,type QuantityCaptureInput,type QuantityCaptureRecord} from "@/lib/research-quantity";
import { readOriginalDownload, originalTransferPolicy, type OriginalDownloadOptions } from "@/lib/document-original";
import {confirmedExportRights,confirmedFindingPackage,confirmedPackageReceipt,confirmedPackageSummary,type FindingPackageReceipt,type FindingExportRights,type FindingExportPolicy,type FindingPackage} from "@/lib/finding-package";

import {canonicalServingCommand,confirmedObligationDetail,confirmedObligationList,confirmedServingRights,type FindingServingCommand,type FindingServingRights,type ObligationEvidenceDetail,type ObligationEvidenceList,type ServingAction} from "@/lib/obligation-evidence";

import {servingIntentHash} from "./serving-intent.js";

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
  readonly status?: number;
  readonly retryAfterSeconds?: number;
  constructor(message: string, code?: string, status?:number, retryAfterSeconds?:number) {
    super(message);
    this.name = "ApiRequestError";
    this.code = code;
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
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
    const retry=res.headers.get("Retry-After");
    const seconds=retry&&/^\d+$/.test(retry)?Number(retry):retry?Math.ceil((Date.parse(retry)-Date.now())/1000):undefined;
    throw new ApiRequestError(error.message,error.code,res.status,seconds!==undefined&&Number.isSafeInteger(seconds)&&seconds>=0?seconds:undefined);
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
  if(row.plan&&Object.hasOwn(row.plan,"passport_subject")) {
    if(row.plan.mode!=="PRODUCT_PASSPORT")return false;
    try { passportSubjectIdentity(row.plan.passport_subject); } catch { return false; }
  }
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
  let subjectMatches=false;
  try { subjectMatches=Object.hasOwn(body,"passport_subject")===Object.hasOwn(result?.plan||{},"passport_subject")
    &&(!Object.hasOwn(body,"passport_subject")||passportSubjectIdentity(body.passport_subject)===passportSubjectIdentity(result?.plan?.passport_subject)); } catch { subjectMatches=false; }
  if (!confirmedResearchPlan(result) || result.plan.plan_id !== body.plan_id || !subjectMatches)
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
  const expectsMode=["COMPARE","TIMELINE","CONTRADICTION_ANALYSIS","DEEP_RESEARCH","OBLIGATION_ANALYSIS","ENTITY_INVESTIGATION","DUE_DILIGENCE","PRODUCT_PASSPORT","PROCUREMENT_RESEARCH"].includes(mode||"");
  const result=await request<ResearchRun>(`/api/v2/research/plans/${encodeURIComponent(planId)}/runs${runId?`/${encodeURIComponent(runId)}`:""}${["cancel","resume"].includes(operation)?`/${operation}`:""}`,
    operation==="read"?undefined:{method:"POST",headers:key?{"Idempotency-Key":key}:undefined,body:JSON.stringify({non_sensitive_attested:true,...(expectsMode?{execution_mode:mode}:{})})},context);
  if(!confirmedResearchRun(result,planId)||result.results_included===false||(runId&&result.id!==runId)||(expectsMode&&result.mode!==mode))throw new ApiRequestError("Research run was not confirmed. Refresh before retrying.","PERSISTENCE_UNCONFIRMED");
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
  source_research_mode?:string|null;
  source_radar_change_id?:string|null;
  created_at: string;
  updated_at: string;
}

export interface FindingDetail extends FindingSummary {
  author_id: string | null;
  permission: "owner" | "read" | "contribute";
  authored_markdown: string;
  generated_markdown: string | null;
  source_unavailable: boolean;
  radar_origin?:RadarOrigin|null;
  confirmed_creation?:import("./radar").RadarFindingCreation;
  research_origin?: {run_id:string|null;result_index:number;plan_id:string|null;question:string|null;claim_state:string;source_state:string;comparison?:import("./research-run").ResearchComparison|null;timeline?:import("./research-run").ResearchTimeline|null;contradiction?:import("./research-run").ResearchContradiction|null;deep?:import("./research-run").ResearchDeep|null;obligations?:import("./research-obligations").ResearchObligations|null;entities?:import("./research-entities").ResearchEntities|null;diligence?:import("./research-diligence").ResearchDiligence|null;passport?:import("./research-passport").ResearchPassport|null;procurement?:import("./research-procurement").ResearchProcurement|null;query_retrieval?:import("./research-run").ResearchQueryRetrieval|null};
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

export async function readFindingExportRights(id:string,context:ApiRequestContext) {
  const result=await request<FindingExportRights>(`/api/v2/findings/${encodeURIComponent(id)}/export-rights`,undefined,context);
  if(!confirmedExportRights(result,id))throw new ApiRequestError("The current export review was not confirmed. Refresh before retrying.","PERSISTENCE_UNCONFIRMED");
  return result;
}
export async function recordFindingExportRights(id:string,body:{revision:number;selections:Array<{version_id:string;expected_review_id:string|null}>;policy:FindingExportPolicy},key:string,context:ApiRequestContext) {
  const result=await request<FindingExportRights>(`/api/v2/findings/${encodeURIComponent(id)}/export-rights`,
    {method:"POST",headers:{"Idempotency-Key":key},body:JSON.stringify(body)},context);
  if(!confirmedExportRights(result,id)||result.revision!==body.revision)throw new ApiRequestError("The saved export review was not confirmed. Refresh before retrying.","PERSISTENCE_UNCONFIRMED");
  return result;
}
export async function createFindingPackage(id:string,revision:number,key:string,context:ApiRequestContext) {
  const receipt=await request<FindingPackageReceipt>(`/api/v2/findings/${encodeURIComponent(id)}/packages`,
    {method:"POST",headers:{"Idempotency-Key":key},body:JSON.stringify({revision})},context);
  if(!confirmedPackageReceipt(receipt,id,context.workspaceId,revision))throw new ApiRequestError("The saved package receipt was not confirmed. Refresh before retrying.","PERSISTENCE_UNCONFIRMED");
  const result=await readFindingPackage(id,receipt.id,context);
  if(result.finding_revision!==revision||result.manifest_hash!==receipt.manifest_hash||result.manifest_bytes!==receipt.manifest_bytes)
    throw new ApiRequestError("The exact saved package was not confirmed. Refresh before retrying.","PERSISTENCE_UNCONFIRMED");
  return result;
}
export async function readFindingPackage(id:string,packageId:string,context:ApiRequestContext) {
  const result=await request<FindingPackage>(`/api/v2/findings/${encodeURIComponent(id)}/packages/${encodeURIComponent(packageId)}`,undefined,context);
  if(result?.id!==packageId||!await confirmedFindingPackage(result,id,context.workspaceId))throw new ApiRequestError("The saved package readback was not confirmed.","PERSISTENCE_UNCONFIRMED");
  return result;
}
export async function listFindingPackages(id:string,context:ApiRequestContext,after?:string) {
  const result=await request<{schema_version:"finding-package-list/1";items:Array<Omit<FindingPackage,"manifest_text">>;next_after:string|null}>(
    `/api/v2/findings/${encodeURIComponent(id)}/packages?limit=20${after?`&after=${encodeURIComponent(after)}`:""}`,undefined,context);
  if(!result||result.schema_version!=="finding-package-list/1"||!Array.isArray(result.items)||result.items.length>20
    ||result.items.some(row=>!confirmedPackageSummary(row,id,context.workspaceId)||Object.hasOwn(row,"manifest_text"))
    ||new Set(result.items.map(row=>row.id)).size!==result.items.length
    ||result.next_after!==null&&result.items.at(-1)?.id!==result.next_after)
    throw new ApiRequestError("The saved package list was not confirmed. Refresh before retrying.","PERSISTENCE_UNCONFIRMED");
  return result;
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


// Supplied-document Radar: current workspace and durable response identity are
// confirmed separately from claims about source ownership or provider permission.
function radarWorkspace(context:ApiRequestContext):string {
  if(!radarUuid(context.workspaceId))throw new ApiRequestError("Choose a workspace before opening Radar.","INVALID_SCOPE");
  return context.workspaceId;
}
function radarUnconfirmed():never {throw new ApiRequestError("Radar persistence was not confirmed. Refresh before retrying the same intent.","PERSISTENCE_UNCONFIRMED");}
export async function listRadarProviders(context:ApiRequestContext,after?:string):Promise<{schema_version:"radar-providers/1";items:RadarProvider[];next_after:string|null}> {
  radarWorkspace(context);
  const result=await request<{schema_version:string;items:RadarProvider[];next_after:string|null}>(`/api/v2/radar/providers?limit=20${after?`&after=${encodeURIComponent(after)}`:""}`,undefined,context);
  if(result?.schema_version!=="radar-providers/1"||!Array.isArray(result.items)||result.items.length>20||result.items.some(p=>typeof p.id!=="string"||!p.id||typeof p.display_name!=="string"||!Number.isSafeInteger(p.revision)||!confirmedRadarRights(p.rights))
    ||result.next_after!==null&&(typeof result.next_after!=="string"||!result.next_after||result.next_after.length>128))radarUnconfirmed();
  return result as {schema_version:"radar-providers/1";items:RadarProvider[];next_after:string|null};
}
export async function listRadarSources(context:ApiRequestContext,after?:string) {
  const workspace=radarWorkspace(context),result=await request<unknown>(`/api/v2/radar/sources?limit=20${after?`&after=${encodeURIComponent(after)}`:""}`,undefined,context);
  if(!result||typeof result!=="object"||!("schema_version" in result)||result.schema_version!=="radar-source-list/1"
    ||!confirmedRadarPage<RadarSource>(result,(row):row is RadarSource=>confirmedRadarSource(row,workspace)))radarUnconfirmed();
  return result;
}
export async function createRadarSource(body:{provider_id:string;source_url:string;title:string;kind:RadarKind},key:string,context:ApiRequestContext) {
  const workspace=radarWorkspace(context),result=await request<unknown>("/api/v2/radar/sources",{method:"POST",headers:{"Content-Type":"application/json","Idempotency-Key":key},body:JSON.stringify(body)},context);
  if(!confirmedRadarSource(result,workspace)||result.provider_id!==body.provider_id||result.source_url!==body.source_url||result.title!==body.title||result.kind!==body.kind)radarUnconfirmed();
  return result;
}
export async function readRadarSource(id:string,context:ApiRequestContext,after?:string):Promise<RadarSourceDetail> {
  const workspace=radarWorkspace(context),result=await request<RadarSourceDetail>(`/api/v2/radar/sources/${encodeURIComponent(id)}?limit=20${after?`&after=${encodeURIComponent(after)}`:""}`,undefined,context);
  if(result?.schema_version!=="radar-source-detail/1"||!confirmedRadarSource(result.source,workspace,id)
    ||!confirmedRadarPage(result.snapshots,(row):row is import("./radar").RadarSnapshot=>confirmedRadarSnapshot(row,workspace,id))
    ||!confirmedRadarPage(result.changes,(row):row is import("./radar").RadarChange=>confirmedRadarChange(row,workspace,id))
    ||!confirmedRadarRuns(result.runs,workspace,result.source.monitor.id)
    ||(result.source.latest_snapshot_id===null?result.latest_snapshot!==null:!confirmedRadarSnapshot(result.latest_snapshot,workspace,id)||result.latest_snapshot.id!==result.source.latest_snapshot_id))radarUnconfirmed();
  return result;
}
export async function listRadarRuns(sourceId:string,context:ApiRequestContext,after?:string) {
  const workspace=radarWorkspace(context),result=await request<unknown>(`/api/v2/radar/sources/${encodeURIComponent(sourceId)}/runs?limit=20${after?`&after=${encodeURIComponent(after)}`:""}`,undefined,context);
  if(!confirmedRadarRuns(result,workspace))radarUnconfirmed();return result;
}
export async function readRadarChunks(documentId:string,context:ApiRequestContext,after?:string,versionId?:string):Promise<RadarChunks> {
  radarWorkspace(context);
  const result=await request<unknown>(`/api/v2/radar/documents/${encodeURIComponent(documentId)}/chunks?limit=50${after?`&after=${encodeURIComponent(after)}`:""}${versionId?`&version_id=${encodeURIComponent(versionId)}`:""}`,undefined,context);
  if(!confirmedRadarChunks(result,documentId,versionId))radarUnconfirmed();return result;
}
export async function captureRadarSnapshot(sourceId:string,body:{expected_revision:number;document_id:string;version_id:string;chunk_ids:string[];before_chunk_ids?:string[];captured_at:string;rights_rationale:string},key:string,context:ApiRequestContext):Promise<RadarCapture> {
  const workspace=radarWorkspace(context),result=await request<RadarCapture>(`/api/v2/radar/sources/${encodeURIComponent(sourceId)}/snapshots`,{method:"POST",headers:{"Content-Type":"application/json","Idempotency-Key":key},body:JSON.stringify(body)},context);
  if(result?.schema_version!=="radar-capture/1"||!confirmedRadarSource(result.source,workspace,sourceId)||!confirmedRadarSnapshot(result.snapshot,workspace,sourceId)
    ||!confirmedRadarChangeDetail(result.change,workspace)||result.change.source_id!==sourceId||result.change.after_snapshot_id!==result.snapshot.id
    ||result.snapshot.revision!==body.expected_revision+1||result.source.revision<result.snapshot.revision
    ||result.source.revision===result.snapshot.revision&&result.source.latest_snapshot_id!==result.snapshot.id
    ||result.snapshot.document_id!==body.document_id||result.snapshot.version_id!==body.version_id
    ||result.snapshot.chunk_ids.length!==body.chunk_ids.length||result.snapshot.chunk_ids.some(id=>!body.chunk_ids.includes(id))
    ||body.before_chunk_ids&&(result.change.before_chunk_ids.length!==body.before_chunk_ids.length||result.change.before_chunk_ids.some(id=>!body.before_chunk_ids!.includes(id))))radarUnconfirmed();
  return result;
}
export async function readRadarChange(id:string,context:ApiRequestContext):Promise<RadarChangeDetail> {
  const workspace=radarWorkspace(context),result=await request<unknown>(`/api/v2/radar/changes/${encodeURIComponent(id)}`,undefined,context);
  if(!confirmedRadarChangeDetail(result,workspace,id))radarUnconfirmed();return result;
}
export async function reviewRadarChange(id:string,body:{expected_review_revision:number;decision:"approved"|"changes_requested";comment:string;affected_workflows:string[]},key:string,context:ApiRequestContext):Promise<RadarChangeDetail> {
  const workspace=radarWorkspace(context),result=await request<unknown>(`/api/v2/radar/changes/${encodeURIComponent(id)}/review`,{method:"POST",headers:{"Content-Type":"application/json","Idempotency-Key":key},body:JSON.stringify(body)},context);
  if(!confirmedRadarChangeDetail(result,workspace,id)||!confirmedRadarReview(result.confirmed_review)
    ||result.confirmed_review.revision!==body.expected_review_revision+1||result.confirmed_review.decision!==body.decision||result.confirmed_review.comment!==body.comment
    ||JSON.stringify(result.confirmed_review.affected_workflows)!==JSON.stringify(body.affected_workflows)
    ||Boolean(context.expectedUserId)&&result.confirmed_review.reviewer_id!==context.expectedUserId)radarUnconfirmed();return result;
}
export async function listRadarReviews(id:string,context:ApiRequestContext,after:number) {
  radarWorkspace(context);
  const result=await request<{schema_version:string;items:RadarReview[];next_after:number|null;review_count:number}>(`/api/v2/radar/changes/${encodeURIComponent(id)}/reviews?limit=20&after=${after}`,undefined,context);
  if(result?.schema_version!=="radar-review-list/1"||!Array.isArray(result.items)||result.items.length>20||result.items.some(r=>!confirmedRadarReview(r)||!r.revision||r.revision<=after)
    ||!Number.isSafeInteger(result.review_count)||result.review_count<result.items.length||result.next_after!==null&&(!Number.isSafeInteger(result.next_after)||result.next_after<=after))radarUnconfirmed();
  return result;
}
export async function createRadarFinding(id:string,body:{title:string;authored_markdown:string;expected_review_revision:number},key:string,context:ApiRequestContext):Promise<FindingDetail> {
  const noteBytes=new TextEncoder().encode(body.authored_markdown);
  let noteHash:string;
  try{noteHash=[...new Uint8Array(await crypto.subtle.digest("SHA-256",noteBytes))].map(value=>value.toString(16).padStart(2,"0")).join("");}
  catch{radarUnconfirmed();}
  const workspace=radarWorkspace(context),result=await request<FindingDetail>(`/api/v2/radar/changes/${encodeURIComponent(id)}/finding`,{method:"POST",headers:{"Content-Type":"application/json","Idempotency-Key":key},body:JSON.stringify(body)},context);
  const receipt=result?.confirmed_creation;
  if(!radarUuid(result?.id)||result.workspace_id!==workspace||result.source_radar_change_id!==id||result.radar_origin?.id!==id
    ||!confirmedRadarFindingCreation(receipt)||receipt.workspace_id!==workspace||receipt.finding_id!==result.id||receipt.change_id!==id
    ||receipt.expected_review_revision!==body.expected_review_revision||receipt.title!==body.title
    ||receipt.authored_markdown_hash!==noteHash||receipt.authored_markdown_bytes!==noteBytes.byteLength
    ||Boolean(context.expectedUserId)&&receipt.created_by!==context.expectedUserId)radarUnconfirmed();
  return result;
}

function evidenceWorkspace(action:ServingAction,context:ApiRequestContext) {
  if(!context.workspaceId||!["SERVE_API","SERVE_MCP"].includes(action))throw new ApiRequestError("Choose a workspace and serving action to inspect obligation evidence.","INVALID_SCOPE");
  return context.workspaceId;
}
function evidenceIdentifier(value:string) {
  if(!radarUuid(value))throw new ApiRequestError("Choose a valid Finding or page identifier.","INVALID_SCOPE");
  return value.toLowerCase();
}
export async function listObligationEvidence(action:ServingAction,context:ApiRequestContext,after?:string,limit=20):Promise<ObligationEvidenceList> {
  const workspace=evidenceWorkspace(action,context);
  if(after!==undefined)after=evidenceIdentifier(after);
  if(!Number.isSafeInteger(limit)||limit<1||limit>50)throw new ApiRequestError("Choose a page size from 1 to 50.","INVALID_SCOPE");
  const result=action==="SERVE_API"?await request<ObligationEvidenceList>(`/api/v2/obligations?limit=${limit}${after?`&after=${encodeURIComponent(after)}`:""}`,undefined,context)
    :await request<ObligationEvidenceList>("/api/v2/mcp/execute",{method:"POST",body:JSON.stringify({operation:"obligation_lookup",limit,...(after?{after}:{})})},context);
  if(!confirmedObligationList(result,workspace,action,limit,after)||action==="SERVE_MCP"&&(!("protocol" in result)||result.protocol!=="nexusrag-evidence-mcp/1"||!("operation" in result)||result.operation!=="obligation_lookup"))
    throw new ApiRequestError("The obligation evidence list was not confirmed. Reload before retrying.","PERSISTENCE_UNCONFIRMED");
  return result;
}
export async function readObligationEvidence(id:string,revision:number,action:ServingAction,context:ApiRequestContext):Promise<ObligationEvidenceDetail> {
  const workspace=evidenceWorkspace(action,context);
  id=evidenceIdentifier(id);
  if(!Number.isSafeInteger(revision)||revision<1)throw new ApiRequestError("Choose an exact saved Finding revision.","INVALID_SCOPE");
  const result=action==="SERVE_API"?await request<ObligationEvidenceDetail>(`/api/v2/obligations/${encodeURIComponent(id)}?revision=${revision}`,undefined,context)
    :await request<ObligationEvidenceDetail>("/api/v2/mcp/execute",{method:"POST",body:JSON.stringify({operation:"obligation_lookup",finding_id:id,revision})},context);
  if(!await confirmedObligationDetail(result,id,revision,workspace,action)||action==="SERVE_MCP"&&(!("protocol" in result)||result.protocol!=="nexusrag-evidence-mcp/1"||!("operation" in result)||result.operation!=="obligation_lookup"))
    throw new ApiRequestError("The exact obligation evidence was not confirmed. Reload before retrying.","PERSISTENCE_UNCONFIRMED");
  return result;
}
export async function readFindingServingRights(id:string,action:ServingAction,context:ApiRequestContext):Promise<FindingServingRights> {
  id=evidenceIdentifier(id);
  const workspace=evidenceWorkspace(action,context),result=await request<FindingServingRights>(`/api/v2/findings/${encodeURIComponent(id)}/serving-rights?action=${action}`,undefined,context);
  if(!confirmedServingRights(result,id,workspace,action)||result.confirmed_review!==null)throw new ApiRequestError("The current serving rights were not confirmed. Reload before retrying.","PERSISTENCE_UNCONFIRMED");
  return result;
}
export async function recordFindingServingRights(id:string,action:ServingAction,body:FindingServingCommand,key:string,context:ApiRequestContext):Promise<FindingServingRights> {
  id=evidenceIdentifier(id);
  const workspace=evidenceWorkspace(action,context),command=canonicalServingCommand(body);
  if(!context.expectedUserId||!command)throw new ApiRequestError("Confirm your account, source selections and bounded rights policy before saving.","INVALID_SCOPE");
  const expectedHash=await servingIntentHash({finding_id:id,finding_revision:command.revision,action,actor_id:context.expectedUserId,command:{selections:command.selections,policy:command.policy}});
  const result=await request<FindingServingRights>(`/api/v2/findings/${encodeURIComponent(id)}/serving-rights?action=${action}`,{method:"POST",headers:{"Idempotency-Key":key},body:JSON.stringify(command)},context);
  const confirmation=result?.confirmed_review;
  if(!confirmedServingRights(result,id,workspace,action)||!confirmation||confirmation.finding_revision!==body.revision||confirmation.actor_id!==context.expectedUserId
    ||confirmation.review_ids.length!==command.selections.length||confirmation.intent_hash!==expectedHash)
    throw new ApiRequestError("The saved serving decision was not confirmed. Inspect current rights before retrying.","PERSISTENCE_UNCONFIRMED");
  return result;
}
