"""
Pydantic Models for API Request / Response
==========================================

Every model is strictly typed, has examples, and is serialization-ready.
"""

from __future__ import annotations

from datetime import UTC, datetime
from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, Field

# ── Enums ─────────────────────────────────────────────────────────────────


class DocumentStatus(StrEnum):
    PENDING = "pending"
    PROCESSING = "processing"
    READY = "ready"
    ERROR = "error"


class QueryType(StrEnum):
    LIST_ALL = "list_all"
    SPECIFIC = "specific"
    AGGREGATION = "aggregation"
    COMPARISON = "comparison"
    SUMMARY = "summary"
    FILTER = "filter"
    GENERAL = "general"


# ── Documents ─────────────────────────────────────────────────────────────


class DocumentMetadata(BaseModel):
    """Metadata returned after document ingestion."""

    document_id: str
    filename: str
    file_type: str
    file_size_bytes: int
    page_count: int = 0
    chunk_count: int = 0
    status: DocumentStatus = DocumentStatus.PENDING
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    processing_time_seconds: float = 0.0
    extraction_method: str = ""
    extra: dict[str, Any] = Field(default_factory=dict)


class DocumentListResponse(BaseModel):
    documents: list[DocumentMetadata]
    total: int


class IngestionJobStatus(StrEnum):
    QUEUED = "queued"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class IngestionJobStatusResponse(BaseModel):
    job_id: str
    document_id: str
    filename: str
    status: IngestionJobStatus
    stage: str = "queued"
    progress: int = Field(default=0, ge=0, le=100)
    message: str = ""
    error_message: str | None = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    started_at: datetime | None = None
    completed_at: datetime | None = None
    document: DocumentMetadata | None = None


class DocumentUploadResponse(BaseModel):
    success: bool
    message: str
    document: DocumentMetadata | None = None
    job_id: str | None = None
    job: IngestionJobStatusResponse | None = None


class DocumentDeleteResponse(BaseModel):
    success: bool
    message: str
    document_id: str


class DocumentChunkPreview(BaseModel):
    chunk_index: int = 0
    content: str
    page_number: int = 0
    section_title: str | None = None
    token_count: int = 0
    metadata: dict[str, Any] = Field(default_factory=dict)


class DocumentChunkListResponse(BaseModel):
    document_id: str
    filename: str
    chunks: list[DocumentChunkPreview] = Field(default_factory=list)
    total: int = 0
    query: str | None = None


# ── Chat / Query ──────────────────────────────────────────────────────────


class ChatMessage(BaseModel):
    role: str = Field(..., pattern="^(user|assistant|system)$")
    content: str
    timestamp: str | None = None


class ChatHistoryMessage(BaseModel):
    role: str = Field(..., pattern="^(user|assistant|system)$")
    content: str
    sources: list[dict[str, Any]] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: str | None = None


class ChatHistoryResponse(BaseModel):
    session_id: str
    messages: list[ChatHistoryMessage] = Field(default_factory=list)
    total: int = 0


class SourceChunk(BaseModel):
    """A retrieved source chunk returned alongside the answer."""

    content: str
    filename: str
    page_number: int = 0
    chunk_index: int = 0
    relevance_score: float = 0.0
    document_type: str = ""
    metadata: dict[str, Any] = Field(default_factory=dict)


class QueryRequest(BaseModel):
    """Incoming chat query."""

    question: str = Field(..., min_length=1, max_length=10000)
    session_id: str | None = None
    conversation_history: list[ChatMessage] = Field(default_factory=list)
    top_k: int | None = None
    use_reranking: bool | None = None

    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "question": "What are the key findings in the report?",
                    "session_id": "abc-123",
                }
            ]
        }
    }


class QueryResponse(BaseModel):
    """Response to a chat query."""

    answer: str
    sources: list[SourceChunk] = Field(default_factory=list)
    query_type: QueryType = QueryType.GENERAL
    confidence: float = 0.0
    response_time_seconds: float = 0.0
    metadata: dict[str, Any] = Field(default_factory=dict)


