/* ═══════════════════════════════════════════════════════════════
   Shared TypeScript types matching the FastAPI Pydantic models
   ═══════════════════════════════════════════════════════════════ */

// ── Documents ────────────────────────────────────────────────

export type DocumentStatus = "pending" | "processing" | "ready" | "error";

export interface DocumentMetadata {
  document_id: string;
  filename: string;
  file_type: string;
  file_size_bytes: number;
  page_count: number;
  chunk_count: number;
  status: DocumentStatus;
  created_at: string;
  processing_time_seconds: number;
  extraction_method: string;
  extra: Record<string, unknown>;
}

export interface DocumentListResponse {
  documents: DocumentMetadata[];
  total: number;
}

export type IngestionJobStatus =
  | "queued"
  | "processing"
  | "completed"
  | "failed"
  | "cancelled";

export interface IngestionJobStatusResponse {
  job_id: string;
  document_id: string;
  filename: string;
  status: IngestionJobStatus;
  stage: string;
  progress: number;
  message: string;
  error_message?: string | null;
  created_at: string;
  updated_at: string;
  started_at?: string | null;
  completed_at?: string | null;
  document?: DocumentMetadata | null;
}

export interface DocumentUploadResponse {
  success: boolean;
  message: string;
  document: DocumentMetadata | null;
  job_id?: string | null;
  job?: IngestionJobStatusResponse | null;
}

export interface DocumentChunkPreview {
  chunk_index: number;
  content: string;
  page_number: number;
  section_title?: string | null;
  token_count: number;
  metadata: Record<string, unknown>;
}

export interface DocumentChunkListResponse {
  document_id: string;
  filename: string;
  chunks: DocumentChunkPreview[];
  total: number;
  query?: string | null;
}

// ── Chat ─────────────────────────────────────────────────────

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp?: string;
}

export interface SourceChunk {
  content: string;
  filename: string;
  page_number: number;
  chunk_index: number;
  relevance_score: number;
  document_type: string;
  metadata: Record<string, unknown>;
}

export interface QueryRequest {
  question: string;
  session_id?: string;
  conversation_history?: ChatMessage[];
  top_k?: number;
  use_reranking?: boolean;
  chat_scope?: "workspace" | "documents";
  document_ids?: string[];
  file_types?: string[];
  filename?: string;
  min_page?: number;
  max_page?: number;
  uploaded_by?: string;
  uploaded_after?: string;
  uploaded_before?: string;
  metadata_filters?: Record<string, string | number | boolean>;
}

export interface QueryResponse {
  answer: string;
  sources: SourceChunk[];
  query_type: string;
  confidence: number;
  response_time_seconds: number;
  metadata: Record<string, unknown>;
}

export interface ChatHistoryMessage {
  role: "user" | "assistant" | "system";
  content: string;
  sources: SourceChunk[];
  metadata: Record<string, unknown>;
  created_at?: string | null;
}

export interface ChatHistoryResponse {
  session_id: string;
  messages: ChatHistoryMessage[];
  total: number;
}

// ── WebSocket frames ─────────────────────────────────────────

export interface WSTokenFrame {
  type: "token";
  content: string;
}

export interface WSSourcesFrame {
  type: "sources";
  sources: SourceChunk[];
}

export interface WSDoneFrame {
  type: "done";
  metadata: Record<string, unknown>;
}

export interface WSErrorFrame {
  type: "error";
  content: string;
  error_code?: string;
}

export type WSFrame = WSTokenFrame | WSSourcesFrame | WSDoneFrame | WSErrorFrame;

// ── Settings ─────────────────────────────────────────────────

export interface AppSettings {
  llm_model_name: string;
  llm_temperature: number;
  retrieval_top_k: number;
  enable_reranking: boolean;
  hybrid_search_alpha: number;
  context_window_messages: number;
  chunk_size: number;
  chunk_overlap: number;
  enable_semantic_chunking: boolean;
  enable_contextual_enrichment: boolean;
  embedding_model: string;
  enforce_tenant_quotas?: boolean;
  quota_daily_queries?: number;
  quota_daily_tokens?: number;
  quota_max_documents?: number;
  quota_max_storage_mb?: number;
}

