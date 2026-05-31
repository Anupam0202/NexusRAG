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
import gc
import io
import uuid
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, Field

from config.settings import Settings, get_settings
from src.api.auth import WorkspaceContext, WorkspaceRole, require_enterprise_workspace_role
from src.api.dependencies import get_rag_chain, get_vector_store, verify_api_key
from src.api.models import (
    AnalyticsSummary,
    DocumentDeleteResponse,
    DocumentListResponse,
    DocumentMetadata,
    DocumentStatus,
    DocumentUploadResponse,
    IngestionJobStatusResponse,
    QueryRequest,
    QueryResponse,
    SettingsResponse,
    SettingsUpdateRequest,
    SourceChunk,
    SystemStatusResponse,
)
from src.generation.chain import RAGChain
from src.generation.provider_keys import (
    GEMINI_PROVIDER,
    get_provider_key_manager,
    normalize_provider,
)
from src.ingestion.job_manager import get_ingestion_job_store
from src.ingestion.pipeline import IngestionPipeline
from src.repositories.settings import WorkspaceSettingsRepository
from src.retrieval.vector_store import VectorStoreManager
from src.telemetry.events import estimate_tokens, get_telemetry_recorder
from src.utils.logger import get_logger
from src.utils.security import FileValidator
from src.utils.tenant import normalize_workspace_id

logger = get_logger(__name__)

router = APIRouter(tags=["rag"], dependencies=[Depends(verify_api_key)])

VIEWER_ROLES = (
    WorkspaceRole.OWNER,
    WorkspaceRole.ADMIN,
    WorkspaceRole.EDITOR,
    WorkspaceRole.VIEWER,
)
EDITOR_ROLES = (WorkspaceRole.OWNER, WorkspaceRole.ADMIN, WorkspaceRole.EDITOR)
ADMIN_ROLES = (WorkspaceRole.OWNER, WorkspaceRole.ADMIN)


def _context_workspace_id(context: WorkspaceContext | None) -> str:
    return normalize_workspace_id(context.workspace_id if context else None)


def _context_user_id(context: WorkspaceContext | None) -> str | None:
    return context.user.id if context else None


def _should_persist_workspace_event(
    context: WorkspaceContext | None,
    settings: Settings,
) -> bool:
    return bool(
        context
        and not context.user.is_demo
        and settings.supabase_configured
    )


async def _record_audit_event(
    *,
    workspace: WorkspaceContext | None,
    settings: Settings,
    action: str,
    resource_type: str | None = None,
    resource_id: str | None = None,
    metadata: dict | None = None,
) -> None:
    await get_telemetry_recorder().record_audit_event(
        workspace_id=_context_workspace_id(workspace),
        user_id=_context_user_id(workspace),
        action=action,
        resource_type=resource_type,
        resource_id=resource_id,
        metadata=metadata,
        persist=_should_persist_workspace_event(workspace, settings),
    )


def _settings_payload(settings: Settings) -> dict:
    return {
        "llm_model_name": settings.llm_model_name,
        "llm_temperature": settings.llm_temperature,
        "retrieval_top_k": settings.retrieval_top_k,
        "enable_reranking": settings.enable_reranking,
        "hybrid_search_alpha": settings.hybrid_search_alpha,
        "context_window_messages": settings.context_window_messages,
        "chunk_size": settings.chunk_size,
        "chunk_overlap": settings.chunk_overlap,
        "enable_semantic_chunking": settings.enable_semantic_chunking,
        "enable_contextual_enrichment": settings.enable_contextual_enrichment,
        "embedding_model": settings.embedding_model,
    }


def _merge_workspace_settings(payload: dict, row: dict | None) -> dict:
    if not row:
        return payload
    mapping = {
        "default_model": "llm_model_name",
        "llm_temperature": "llm_temperature",
        "retrieval_top_k": "retrieval_top_k",
        "enable_reranking": "enable_reranking",
        "hybrid_search_alpha": "hybrid_search_alpha",
        "context_window_messages": "context_window_messages",
        "chunk_size": "chunk_size",
        "chunk_overlap": "chunk_overlap",
        "enable_semantic_chunking": "enable_semantic_chunking",
        "enable_contextual_enrichment": "enable_contextual_enrichment",
        "embedding_model": "embedding_model",
    }
    merged = dict(payload)
    for source, target in mapping.items():
        if row.get(source) is not None:
            merged[target] = row[source]
    return merged


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


