"""
Pydantic Models for API Request / Response
==========================================

Every model is strictly typed, has examples, and is serialization-ready.
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


# ── Enums ─────────────────────────────────────────────────────────────────


class DocumentStatus(str, Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    READY = "ready"
    ERROR = "error"


class QueryType(str, Enum):
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
    created_at: datetime = Field(default_factory=datetime.utcnow)
    processing_time_seconds: float = 0.0
    extraction_method: str = ""
    extra: Dict[str, Any] = Field(default_factory=dict)


class DocumentListResponse(BaseModel):
    documents: List[DocumentMetadata]
    total: int


class DocumentUploadResponse(BaseModel):
    success: bool
    message: str
    document: Optional[DocumentMetadata] = None


class DocumentDeleteResponse(BaseModel):
    success: bool
    message: str
    document_id: str


# ── Chat / Query ──────────────────────────────────────────────────────────


class ChatMessage(BaseModel):
    role: str = Field(..., pattern="^(user|assistant|system)$")
    content: str
    timestamp: Optional[str] = None


class SourceChunk(BaseModel):
    """A retrieved source chunk returned alongside the answer."""

    content: str
    filename: str
    page_number: int = 0
    chunk_index: int = 0
    relevance_score: float = 0.0
    document_type: str = ""
    metadata: Dict[str, Any] = Field(default_factory=dict)


class QueryRequest(BaseModel):
    """Incoming chat query."""

    question: str = Field(..., min_length=1, max_length=10000)
    session_id: Optional[str] = None
    conversation_history: List[ChatMessage] = Field(default_factory=list)
    top_k: Optional[int] = None
    use_reranking: Optional[bool] = None

    model_config = {"json_schema_extra": {"examples": [
        {
            "question": "What are the key findings in the report?",
            "session_id": "abc-123",
        }
    ]}}


class QueryResponse(BaseModel):
    """Response to a chat query."""

    answer: str
    sources: List[SourceChunk] = Field(default_factory=list)
    query_type: QueryType = QueryType.GENERAL
    confidence: float = 0.0
    response_time_seconds: float = 0.0
    metadata: Dict[str, Any] = Field(default_factory=dict)


class StreamToken(BaseModel):
    """Single token in a streaming response (sent via WebSocket)."""

    type: str = Field(
        ...,
        pattern="^(token|sources|done|error)$",
        description="Message type: token (text delta), sources, done, error",
    )
    content: str = ""
    sources: List[SourceChunk] = Field(default_factory=list)
    metadata: Dict[str, Any] = Field(default_factory=dict)


# ── Collections ───────────────────────────────────────────────────────────


class CollectionInfo(BaseModel):
    collection_id: str
    name: str
    document_count: int = 0
    chunk_count: int = 0
    created_at: datetime = Field(default_factory=datetime.utcnow)


# ── Analytics ─────────────────────────────────────────────────────────────


class AnalyticsSummary(BaseModel):
    total_queries: int = 0
    total_documents: int = 0
    total_chunks: int = 0
    avg_response_time: float = 0.0
    avg_confidence: float = 0.0
    queries_today: int = 0


# ── Settings ──────────────────────────────────────────────────────────────


class SettingsUpdateRequest(BaseModel):
    """Subset of settings the user can update at runtime."""

    llm_temperature: Optional[float] = Field(None, ge=0.0, le=2.0)
    retrieval_top_k: Optional[int] = Field(None, ge=1, le=100)
    enable_reranking: Optional[bool] = None
    hybrid_search_alpha: Optional[float] = Field(None, ge=0.0, le=1.0)
    context_window_messages: Optional[int] = Field(None, ge=1, le=50)


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