export interface SettingsUpdate {
  llm_temperature?: number;
  retrieval_top_k?: number;
  enable_reranking?: boolean;
  hybrid_search_alpha?: number;
  context_window_messages?: number;
  enable_semantic_chunking?: boolean;
  enable_contextual_enrichment?: boolean;
}

export interface ApiKeyStatusResponse {
  success?: boolean;
  message?: string;
  provider: string;
  workspace_id: string;
  workspace_key_configured: boolean;
  server_key_configured: boolean;
  key_fingerprint: string | null;
  created_at?: string | null;
  storage: "memory" | "supabase";
}

// -- Workspaces -----------------------------------------------------------

export type WorkspaceRole = "owner" | "admin" | "editor" | "viewer";

export interface WorkspaceSummary {
  id: string;
  name: string;
  slug: string;
  plan: string;
  role: WorkspaceRole;
  owner_id?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface WorkspaceListResponse {
  workspaces: WorkspaceSummary[];
  total: number;
}

export interface WorkspaceCreateRequest {
  name: string;
  slug?: string | null;
}

export interface WorkspaceMember {
  user_id: string;
  email?: string | null;
  display_name?: string | null;
  avatar_url?: string | null;
  role: WorkspaceRole;
  created_at?: string | null;
}

export interface WorkspaceMembersResponse {
  workspace_id: string;
  members: WorkspaceMember[];
  total: number;
}

export interface WorkspaceMemberCreateRequest {
  email_or_user_id: string;
  role: Exclude<WorkspaceRole, "owner">;
}

export interface WorkspaceMemberUpdateRequest {
  role: Exclude<WorkspaceRole, "owner">;
}

export interface BillingUsageResponse {
  storage: "memory" | "supabase";
  daily: Array<{
    usage_date: string;
    query_count: number;
    total_tokens: number;
    estimated_cost_microusd: number;
    reconciled_at: string;
  }>;
  totals: {
    query_count?: number;
    total_tokens?: number;
    estimated_cost_microusd?: number;
  };
}

export interface PrivacySettingsResponse {
  retention_enabled: boolean;
  retention_days: number;
  last_retention_at?: string | null;
  next_retention_at?: string | null;
}

export interface WorkspaceLifecycleResponse {
  workspace_deleted: boolean;
  documents_deleted: number;
  chat_sessions_deleted: number;
  local_chunks_deleted: number;
  qdrant_chunks_deleted: number;
  failures: Array<{ document_id: string; message: string }>;
}

// ── Analytics ────────────────────────────────────────────────

export interface AnalyticsSummary {
  total_queries: number;
  total_documents: number;
  total_chunks: number;
  avg_response_time: number;
  avg_confidence: number;
  queries_today: number;
  cache_hits: number;
  cache_misses: number;
  cache_entries: number;
  llm_model_name: string;
  embedding_model: string;
  llm_usage_events?: number;
  llm_input_tokens?: number;
  llm_output_tokens?: number;
  llm_total_tokens?: number;
  llm_successful_events?: number;
  llm_error_events?: number;
  llm_fallbacks?: number;
  llm_cache_hits?: number;
  usage_avg_latency_ms?: number;
  usage_tokens_today?: number;
  audit_events?: number;
  last_activity_at?: string | null;
  quota?: {
    enforced?: boolean;
    limits?: Record<string, number>;
    usage?: Record<string, number>;
    remaining?: Record<string, number>;
  };
}

export interface AuditEvent {
  id?: string | null;
  workspace_id: string;
  user_id?: string | null;
  action: string;
  resource_type?: string | null;
  resource_id?: string | null;
  metadata: Record<string, unknown>;
  created_at?: string | null;
}

export interface AuditEventListResponse {
  events: AuditEvent[];
  total: number;
  storage: "memory" | "supabase";
}

// -- Evaluations -----------------------------------------------------------

export type EvaluationMode = "retrieval" | "extractive";

export interface EvaluationRunRequest {
  mode?: EvaluationMode;
  top_k?: number | null;
  fail_under_recall?: number;
  fail_under_citation_precision?: number;
}

export interface EvaluationGateCheck {
  value: number;
  threshold: number;
  passed: boolean;
}

export interface EvaluationGates {
  passed: boolean;
  checks: Record<string, EvaluationGateCheck>;
}

export interface EvaluationCaseResult {
  id: string;
  question: string;
  workspace_id: string;
  mode: string;
  answer: string;
  sources: Array<{
    filename: string;
    document_id: string;
    workspace_id: string;
    score: number;
  }>;
  metrics: Record<string, number | boolean | string>;
  passed: boolean;
}

export interface EvaluationReportResponse {
  dataset: string;
  mode: string;
  generated_at: string;
  duration_ms: number;
  summary: Record<string, number | string | boolean>;
  gates: EvaluationGates;
  results: EvaluationCaseResult[];
}

export interface SystemStatusSettings {
  retrieval_top_k?: number;
  enable_reranking?: boolean;
  hybrid_search_alpha?: number;
  enable_semantic_chunking?: boolean;
  enable_contextual_enrichment?: boolean;
  enable_query_expansion?: boolean;
  memory_constrained?: boolean;
  max_upload_size_mb?: number;
  use_lightweight_embeddings?: boolean;
  max_pdf_pages?: number;
  max_pdf_ocr_pages?: number;
  pdf_ocr_dpi?: number;
  enable_pdf_embedded_image_ocr?: boolean;
  enable_docx_embedded_image_ocr?: boolean;
  max_pdf_embedded_images?: number;
  max_docx_embedded_images?: number;
  max_image_megapixels?: number;
  supabase_configured?: boolean;
  supabase_auth_configured?: boolean;
  supabase_data_api_reachable?: boolean;
  supabase_data_api_status?: string;
  auth_required?: boolean;
  anonymous_demo_enabled?: boolean;
  qdrant_configured?: boolean;
  enable_qdrant?: boolean;
  qdrant_collection?: string;
  vector_backend?: string;
  enable_pgvector_fallback?: boolean;
  enable_local_faiss?: boolean;
  enable_async_ingestion?: boolean;
  enforce_tenant_quotas?: boolean;
  quota_daily_queries?: number;
  quota_daily_tokens?: number;
  quota_max_documents?: number;
  quota_max_storage_mb?: number;
}

export interface SystemCapabilities {
  streaming?: boolean;
  hybrid_search?: boolean;
  semantic_cache?: boolean;
  reranking?: boolean;
  semantic_chunking?: boolean;
  contextual_enrichment?: boolean;
  ocr?: boolean;
}

export interface SystemStatusResponse {
  service: string;
  status: string;
  version: string;
  total_documents: number;
  total_chunks: number;
  api_key_configured: boolean;
  llm_model_name: string;
  embedding_model: string;
  cache: Record<string, unknown>;
  settings: SystemStatusSettings;
  capabilities: SystemCapabilities;
  provider_health?: Array<{
    provider: string;
    model: string;
    mode: string;
    consecutive_failures: number;
    quota_exhausted: boolean;
    last_error_code?: string | null;
    circuit_open: boolean;
    circuit_open_until?: string | null;
  }>;
}

// ── UI state ─────────────────────────────────────────────────

export interface UIMessage extends ChatMessage {
  id: string;
  sources?: SourceChunk[];
  queryType?: string;
  confidence?: number;
  responseTime?: number;
  isStreaming?: boolean;
  metadata?: Record<string, unknown>;
}