def _process_upload_job(
    *,
    job_id: str,
    workspace_id: str,
    document_id: str,
    safe_name: str,
    content: bytes,
    settings: Settings,
    vs: VectorStoreManager,
    chain: RAGChain,
) -> DocumentMetadata:
    job_store = get_ingestion_job_store()

    def report(stage: str, pct: float) -> None:
        job_store.mark_processing(job_id, stage=stage, progress=int(pct * 100))

    try:
        pipeline = IngestionPipeline(vector_store=vs, settings=settings, progress_callback=report)
        result = pipeline.ingest(
            file_uploads=[{"filename": safe_name, "content": content}],
            workspace_id=workspace_id,
            document_id=document_id,
        )
    except Exception as exc:
        logger.error("upload_pipeline_error", file=safe_name, error=str(exc))
        job_store.mark_failed(job_id, stage="processing_error", error_message=str(exc)[:500])
        raise

    if not result.success:
        errors = "; ".join(e.get("error", "") for e in result.errors)
        if result.chunks_created > 0:
            logger.warning("upload_partial_success", file=safe_name, errors=errors)
        else:
            job_store.mark_failed(job_id, stage="ingestion_failed", error_message=errors[:500])
            raise ValueError(f"Ingestion failed: {errors}")

    page_count, extraction_method = _metadata_from_ingestion(result)
    doc_meta = DocumentMetadata(
        document_id=document_id,
        filename=safe_name,
        file_type=Path(safe_name).suffix.lower().lstrip("."),
        file_size_bytes=len(content),
        page_count=page_count,
        chunk_count=result.chunks_created,
        status=DocumentStatus.READY,
        processing_time_seconds=result.processing_time_seconds,
        extraction_method=extraction_method,
        extra={"workspace_id": workspace_id},
    )
    chain.clear_cache(workspace_id=workspace_id)
    job_store.mark_completed(
        job_id,
        document=doc_meta,
        message=f"{safe_name} ingested: {result.chunks_created} chunks",
    )
    del result
    gc.collect()
    return doc_meta


def _process_upload_job_background(**kwargs) -> None:
    try:
        _process_upload_job(**kwargs)
    except Exception as exc:
        logger.warning(
            "upload_background_job_failed",
            job_id=kwargs.get("job_id"),
            file=kwargs.get("safe_name"),
            error=str(exc),
        )


# ═══════════════════════════════════════════════════════════════════════════
#  DOCUMENTS
# ═══════════════════════════════════════════════════════════════════════════


