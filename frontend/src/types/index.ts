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

export interface DocumentUploadResponse {
  success: boolean;
  message: string;
  document: DocumentMetadata | null;
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
}

export interface QueryResponse {
  answer: string;
  sources: SourceChunk[];
  query_type: string;
  confidence: number;
  response_time_seconds: number;
  metadata: Record<string, unknown>;
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
}

export interface SettingsUpdate {
  llm_temperature?: number;
  retrieval_top_k?: number;
  enable_reranking?: boolean;
  hybrid_search_alpha?: number;
  context_window_messages?: number;
}

// ── Analytics ────────────────────────────────────────────────

export interface AnalyticsSummary {
  total_queries: number;
  total_documents: number;
  total_chunks: number;
  avg_response_time: number;
  avg_confidence: number;
  queries_today: number;
}

// ── UI state ─────────────────────────────────────────────────

export interface UIMessage extends ChatMessage {
  id: string;
  sources?: SourceChunk[];
  queryType?: string;
  confidence?: number;
  responseTime?: number;
  isStreaming?: boolean;
}