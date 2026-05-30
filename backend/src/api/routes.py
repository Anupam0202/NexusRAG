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

import asyncio
import io
import uuid
from pathlib import Path

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
    SystemStatusResponse,
)
from src.generation.chain import RAGChain
from src.ingestion.pipeline import IngestionPipeline
from src.retrieval.vector_store import VectorStoreManager
from src.utils.logger import get_logger
from src.utils.security import FileValidator

logger = get_logger(__name__)

router = APIRouter(tags=["rag"], dependencies=[Depends(verify_api_key)])


def _preflight_upload_limits(filename: str, content: bytes, settings: Settings) -> None:
    """Reject expensive uploads before processing can exhaust Render memory."""
    ext = Path(filename).suffix.lower()
    if ext == ".pdf":
        _preflight_pdf_limits(filename, content, settings)
    elif ext in {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tif", ".tiff"}:
        _preflight_image_limits(filename, content, settings)


def _preflight_pdf_limits(filename: str, content: bytes, settings: Settings) -> None:
    try:
        import fitz  # PyMuPDF
    except Exception as exc:
        logger.warning("pdf_preflight_unavailable", file=filename, error=str(exc))
        return

    try:
        with fitz.open("pdf", content) as doc:
            page_count = len(doc)
            if page_count > settings.max_pdf_pages:
                raise HTTPException(
                    status_code=413,
                    detail=(
                        f"PDF has {page_count} pages. This deployment accepts up to "
                        f"{settings.max_pdf_pages} pages per PDF. Split the document "
                        "or increase MAX_PDF_PAGES on a larger backend instance."
                    ),
                )

            sample_pages = min(page_count, 5)
            text_chars = 0
            for index in range(sample_pages):
                text_chars += len((doc[index].get_text("text") or "").strip())

            avg_chars = text_chars / max(sample_pages, 1)
            looks_scanned = avg_chars < 40
            if looks_scanned and page_count > settings.max_pdf_ocr_pages:
                raise HTTPException(
                    status_code=413,
                    detail=(
                        f"This looks like a scanned PDF with {page_count} pages. OCR is "
                        f"limited to {settings.max_pdf_ocr_pages} pages on this deployment "
                        "to keep the backend stable. Split the PDF or use a larger Render "
                        "instance for heavier OCR jobs."
                    ),
                )

            logger.info(
                "pdf_preflight_ok",
                file=filename,
                pages=page_count,
                sample_text_chars=text_chars,
                scanned=looks_scanned,
            )
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("pdf_preflight_failed", file=filename, error=str(exc))


def _preflight_image_limits(filename: str, content: bytes, settings: Settings) -> None:
    try:
        from PIL import Image

        with Image.open(io.BytesIO(content)) as image:
            width, height = image.size
    except Exception as exc:
        logger.warning("image_preflight_failed", file=filename, error=str(exc))
        return

    pixels = width * height
    if pixels > settings.max_image_pixels:
        megapixels = pixels / 1_000_000
        raise HTTPException(
            status_code=413,
            detail=(
                f"Image is {megapixels:.1f} megapixels. This deployment accepts images "
                f"up to {settings.max_image_megapixels} megapixels for OCR. Resize the "
                "image or increase MAX_IMAGE_MEGAPIXELS on a larger backend instance."
            ),
        )


def _metadata_from_ingestion(result) -> tuple[int, str]:
    candidates = [*result.source_docs, *result.chunks]
    page_count = 0
    extraction_method = "pipeline"
    for doc in candidates:
        meta = doc.metadata
        page_count = max(
            page_count,
            int(meta.get("page_count") or meta.get("total_pages") or meta.get("page_number") or 0),
        )
        if extraction_method == "pipeline" and meta.get("extraction_method"):
            extraction_method = str(meta["extraction_method"])
    return page_count, extraction_method


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
    valid, msg = FileValidator.validate(
        safe_name,
        content,
        max_size_bytes=settings.max_upload_bytes,
    )
    if not valid:
        raise HTTPException(400, msg)
    _preflight_upload_limits(safe_name, content, settings)

    try:
        pipeline = IngestionPipeline(vector_store=vs, settings=settings)
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            None,
            lambda: pipeline.ingest(file_uploads=[{"filename": safe_name, "content": content}]),
        )
    except Exception as exc:
        logger.error("upload_pipeline_error", file=safe_name, error=str(exc))
        err_msg = str(exc).lower()
        if any(kw in err_msg for kw in ("429", "quota", "resource_exhausted")):
            raise HTTPException(
                429,
                "API quota exceeded. Please wait a few minutes or provide a new API "
                "key in Settings.",
            )
        raise HTTPException(500, f"Processing error: {str(exc)[:200]}")

    if not result.success:
        errors = "; ".join(e.get("error", "") for e in result.errors)
        if result.chunks_created > 0:
            # Partial success — some content was extracted even if not everything
            logger.warning("upload_partial_success", file=safe_name, errors=errors)
        else:
            raise HTTPException(422, f"Ingestion failed: {errors}")

    page_count, extraction_method = _metadata_from_ingestion(result)
    doc_meta = DocumentMetadata(
        document_id=str(uuid.uuid4()),
        filename=safe_name,
        file_type=Path(safe_name).suffix.lower().lstrip("."),
        file_size_bytes=len(content),
        page_count=page_count,
        chunk_count=result.chunks_created,
        status=DocumentStatus.READY,
        processing_time_seconds=result.processing_time_seconds,
        extraction_method=extraction_method,
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
            file_type=d.get("file_type") or Path(d["filename"]).suffix.lower().lstrip("."),
            file_size_bytes=d.get("file_size_bytes", 0),
            page_count=d.get("page_count", 0),
            chunk_count=d["chunk_count"],
            status=DocumentStatus.READY,
            extraction_method=d.get("extraction_method", ""),
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
    if body.enable_semantic_chunking is not None:
        settings.enable_semantic_chunking = body.enable_semantic_chunking
    if body.enable_contextual_enrichment is not None:
        settings.enable_contextual_enrichment = body.enable_contextual_enrichment

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
        import google.genai as genai

        client = genai.Client(api_key=new_key)
        models = list(client.models.list())
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
) -> AnalyticsSummary:
    docs = vs.list_documents()
    settings_instance = get_settings()

    # Retrieve chain metrics only if chain is initialised (requires API key)
    cache: dict = {"hits": 0, "misses": 0, "entries": 0}
    metrics: dict = {
        "total_queries": 0,
        "avg_response_time": 0.0,
        "avg_confidence": 0.0,
        "queries_today": 0,
    }
    try:
        from src.api.dependencies import get_rag_chain as _get_chain

        chain = _get_chain()
        raw_cache = chain.cache_stats
        cache = {
            "hits": raw_cache.get("hits", 0),
            "misses": raw_cache.get("misses", 0),
            "entries": raw_cache.get("entries", 0),
        }
        metrics = chain.query_metrics
    except Exception:
        pass

    # Active model — use already-initialised provider name when available
    llm_model = settings_instance.llm_model_name
    try:
        from src.generation.llm import get_llm_provider

        provider = get_llm_provider()
        if provider._model_name:
            llm_model = provider._model_name
    except Exception:
        pass

    total_queries = max(
        metrics.get("total_queries", 0),
        cache["hits"] + cache["misses"],
    )
    return AnalyticsSummary(
        total_documents=len(docs),
        total_chunks=vs.total_chunks,
        total_queries=total_queries,
        avg_response_time=metrics.get("avg_response_time", 0.0),
        avg_confidence=metrics.get("avg_confidence", 0.0),
        queries_today=metrics.get("queries_today", 0),
        cache_hits=cache["hits"],
        cache_misses=cache["misses"],
        cache_entries=cache["entries"],
        llm_model_name=llm_model,
        embedding_model=settings_instance.embedding_model,
    )