@router.post("/documents/upload", response_model=DocumentUploadResponse)
async def upload_document(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    workspace: WorkspaceContext | None = Depends(
        require_enterprise_workspace_role(*EDITOR_ROLES)
    ),
    settings: Settings = Depends(get_settings),
    vs: VectorStoreManager = Depends(get_vector_store),
    chain: RAGChain = Depends(get_rag_chain),
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

    workspace_id = _context_workspace_id(workspace)
    document_id = str(uuid.uuid4())
    job_store = get_ingestion_job_store()
    job = job_store.create(
        document_id=document_id,
        filename=safe_name,
        workspace_id=workspace_id,
    )

    if settings.enable_async_ingestion:
        pending_doc = DocumentMetadata(
            document_id=document_id,
            filename=safe_name,
            file_type=Path(safe_name).suffix.lower().lstrip("."),
            file_size_bytes=len(content),
            status=DocumentStatus.PENDING,
            extra={"job_id": job.job_id, "workspace_id": workspace_id},
        )
        background_tasks.add_task(
            _process_upload_job_background,
            job_id=job.job_id,
            workspace_id=workspace_id,
            document_id=document_id,
            safe_name=safe_name,
            content=content,
            settings=settings,
            vs=vs,
            chain=chain,
        )
        await _record_audit_event(
            workspace=workspace,
            settings=settings,
            action="document.upload_queued",
            resource_type="document",
            resource_id=document_id,
            metadata={
                "filename": safe_name,
                "file_size_bytes": len(content),
                "job_id": job.job_id,
            },
        )
        return DocumentUploadResponse(
            success=True,
            message=f"{safe_name} queued for ingestion",
            document=pending_doc,
            job_id=job.job_id,
            job=job.response(),
        )

    try:
        loop = asyncio.get_event_loop()
        doc_meta = await loop.run_in_executor(
            None,
            lambda: _process_upload_job(
                job_id=job.job_id,
                workspace_id=workspace_id,
                document_id=document_id,
                safe_name=safe_name,
                content=content,
                settings=settings,
                vs=vs,
                chain=chain,
            ),
        )
    except Exception as exc:
        await _record_audit_event(
            workspace=workspace,
            settings=settings,
            action="document.upload_failed",
            resource_type="document",
            resource_id=document_id,
            metadata={
                "filename": safe_name,
                "file_size_bytes": len(content),
                "job_id": job.job_id,
                "error": str(exc)[:200],
            },
        )
        err_msg = str(exc).lower()
        if any(kw in err_msg for kw in ("429", "quota", "resource_exhausted")):
            raise HTTPException(
                429,
                "API quota exceeded. Please wait a few minutes or provide a new API "
                "key in Settings.",
            )
        if "ingestion failed:" in err_msg:
            raise HTTPException(422, str(exc))
        raise HTTPException(500, f"Processing error: {str(exc)[:200]}")

    chunks_created = doc_meta.chunk_count
    await _record_audit_event(
        workspace=workspace,
        settings=settings,
        action="document.uploaded",
        resource_type="document",
        resource_id=document_id,
        metadata={
            "filename": safe_name,
            "file_size_bytes": doc_meta.file_size_bytes,
            "chunk_count": doc_meta.chunk_count,
            "page_count": doc_meta.page_count,
            "job_id": job.job_id,
            "extraction_method": doc_meta.extraction_method,
        },
    )
    content = b""
    gc.collect()

    return DocumentUploadResponse(
        success=True,
        message=f"{safe_name} ingested: {chunks_created} chunks",
        document=doc_meta,
        job_id=job.job_id,
        job=job.response(),
    )


@router.get("/documents", response_model=DocumentListResponse)
async def list_documents(
    workspace: WorkspaceContext | None = Depends(
        require_enterprise_workspace_role(*VIEWER_ROLES)
    ),
    vs: VectorStoreManager = Depends(get_vector_store),
) -> DocumentListResponse:
    workspace_id = _context_workspace_id(workspace)
    docs_raw = vs.list_documents(workspace_id=workspace_id)
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
            extra={"workspace_id": workspace_id},
        )
        for d in docs_raw
    ]
    return DocumentListResponse(documents=docs, total=len(docs))


@router.get("/documents/jobs/{job_id}", response_model=IngestionJobStatusResponse)
async def get_ingestion_job_status(
    job_id: str,
    workspace: WorkspaceContext | None = Depends(
        require_enterprise_workspace_role(*VIEWER_ROLES)
    ),
) -> IngestionJobStatusResponse:
    workspace_id = _context_workspace_id(workspace)
    job = get_ingestion_job_store().get(job_id)
    if not job or job.workspace_id != workspace_id:
        raise HTTPException(404, f"Ingestion job '{job_id}' not found")
    return job.response()


@router.get("/documents/{document_id}/status", response_model=IngestionJobStatusResponse)
async def get_document_ingestion_status(
    document_id: str,
    workspace: WorkspaceContext | None = Depends(
        require_enterprise_workspace_role(*VIEWER_ROLES)
    ),
) -> IngestionJobStatusResponse:
    workspace_id = _context_workspace_id(workspace)
    job = get_ingestion_job_store().get_by_document_id(document_id)
    if not job or job.workspace_id != workspace_id:
        raise HTTPException(404, f"Ingestion status for document '{document_id}' not found")
    return job.response()


@router.delete("/documents/{filename}", response_model=DocumentDeleteResponse)
async def delete_document(
    filename: str,
    workspace: WorkspaceContext | None = Depends(
        require_enterprise_workspace_role(*EDITOR_ROLES)
    ),
    settings: Settings = Depends(get_settings),
    vs: VectorStoreManager = Depends(get_vector_store),
    chain: RAGChain = Depends(get_rag_chain),
) -> DocumentDeleteResponse:
    workspace_id = _context_workspace_id(workspace)
    removed = vs.delete_by_filename(filename, workspace_id=workspace_id)
    if removed == 0:
        raise HTTPException(404, f"Document '{filename}' not found")
    chain.clear_cache(workspace_id=workspace_id)
    await _record_audit_event(
        workspace=workspace,
        settings=settings,
        action="document.deleted",
        resource_type="document",
        resource_id=filename,
        metadata={"filename": filename, "chunks_removed": removed},
    )
    return DocumentDeleteResponse(
        success=True, message=f"Removed {removed} chunks", document_id=filename
    )