class StreamToken(BaseModel):
    """Single token in a streaming response (sent via WebSocket)."""

    type: str = Field(
        ...,
        pattern="^(token|sources|done|error)$",
        description="Message type: token (text delta), sources, done, error",
    )
    content: str = ""
    sources: list[SourceChunk] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)


# ── Collections ───────────────────────────────────────────────────────────


class CollectionInfo(BaseModel):
    collection_id: str
    name: str
    document_count: int = 0
    chunk_count: int = 0
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))


# ── Analytics ─────────────────────────────────────────────────────────────


class AnalyticsSummary(BaseModel):
    total_queries: int = 0
    total_documents: int = 0
    total_chunks: int = 0
    avg_response_time: float = 0.0
    avg_confidence: float = 0.0
    queries_today: int = 0
    cache_hits: int = 0
    cache_misses: int = 0
    cache_entries: int = 0
    llm_model_name: str = ""
    embedding_model: str = ""
    llm_usage_events: int = 0
    llm_input_tokens: int = 0
    llm_output_tokens: int = 0
    llm_total_tokens: int = 0
    llm_successful_events: int = 0
    llm_error_events: int = 0
    llm_fallbacks: int = 0
    llm_cache_hits: int = 0
    usage_avg_latency_ms: int = 0
    audit_events: int = 0
    last_activity_at: str | None = None


class AuditEventResponse(BaseModel):
    id: str | None = None
    workspace_id: str
    user_id: str | None = None
    action: str
    resource_type: str | None = None
    resource_id: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: str | None = None


class AuditEventListResponse(BaseModel):
    events: list[AuditEventResponse] = Field(default_factory=list)
    total: int = 0
    storage: str = "memory"


class EvaluationRunRequest(BaseModel):
    mode: Literal["retrieval", "extractive"] = "retrieval"
    top_k: int | None = Field(None, ge=1, le=20)
    fail_under_recall: float = Field(default=0.8, ge=0.0, le=1.0)
    fail_under_citation_precision: float = Field(default=0.8, ge=0.0, le=1.0)


class EvaluationCaseResponse(BaseModel):
    id: str
    question: str
    workspace_id: str
    mode: str
    answer: str
    sources: list[dict[str, Any]] = Field(default_factory=list)
    metrics: dict[str, Any] = Field(default_factory=dict)
    passed: bool


class EvaluationReportResponse(BaseModel):
    dataset: str
    mode: str
    generated_at: str
    duration_ms: float
    summary: dict[str, Any]
    gates: dict[str, Any]
    results: list[EvaluationCaseResponse] = Field(default_factory=list)


class SystemStatusResponse(BaseModel):
    service: str = "NexusRAG API"
    status: str = "healthy"
    version: str = "1.0.0"
    total_documents: int = 0
    total_chunks: int = 0
    api_key_configured: bool = False
    llm_model_name: str = ""
    embedding_model: str = ""
    cache: dict[str, Any] = Field(default_factory=dict)
    settings: dict[str, Any] = Field(default_factory=dict)
    capabilities: dict[str, bool] = Field(default_factory=dict)


# ── Settings ──────────────────────────────────────────────────────────────


class SettingsUpdateRequest(BaseModel):
    """Subset of settings the user can update at runtime."""

    llm_temperature: float | None = Field(None, ge=0.0, le=2.0)
    retrieval_top_k: int | None = Field(None, ge=1, le=100)
    enable_reranking: bool | None = None
    hybrid_search_alpha: float | None = Field(None, ge=0.0, le=1.0)
    context_window_messages: int | None = Field(None, ge=1, le=50)
    enable_semantic_chunking: bool | None = None
    enable_contextual_enrichment: bool | None = None


class SettingsResponse(BaseModel):
    llm_model_name: str
    llm_temperature: float
    retrieval_top_k: int
    enable_reranking: bool
    hybrid_search_alpha: float
    context_window_messages: int
    chunk_size: int
    chunk_overlap: int
    enable_semantic_chunking: bool
    enable_contextual_enrichment: bool
    embedding_model: str
