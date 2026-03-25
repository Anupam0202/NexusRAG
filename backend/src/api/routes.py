"""
REST API Routes
================

All endpoints are prefixed ``/api/v1`` (mounted in ``main.py``).

Endpoints:
  POST   /documents/upload     — upload & ingest a document
  GET    /documents             — list ingested documents
  DELETE /documents/{filename}  — remove a document
  POST   /chat                  — blocking RAG query
  POST   /chat/sessions/{sid}/clear — clear session memory
  GET    /settings              — current settings
  PATCH  /settings              — update settings
  GET    /analytics/summary     — basic analytics
  POST   /apikey                — set a user-provided API key
"""

from __future__ import annotations

import time
import uuid
from pathlib import Path
from typing import List

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, Field

from config.settings import Settings, get_settings
from src.api.dependencies import get_rag_chain, get_vector_store, verify_api_key
from src.api.models import (
    AnalyticsSummary,
    DocumentDeleteResponse,
    DocumentListResponse,
    DocumentMetadata,
    DocumentStatus,
    DocumentUploadResponse,
    QueryRequest,
    QueryResponse,
    SettingsResponse,
    SettingsUpdateRequest,
    SourceChunk,
)
from src.generation.chain import RAGChain
from src.ingestion.pipeline import IngestionPipeline
from src.retrieval.vector_store import VectorStoreManager
from src.utils.logger import get_logger
from src.utils.security import FileValidator

logger = get_logger(__name__)

router = APIRouter(tags=["rag"], dependencies=[Depends(verify_api_key)])


# ═══════════════════════════════════════════════════════════════════════════
#  DOCUMENTS
# ═══════════════════════════════════════════════════════════════════════════


@router.post("/documents/upload", response_model=DocumentUploadResponse)
async def upload_document(
    file: UploadFile = File(...),
    settings: Settings = Depends(get_settings),
    vs: VectorStoreManager = Depends(get_vector_store),
) -> DocumentUploadResponse:
    """Upload and ingest a single document."""
    if not file.filename:
        raise HTTPException(400, "Filename is required")

    content = await file.read()
    safe_name = FileValidator.sanitize_filename(file.filename)
    valid, msg = FileValidator.validate(safe_name, content, max_size_bytes=settings.max_upload_bytes)
    if not valid:
        raise HTTPException(400, msg)

    try:
        pipeline = IngestionPipeline(vector_store=vs, settings=settings)
        result = pipeline.ingest(file_uploads=[{"filename": safe_name, "content": content}])
    except Exception as exc:
        logger.error("upload_pipeline_error", file=safe_name, error=str(exc))
        err_msg = str(exc).lower()
        if any(kw in err_msg for kw in ("429", "quota", "resource_exhausted")):
            raise HTTPException(
                429,
                "API quota exceeded. Please wait a few minutes or provide a new API key in Settings."
            )
        raise HTTPException(500, f"Processing error: {str(exc)[:200]}")

    if not result.success:
        errors = "; ".join(e.get("error", "") for e in result.errors)
        raise HTTPException(422, f"Ingestion failed: {errors}")

    doc_meta = DocumentMetadata(
        document_id=str(uuid.uuid4())[:12],
        filename=safe_name,
        file_type=Path(safe_name).suffix.lower().lstrip("."),
        file_size_bytes=len(content),
        chunk_count=result.chunks_created,
        status=DocumentStatus.READY,
        processing_time_seconds=result.processing_time_seconds,
        extraction_method="pipeline",
    )

    return DocumentUploadResponse(
        success=True,
        message=f"{safe_name} ingested: {result.chunks_created} chunks",
        document=doc_meta,
    )


@router.get("/documents", response_model=DocumentListResponse)
async def list_documents(
    vs: VectorStoreManager = Depends(get_vector_store),
) -> DocumentListResponse:
    docs_raw = vs.list_documents()
    docs = [
        DocumentMetadata(
            document_id=d["filename"],
            filename=d["filename"],
            file_type=Path(d["filename"]).suffix.lower().lstrip("."),
            file_size_bytes=0,
            chunk_count=d["chunk_count"],
            status=DocumentStatus.READY,
        )
        for d in docs_raw
    ]
    return DocumentListResponse(documents=docs, total=len(docs))


@router.delete("/documents/{filename}", response_model=DocumentDeleteResponse)
async def delete_document(
    filename: str,
    vs: VectorStoreManager = Depends(get_vector_store),
) -> DocumentDeleteResponse:
    removed = vs.delete_by_filename(filename)
    if removed == 0:
        raise HTTPException(404, f"Document '{filename}' not found")
    return DocumentDeleteResponse(
        success=True, message=f"Removed {removed} chunks", document_id=filename
    )


# ═══════════════════════════════════════════════════════════════════════════
#  CHAT
# ═══════════════════════════════════════════════════════════════════════════


@router.post("/chat", response_model=QueryResponse)
async def chat(
    body: QueryRequest,
    chain: RAGChain = Depends(get_rag_chain),
) -> QueryResponse:
    """Blocking RAG query — returns full response."""
    history = [{"role": m.role, "content": m.content} for m in body.conversation_history]
    result = chain.query(
        body.question,
        session_id=body.session_id,
        conversation_history=history if history else None,
        top_k=body.top_k,
        use_reranking=body.use_reranking,
    )

    sources = [SourceChunk(**s) for s in result.get("sources", [])]
    return QueryResponse(
        answer=result["answer"],
        sources=sources,
        query_type=result.get("query_type", "general"),
        confidence=result.get("confidence", 0.0),
        response_time_seconds=result.get("response_time_seconds", 0.0),
        metadata=result.get("metadata", {}),
    )