# ═══════════════════════════════════════════════════════════════════════════
#  CHAT
# ═══════════════════════════════════════════════════════════════════════════


@router.post("/chat", response_model=QueryResponse)
async def chat(
    body: QueryRequest,
    workspace: WorkspaceContext | None = Depends(
        require_enterprise_workspace_role(*VIEWER_ROLES)
    ),
    settings: Settings = Depends(get_settings),
    chain: RAGChain = Depends(get_rag_chain),
) -> QueryResponse:
    """Blocking RAG query — returns full response."""
    history = [{"role": m.role, "content": m.content} for m in body.conversation_history]
    workspace_id = _context_workspace_id(workspace)
    history_token_parts = [m.content for m in body.conversation_history]
    telemetry = get_telemetry_recorder()
    persist_event = _should_persist_workspace_event(workspace, settings)

    try:
        result = chain.query(
            body.question,
            workspace_id=workspace_id,
            session_id=body.session_id,
            conversation_history=history if history else None,
            top_k=body.top_k,
            use_reranking=body.use_reranking,
        )
    except Exception as exc:
        await telemetry.record_llm_usage(
            workspace_id=workspace_id,
            user_id=_context_user_id(workspace),
            model=settings.llm_model_name,
            operation="chat.query",
            input_tokens=estimate_tokens(body.question, *history_token_parts),
            output_tokens=0,
            latency_ms=0,
            success=False,
            error_code=type(exc).__name__,
            persist=persist_event,
        )
        await _record_audit_event(
            workspace=workspace,
            settings=settings,
            action="chat.query_failed",
            resource_type="chat_session",
            resource_id=body.session_id,
            metadata={
                "question_chars": len(body.question),
                "history_messages": len(body.conversation_history),
                "top_k": body.top_k,
                "use_reranking": body.use_reranking,
                "error": str(exc)[:200],
            },
        )
        raise

    sources = [SourceChunk(**s) for s in result.get("sources", [])]
    metadata = dict(result.get("metadata", {}) or {})
    cache_hit = bool(result.get("from_cache") or metadata.get("from_cache"))
    generation_fallback = bool(metadata.get("generation_fallback"))
    metadata["from_cache"] = cache_hit
    answer = result["answer"]
    latency_ms = int(float(result.get("response_time_seconds", 0.0) or 0.0) * 1000)

    await telemetry.record_llm_usage(
        workspace_id=workspace_id,
        user_id=_context_user_id(workspace),
        model=str(metadata.get("model") or settings.llm_model_name),
        operation="chat.query",
        input_tokens=0 if cache_hit else estimate_tokens(body.question, *history_token_parts),
        output_tokens=0 if cache_hit else estimate_tokens(answer),
        latency_ms=latency_ms,
        success=True,
        error_code=(
            "cache_hit" if cache_hit else "generation_fallback" if generation_fallback else None
        ),
        persist=persist_event,
    )
    await _record_audit_event(
        workspace=workspace,
        settings=settings,
        action="chat.query",
        resource_type="chat_session",
        resource_id=body.session_id,
        metadata={
            "question_chars": len(body.question),
            "history_messages": len(body.conversation_history),
            "top_k": body.top_k,
            "use_reranking": body.use_reranking,
            "query_type": result.get("query_type", "general"),
            "source_count": len(sources),
            "cache_hit": cache_hit,
            "generation_fallback": generation_fallback,
            "latency_ms": latency_ms,
        },
    )
    return QueryResponse(
        answer=answer,
        sources=sources,
        query_type=result.get("query_type", "general"),
        confidence=result.get("confidence", 0.0),
        response_time_seconds=result.get("response_time_seconds", 0.0),
        metadata=metadata,
    )