@router.get("/status", response_model=SystemStatusResponse)
async def system_status(
    settings: Settings = Depends(get_settings),
    vs: VectorStoreManager = Depends(get_vector_store),
) -> SystemStatusResponse:
    """Operational status payload for dashboards and deployment smoke tests."""
    docs = vs.list_documents()
    cache: dict = {"hits": 0, "misses": 0, "entries": 0, "hit_rate": 0.0}
    try:
        from src.api.dependencies import get_rag_chain as _get_chain

        cache = _get_chain().cache_stats
    except Exception:
        pass

    return SystemStatusResponse(
        total_documents=len(docs),
        total_chunks=vs.total_chunks,
        api_key_configured=bool(settings.google_api_key),
        llm_model_name=settings.llm_model_name,
        embedding_model=settings.embedding_model,
        cache=cache,
        settings={
            "retrieval_top_k": settings.retrieval_top_k,
            "enable_reranking": settings.enable_reranking,
            "hybrid_search_alpha": settings.hybrid_search_alpha,
            "enable_semantic_chunking": settings.enable_semantic_chunking,
            "enable_contextual_enrichment": settings.enable_contextual_enrichment,
            "max_upload_size_mb": settings.max_upload_size_mb,
            "use_lightweight_embeddings": settings.use_lightweight_embeddings,
            "max_pdf_pages": settings.max_pdf_pages,
            "max_pdf_ocr_pages": settings.max_pdf_ocr_pages,
            "pdf_ocr_dpi": settings.pdf_ocr_dpi,
            "enable_pdf_embedded_image_ocr": settings.enable_pdf_embedded_image_ocr,
            "max_pdf_embedded_images": settings.max_pdf_embedded_images,
            "max_image_megapixels": settings.max_image_megapixels,
        },
        capabilities={
            "streaming": True,
            "hybrid_search": True,
            "semantic_cache": settings.enable_cache,
            "reranking": settings.enable_reranking,
            "semantic_chunking": settings.enable_semantic_chunking,
            "contextual_enrichment": settings.enable_contextual_enrichment,
            "ocr": bool(settings.google_api_key),
        },
    )