@router.post("/chat/sessions/{session_id}/clear")
async def clear_session(
    session_id: str,
    chain: RAGChain = Depends(get_rag_chain),
) -> dict:
    chain.clear_session(session_id)
    return {"success": True, "message": f"Session {session_id} cleared"}


# ═══════════════════════════════════════════════════════════════════════════
#  SETTINGS
# ═══════════════════════════════════════════════════════════════════════════


@router.get("/settings", response_model=SettingsResponse)
async def get_current_settings(
    settings: Settings = Depends(get_settings),
) -> SettingsResponse:
    return SettingsResponse(
        llm_model_name=settings.llm_model_name,
        llm_temperature=settings.llm_temperature,
        retrieval_top_k=settings.retrieval_top_k,
        enable_reranking=settings.enable_reranking,
        hybrid_search_alpha=settings.hybrid_search_alpha,
        context_window_messages=settings.context_window_messages,
        chunk_size=settings.chunk_size,
        chunk_overlap=settings.chunk_overlap,
        enable_semantic_chunking=settings.enable_semantic_chunking,
        enable_contextual_enrichment=settings.enable_contextual_enrichment,
        embedding_model=settings.embedding_model,
    )


@router.patch("/settings", response_model=SettingsResponse)
async def update_settings(
    body: SettingsUpdateRequest,
    settings: Settings = Depends(get_settings),
    chain: RAGChain = Depends(get_rag_chain),
) -> SettingsResponse:
    """Update runtime-tunable settings."""
    if body.llm_temperature is not None:
        settings.llm_temperature = body.llm_temperature
        from src.generation.llm import get_llm_provider
        get_llm_provider().update_temperature(body.llm_temperature)

    if body.retrieval_top_k is not None:
        settings.retrieval_top_k = body.retrieval_top_k
    if body.enable_reranking is not None:
        settings.enable_reranking = body.enable_reranking
    if body.hybrid_search_alpha is not None:
        settings.hybrid_search_alpha = body.hybrid_search_alpha
    if body.context_window_messages is not None:
        settings.context_window_messages = body.context_window_messages

    return await get_current_settings(settings)


# ═══════════════════════════════════════════════════════════════════════════
#  API KEY  — user-provided key for when default quota is exhausted
# ═══════════════════════════════════════════════════════════════════════════


class ApiKeyRequest(BaseModel):
    api_key: str = Field(..., min_length=10, max_length=200)


@router.post("/apikey")
async def set_api_key(
    body: ApiKeyRequest,
    settings: Settings = Depends(get_settings),
) -> dict:
    """Let the user provide their own Google API key.

    When the default key's quota is exhausted, the frontend shows a
    popup asking for a key.  This endpoint validates and hot-swaps it.
    """
    import os

    new_key = body.api_key.strip()

    # Validate the key using a FREE metadata call (list_models doesn't
    # count toward the RPM quota, unlike generate_content).
    try:
        import google.generativeai as genai
        genai.configure(api_key=new_key)
        # list_models is free and proves the key is valid
        models = list(genai.list_models())
        if not models:
            raise HTTPException(400, "Invalid API key — no models accessible.")
    except HTTPException:
        raise  # re-raise our own validation errors
    except Exception as exc:
        err_msg = str(exc).lower()
        if "invalid" in err_msg or "api key" in err_msg or "401" in err_msg:
            raise HTTPException(400, "Invalid API key. Please check and try again.")
        if "quota" in err_msg or "429" in err_msg:
            raise HTTPException(400, "This API key has also exceeded its quota.")
        # Transient network error — accept the key anyway
        logger.warning("api_key_validation_warning", error=str(exc))

    # Hot-swap the key
    os.environ["GOOGLE_API_KEY"] = new_key
    settings.google_api_key = new_key

    # Reset the LLM provider singleton so it picks up the new key
    from src.generation.llm import get_llm_provider
    provider = get_llm_provider()
    provider._model = None  # Force re-init on next call
    provider._settings = settings
    # Rebuild the candidates list so all fallback models are available again
    fallbacks = [m.strip() for m in settings.llm_fallback_models.split(",") if m.strip()]
    candidates = [settings.llm_model_name] + fallbacks
    seen = set()
    provider._candidates = [x for x in candidates if not (x in seen or seen.add(x))]

    # Reset the OCR manager singletons so they use the new key
    try:
        import src.ingestion.ocr_manager as ocr_mgr
        ocr_mgr._gemini_instance = None
        ocr_mgr._cloud_instance = None
    except Exception:
        pass

    logger.info("api_key_swapped", key_prefix=new_key[:8] + "...")
    return {"success": True, "message": "API key updated successfully"}


# ═══════════════════════════════════════════════════════════════════════════
#  ANALYTICS
# ═══════════════════════════════════════════════════════════════════════════


@router.get("/analytics/summary", response_model=AnalyticsSummary)
async def analytics_summary(
    vs: VectorStoreManager = Depends(get_vector_store),
    chain: RAGChain = Depends(get_rag_chain),
) -> AnalyticsSummary:
    docs = vs.list_documents()
    cache = chain.cache_stats
    metrics = chain.query_metrics
    total_queries = max(
        metrics.get("total_queries", 0),
        cache.get("hits", 0) + cache.get("misses", 0),
    )
    return AnalyticsSummary(
        total_documents=len(docs),
        total_chunks=vs.total_chunks,
        total_queries=total_queries,
        avg_response_time=metrics.get("avg_response_time", 0.0),
        avg_confidence=metrics.get("avg_confidence", 0.0),
        queries_today=metrics.get("queries_today", 0),
    )