@router.post("/chat/sessions/{session_id}/clear")
async def clear_session(
    session_id: str,
    workspace: WorkspaceContext | None = Depends(
        require_enterprise_workspace_role(*VIEWER_ROLES)
    ),
    settings: Settings = Depends(get_settings),
    chain: RAGChain = Depends(get_rag_chain),
) -> dict:
    workspace_id = _context_workspace_id(workspace)
    chain.clear_session(session_id, workspace_id=workspace_id)
    await _record_audit_event(
        workspace=workspace,
        settings=settings,
        action="chat.session_cleared",
        resource_type="chat_session",
        resource_id=session_id,
        metadata={},
    )
    return {"success": True, "message": f"Session {session_id} cleared"}


# ═══════════════════════════════════════════════════════════════════════════
#  SETTINGS
# ═══════════════════════════════════════════════════════════════════════════


@router.get("/settings", response_model=SettingsResponse)
async def get_current_settings(
    workspace: WorkspaceContext | None = Depends(
        require_enterprise_workspace_role(*VIEWER_ROLES)
    ),
    settings: Settings = Depends(get_settings),
) -> SettingsResponse:
    payload = _settings_payload(settings)
    if _should_persist_workspace_event(workspace, settings):
        try:
            row = await WorkspaceSettingsRepository().get_settings(
                workspace_id=_context_workspace_id(workspace)
            )
            payload = _merge_workspace_settings(payload, row)
        except Exception as exc:
            logger.warning(
                "workspace_settings_read_failed",
                workspace_id=_context_workspace_id(workspace),
                error=str(exc)[:300],
            )
    return SettingsResponse(**payload)


@router.patch("/settings", response_model=SettingsResponse)
async def update_settings(
    body: SettingsUpdateRequest,
    workspace: WorkspaceContext | None = Depends(
        require_enterprise_workspace_role(*ADMIN_ROLES)
    ),
    settings: Settings = Depends(get_settings),
    chain: RAGChain = Depends(get_rag_chain),
) -> SettingsResponse:
    """Update runtime-tunable settings."""
    changed = body.model_dump(exclude_none=True)
    if settings.memory_constrained:
        constrained_features = {
            "Re-ranking": body.enable_reranking,
            "Semantic chunking": body.enable_semantic_chunking,
            "Contextual enrichment": body.enable_contextual_enrichment,
        }
        requested = [name for name, enabled in constrained_features.items() if enabled is True]
        if requested:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"{', '.join(requested)} disabled on this constrained Render "
                    "deployment. Use a larger backend instance before enabling "
                    "memory-heavy retrieval features."
                ),
            )

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

    workspace_id = _context_workspace_id(workspace)
    chain.clear_cache(workspace_id=workspace_id)

    if changed and _should_persist_workspace_event(workspace, settings):
        try:
            await WorkspaceSettingsRepository().upsert_settings(
                workspace_id=workspace_id,
                values=changed,
            )
        except Exception as exc:
            legacy_fields = {
                key: value
                for key, value in changed.items()
                if key
                in {
                    "llm_temperature",
                    "retrieval_top_k",
                    "enable_reranking",
                    "hybrid_search_alpha",
                    "enable_contextual_enrichment",
                }
            }
            if legacy_fields and legacy_fields != changed:
                try:
                    await WorkspaceSettingsRepository().upsert_settings(
                        workspace_id=workspace_id,
                        values=legacy_fields,
                    )
                except Exception as fallback_exc:
                    logger.warning(
                        "workspace_settings_persist_failed",
                        workspace_id=workspace_id,
                        error=str(fallback_exc)[:300],
                    )
            else:
                logger.warning(
                    "workspace_settings_persist_failed",
                    workspace_id=workspace_id,
                    error=str(exc)[:300],
                )

    if changed:
        await _record_audit_event(
            workspace=workspace,
            settings=settings,
            action="settings.updated",
            resource_type="workspace_settings",
            resource_id=workspace_id,
            metadata={
                "changed_fields": sorted(changed.keys()),
                "values": changed,
            },
        )
    return await get_current_settings(workspace=workspace, settings=settings)


# ═══════════════════════════════════════════════════════════════════════════
#  API KEY  — user-provided key for when default quota is exhausted
# ═══════════════════════════════════════════════════════════════════════════


class ApiKeyRequest(BaseModel):
    api_key: str = Field(..., min_length=10, max_length=200)
    provider: str = Field(default=GEMINI_PROVIDER, min_length=2, max_length=32)


def _raise_api_key_validation_error(exc: Exception) -> None:
    err_msg = str(exc).lower()
    if any(term in err_msg for term in ("invalid", "api key", "401", "403")):
        raise HTTPException(400, "Invalid API key. Please check and try again.")
    if any(term in err_msg for term in ("quota", "429", "resource exhausted")):
        raise HTTPException(400, "This API key has also exceeded its quota.")
    logger.warning("api_key_validation_warning", error=str(exc)[:300])


def _validate_provider_api_key(provider: str, api_key: str) -> None:
    normalized_provider = normalize_provider(provider)
    if normalized_provider != GEMINI_PROVIDER:
        raise HTTPException(400, f"Provider '{provider}' is not supported yet.")

    try:
        import google.genai as genai

        client = genai.Client(api_key=api_key)
        models = list(client.models.list())
        if not models:
            raise HTTPException(400, "Invalid API key - no models accessible.")
        return
    except ImportError:
        pass
    except HTTPException:
        raise
    except Exception as exc:
        _raise_api_key_validation_error(exc)
        return

    try:
        import google.generativeai as legacy_genai

        legacy_genai.configure(api_key=api_key)
        models = list(legacy_genai.list_models())
        if not models:
            raise HTTPException(400, "Invalid API key - no models accessible.")
    except ImportError:
        logger.warning("api_key_validation_library_unavailable", provider=normalized_provider)
    except HTTPException:
        raise
    except Exception as exc:
        _raise_api_key_validation_error(exc)


@router.post("/apikey")
async def set_api_key(
    body: ApiKeyRequest,
    workspace: WorkspaceContext | None = Depends(
        require_enterprise_workspace_role(*ADMIN_ROLES)
    ),
    settings: Settings = Depends(get_settings),
) -> dict:
    """Validate and store a workspace-scoped provider key without global mutation."""
    new_key = body.api_key.strip()
    normalized_provider = normalize_provider(body.provider)
    _validate_provider_api_key(normalized_provider, new_key)

    workspace_id = _context_workspace_id(workspace)
    user_id = workspace.user.id if workspace else None
    manager = get_provider_key_manager()
    record = manager.store_key(
        workspace_id=workspace_id,
        user_id=user_id,
        provider=normalized_provider,
        api_key=new_key,
    )

    storage = "memory"
    try:
        if workspace and not workspace.user.is_demo and settings.supabase_configured:
            await manager.persist_key(record)
            storage = "supabase"
    except Exception as exc:
        logger.warning(
            "api_key_persist_failed",
            workspace_id=workspace_id,
            provider=normalized_provider,
            error=str(exc)[:300],
        )

    logger.info(
        "workspace_provider_key_activated",
        workspace_id=workspace_id,
        provider=normalized_provider,
    )
    await _record_audit_event(
        workspace=workspace,
        settings=settings,
        action="provider_key.activated",
        resource_type="api_key",
        resource_id=record.key_label,
        metadata={
            "provider": normalized_provider,
            "key_fingerprint": record.key_label,
            "storage": storage,
            "server_key_configured": bool(settings.google_api_key),
        },
    )
    return {
        "success": True,
        "message": "API key activated for this workspace.",
        "provider": normalized_provider,
        "workspace_id": workspace_id,
        "workspace_key_configured": True,
        "server_key_configured": bool(settings.google_api_key),
        "key_fingerprint": record.key_label,
        "storage": storage,
    }


@router.get("/apikey")
async def get_api_key_status(
    workspace: WorkspaceContext | None = Depends(
        require_enterprise_workspace_role(*ADMIN_ROLES)
    ),
    settings: Settings = Depends(get_settings),
) -> dict:
    workspace_id = _context_workspace_id(workspace)
    return get_provider_key_manager().status_payload(
        workspace_id=workspace_id,
        provider=GEMINI_PROVIDER,
        settings=settings,
    )


#  ANALYTICS
# ═══════════════════════════════════════════════════════════════════════════


@router.get("/analytics/summary", response_model=AnalyticsSummary)
async def analytics_summary(
    workspace: WorkspaceContext | None = Depends(
        require_enterprise_workspace_role(*VIEWER_ROLES)
    ),
    vs: VectorStoreManager = Depends(get_vector_store),
) -> AnalyticsSummary:
    workspace_id = _context_workspace_id(workspace)
    docs = vs.list_documents(workspace_id=workspace_id)
    settings_instance = get_settings()
    telemetry_summary = await get_telemetry_recorder().analytics_summary(
        workspace_id=workspace_id,
        persist=_should_persist_workspace_event(workspace, settings_instance),
    )

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
        telemetry_summary.get("llm_usage_events", 0),
    )
    avg_response_time = metrics.get("avg_response_time", 0.0)
    if not avg_response_time and telemetry_summary.get("usage_avg_latency_ms", 0):
        avg_response_time = round(telemetry_summary["usage_avg_latency_ms"] / 1000, 3)
    return AnalyticsSummary(
        total_documents=len(docs),
        total_chunks=vs.count_chunks(workspace_id=workspace_id),
        total_queries=total_queries,
        avg_response_time=avg_response_time,
        avg_confidence=metrics.get("avg_confidence", 0.0),
        queries_today=max(
            metrics.get("queries_today", 0),
            telemetry_summary.get("usage_queries_today", 0),
        ),
        cache_hits=cache["hits"],
        cache_misses=cache["misses"],
        cache_entries=cache["entries"],
        llm_model_name=llm_model,
        embedding_model=settings_instance.embedding_model,
        llm_usage_events=telemetry_summary.get("llm_usage_events", 0),
        llm_input_tokens=telemetry_summary.get("llm_input_tokens", 0),
        llm_output_tokens=telemetry_summary.get("llm_output_tokens", 0),
        llm_total_tokens=telemetry_summary.get("llm_total_tokens", 0),
        llm_successful_events=telemetry_summary.get("llm_successful_events", 0),
        llm_error_events=telemetry_summary.get("llm_error_events", 0),
        llm_fallbacks=telemetry_summary.get("llm_fallbacks", 0),
        llm_cache_hits=telemetry_summary.get("llm_cache_hits", 0),
        usage_avg_latency_ms=telemetry_summary.get("usage_avg_latency_ms", 0),
        audit_events=telemetry_summary.get("audit_events", 0),
        last_activity_at=telemetry_summary.get("last_activity_at"),
    )


@router.get("/status", response_model=SystemStatusResponse)
async def system_status(
    settings: Settings = Depends(get_settings),
    vs: VectorStoreManager = Depends(get_vector_store),
) -> SystemStatusResponse:
    """Operational status payload for dashboards and deployment smoke tests."""
    workspace_id = normalize_workspace_id(None)
    docs = vs.list_documents(workspace_id=workspace_id)
    cache: dict = {"hits": 0, "misses": 0, "entries": 0, "hit_rate": 0.0}
    try:
        from src.api.dependencies import get_rag_chain as _get_chain

        cache = _get_chain().cache_stats
    except Exception:
        pass

    return SystemStatusResponse(
        total_documents=len(docs),
        total_chunks=vs.count_chunks(workspace_id=workspace_id),
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
            "enable_query_expansion": (
                settings.enable_query_expansion and not settings.memory_constrained
            ),
            "memory_constrained": settings.memory_constrained,
            "max_upload_size_mb": settings.max_upload_size_mb,
            "use_lightweight_embeddings": settings.use_lightweight_embeddings,
            "max_pdf_pages": settings.max_pdf_pages,
            "max_pdf_ocr_pages": settings.max_pdf_ocr_pages,
            "pdf_ocr_dpi": settings.pdf_ocr_dpi,
            "enable_pdf_embedded_image_ocr": settings.enable_pdf_embedded_image_ocr,
            "enable_docx_embedded_image_ocr": settings.enable_docx_embedded_image_ocr,
            "max_pdf_embedded_images": settings.max_pdf_embedded_images,
            "max_docx_embedded_images": settings.max_docx_embedded_images,
            "max_image_megapixels": settings.max_image_megapixels,
            "supabase_configured": settings.supabase_configured,
            "supabase_auth_configured": settings.supabase_auth_configured,
            "auth_required": settings.auth_required,
            "anonymous_demo_enabled": settings.enable_anonymous_demo,
            "qdrant_configured": settings.qdrant_configured,
            "enable_qdrant": settings.enable_qdrant,
            "enable_pgvector_fallback": settings.enable_pgvector_fallback,
            "enable_local_faiss": settings.enable_local_faiss,
            "enable_async_ingestion": settings.enable_async_ingestion,
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
