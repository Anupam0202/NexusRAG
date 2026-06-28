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
import re
import tempfile
import time
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, cast

import httpx
from fastapi import (
    APIRouter,
    BackgroundTasks,
    Body,
    Depends,
    File,
    HTTPException,
    Query,
    UploadFile,
)
from langchain_core.documents import Document
from pydantic import BaseModel, Field

from config.settings import Settings, get_settings
from evals.run_eval import DEFAULT_DATASET, run_evaluation
from src.api.auth import WorkspaceContext, WorkspaceRole, require_enterprise_workspace_role
from src.api.dependencies import get_rag_chain, get_vector_store, verify_api_key
from src.api.models import (
    AnalyticsSummary,
    AuditEventListResponse,
    AuditEventResponse,
    BillingUsageResponse,
    ChatHistoryMessage,
    ChatHistoryResponse,
    DocumentChunkListResponse,
    DocumentChunkPreview,
    DocumentDeleteResponse,
    DocumentListResponse,
    DocumentMetadata,
    DocumentStatus,
    DocumentUploadResponse,
    EvaluationCaseResponse,
    EvaluationReportResponse,
    EvaluationRunRequest,
    IngestionJobStatus,
    IngestionJobStatusResponse,
    PrivacySettingsResponse,
    PrivacySettingsUpdateRequest,
    QueryRequest,
    QueryResponse,
    SettingsResponse,
    SettingsUpdateRequest,
    SourceChunk,
    SystemStatusResponse,
    WorkspaceDeleteRequest,
    WorkspaceLifecycleResponse,
)
from src.generation.chain import RAGChain
from src.generation.provider_keys import (
    GEMINI_PROVIDER,
    get_provider_key_manager,
    normalize_provider,
)
from src.infrastructure.supabase_client import (
    SupabaseClient,
    SupabaseNotConfiguredError,
    get_supabase_client,
)
from src.ingestion.embedder import get_embedder
from src.ingestion.job_manager import get_ingestion_job_store
from src.ingestion.pipeline import IngestionPipeline
from src.repositories.billing import BillingRepository
from src.repositories.chunks import ChunkRepository
from src.repositories.documents import (
    DocumentRepository,
    compute_sha256,
)
from src.repositories.jobs import IngestionJobRepository
from src.repositories.messages import MessageRepository
from src.repositories.provider_health import persist_provider_health_snapshot
from src.repositories.settings import WorkspaceSettingsRepository
from src.retrieval.vector_store import VectorStoreManager
from src.telemetry.events import estimate_tokens, get_telemetry_recorder
from src.tenancy.lifecycle import WorkspaceLifecycleService
from src.tenancy.quotas import QuotaExceededError, TenantQuotaEnforcer
from src.utils.layered_cache import get_layered_cache
from src.utils.logger import get_logger
from src.utils.security import FileValidator
from src.utils.tenant import normalize_workspace_id
from src.vectorstores import QdrantVectorStore, VectorChunk

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


async def _probe_supabase_data_api(
    *,
    settings: Settings,
    supabase: SupabaseClient,
) -> tuple[bool, str]:
    if not settings.auth_required and settings.enable_anonymous_demo:
        return True, "not_required"
    if not settings.supabase_configured:
        return False, "unconfigured"
    try:
        await asyncio.wait_for(
            supabase.table_select("profiles", query="select=id&limit=1"),
            timeout=5,
        )
    except SupabaseNotConfiguredError:
        return False, "unconfigured"
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code in {401, 403}:
            return False, "unauthorized"
        return False, "error"
    except TimeoutError:
        return False, "timeout"
    except Exception:
        return False, "error"
    return True, "ok"


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
        "enforce_tenant_quotas": settings.enforce_tenant_quotas,
        "quota_daily_queries": settings.quota_daily_queries,
        "quota_daily_tokens": settings.quota_daily_tokens,
        "quota_max_documents": settings.quota_max_documents,
        "quota_max_storage_mb": settings.quota_max_storage_mb,
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


def _chat_retrieval_filters(body: QueryRequest) -> dict[str, Any]:
    filters: dict[str, Any] = {}
    if body.chat_scope == "documents" or body.document_ids:
        document_ids = [item.strip() for item in body.document_ids if item.strip()]
        if document_ids:
            filters["document_ids"] = sorted(set(document_ids))
    if body.filename:
        filters["filename"] = body.filename.strip()
    file_types = [item.strip().lower().lstrip(".") for item in body.file_types if item.strip()]
    if file_types:
        filters["file_types"] = sorted(set(file_types))
    if body.uploaded_by:
        filters["uploaded_by"] = body.uploaded_by.strip()
    if body.uploaded_after:
        filters["uploaded_after_epoch"] = int(body.uploaded_after.timestamp())
    if body.uploaded_before:
        filters["uploaded_before_epoch"] = int(body.uploaded_before.timestamp())
    if (
        filters.get("uploaded_after_epoch") is not None
        and filters.get("uploaded_before_epoch") is not None
        and int(filters["uploaded_before_epoch"]) < int(filters["uploaded_after_epoch"])
    ):
        raise HTTPException(422, "uploaded_before must be greater than or equal to uploaded_after.")
    if body.metadata_filters:
        invalid_keys = [
            key
            for key in body.metadata_filters
            if not re.fullmatch(r"[A-Za-z0-9_.-]{1,64}", key)
        ]
        if invalid_keys:
            raise HTTPException(
                422,
                "Metadata filter keys may contain only letters, numbers, dots, underscores, "
                "and dashes.",
            )
        filters["metadata"] = {
            key: value
            for key, value in body.metadata_filters.items()
            if key and len(key) <= 64
        }
    if body.min_page is not None:
        filters["min_page"] = body.min_page
    if body.max_page is not None:
        filters["max_page"] = body.max_page
    if (
        filters.get("min_page") is not None
        and filters.get("max_page") is not None
        and int(filters["max_page"]) < int(filters["min_page"])
    ):
        raise HTTPException(422, "max_page must be greater than or equal to min_page.")
    if body.chat_scope == "documents" and not any(
        key in filters for key in ("document_ids", "filename")
    ):
        raise HTTPException(422, "Selected-document chat requires at least one document.")
    return filters


async def _quota_documents(
    *,
    workspace: WorkspaceContext | None,
    settings: Settings,
    workspace_id: str,
    vs: VectorStoreManager,
) -> list[dict[str, Any]]:
    if _should_persist_workspace_event(workspace, settings):
        try:
            return await DocumentRepository().list_documents(workspace_id=workspace_id)
        except Exception as exc:
            logger.warning(
                "quota_document_list_failed",
                workspace_id=workspace_id,
                error=str(exc)[:300],
            )
    return vs.list_documents(workspace_id=workspace_id)


async def _quota_payload(
    *,
    workspace: WorkspaceContext | None,
    settings: Settings,
    workspace_id: str,
    documents: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    enforcer = TenantQuotaEnforcer(settings)
    usage = await enforcer.usage(
        workspace_id=workspace_id,
        persist=_should_persist_workspace_event(workspace, settings),
        documents=documents,
    )
    return enforcer.payload(usage)


def _valid_chat_session_id(session_id: str | None) -> str | None:
    if not session_id:
        return str(uuid.uuid4())
    try:
        uuid.UUID(session_id)
    except ValueError:
        return None
    return session_id


def _chat_title(question: str) -> str:
    title = " ".join(question.split())
    return (title[:77] + "...") if len(title) > 80 else title


async def _persist_chat_turn(
    *,
    workspace: WorkspaceContext | None,
    settings: Settings,
    session_id: str | None,
    question: str,
    answer: str,
    sources: list[SourceChunk],
    metadata: dict,
) -> str | None:
    if not _should_persist_workspace_event(workspace, settings):
        return session_id

    durable_session_id = _valid_chat_session_id(session_id)
    if durable_session_id is None:
        logger.warning(
            "chat_history_invalid_session_id",
            workspace_id=_context_workspace_id(workspace),
            session_id=session_id,
        )
        return session_id

    workspace_id = _context_workspace_id(workspace)
    user_id = _context_user_id(workspace)
    source_payload = [source.model_dump(mode="json") for source in sources]
    try:
        repo = MessageRepository()
        await repo.ensure_session(
            workspace_id=workspace_id,
            session_id=durable_session_id,
            user_id=user_id,
            title=_chat_title(question),
        )
        await repo.add_message(
            workspace_id=workspace_id,
            session_id=durable_session_id,
            role="user",
            content=question,
            metadata={"source": "chat_api"},
        )
        await repo.add_message(
            workspace_id=workspace_id,
            session_id=durable_session_id,
            role="assistant",
            content=answer,
            sources=source_payload,
            metadata={
                "source": "chat_api",
                "query_type": metadata.get("query_type"),
                "confidence": metadata.get("confidence"),
                "response_time_seconds": metadata.get("response_time_seconds"),
                "model": metadata.get("model"),
                "from_cache": metadata.get("from_cache"),
                "generation_fallback": metadata.get("generation_fallback"),
            },
        )
    except Exception as exc:
        logger.warning(
            "chat_history_persist_failed",
            workspace_id=workspace_id,
            session_id=durable_session_id,
            error=str(exc)[:300],
        )
        return session_id
    return durable_session_id


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


def _safe_int(value: Any, *, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _datetime_epoch(value: Any) -> int:
    if isinstance(value, datetime):
        return int(value.timestamp())
    if isinstance(value, str) and value:
        try:
            return int(datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp())
        except ValueError:
            pass
    return int(datetime.now(UTC).timestamp())


def _row_to_document_metadata(row: dict[str, Any]) -> DocumentMetadata:
    filename = str(row.get("filename") or row.get("original_filename") or "document")
    status_value = str(row.get("status") or DocumentStatus.READY.value)
    try:
        status = DocumentStatus(status_value)
    except ValueError:
        status = DocumentStatus.READY
    return DocumentMetadata(
        document_id=str(row.get("id") or row.get("document_id") or filename),
        filename=filename,
        file_type=Path(filename).suffix.lower().lstrip("."),
        file_size_bytes=_safe_int(row.get("file_size_bytes"), default=0),
        page_count=_safe_int(row.get("page_count"), default=0),
        chunk_count=_safe_int(row.get("chunk_count"), default=0),
        status=status,
        extra={
            "workspace_id": row.get("workspace_id"),
            "storage_bucket": row.get("storage_bucket"),
            "storage_path": row.get("storage_path"),
            "sha256": row.get("sha256"),
        },
    )


def _document_filename(row: dict[str, Any] | None, fallback: str) -> str:
    if not row:
        return fallback
    return str(row.get("filename") or row.get("original_filename") or fallback)


def _document_is_active(row: dict[str, Any] | None) -> bool:
    return bool(row) and str(row.get("status") or "").lower() != "deleted"


def _chunk_preview_from_row(row: dict[str, Any], *, default_index: int = 0) -> DocumentChunkPreview:
    return DocumentChunkPreview(
        chunk_index=_safe_int(row.get("chunk_index"), default=default_index),
        content=str(row.get("content") or "")[:2000],
        page_number=_safe_int(row.get("page_number"), default=0),
        section_title=row.get("section_title") or (row.get("metadata") or {}).get("section_title"),
        token_count=_safe_int(row.get("token_count"), default=0),
        metadata=row.get("metadata") or {},
    )


def _row_uploaded_epoch(row: dict[str, Any]) -> int | None:
    raw = row.get("created_at") or row.get("uploaded_at")
    if isinstance(raw, datetime):
        return int(raw.timestamp())
    if isinstance(raw, str) and raw:
        try:
            return int(datetime.fromisoformat(raw.replace("Z", "+00:00")).timestamp())
        except ValueError:
            return None
    return None


def _chunk_row_matches_retrieval_filters(
    row: dict[str, Any],
    *,
    document_row: dict[str, Any],
    filters: dict[str, Any],
) -> bool:
    metadata = row.get("metadata") if isinstance(row.get("metadata"), dict) else {}
    filename = _document_filename(document_row, fallback=str(row.get("document_id") or "document"))
    file_type = Path(filename).suffix.lower().lstrip(".")
    if filters.get("filename") and str(filters["filename"]) != filename:
        return False
    file_types = set(filters.get("file_types") or [])
    if file_types and file_type not in file_types:
        return False
    uploaded_by = filters.get("uploaded_by")
    if uploaded_by and str(metadata.get("uploaded_by") or "") != str(uploaded_by):
        return False
    uploaded_epoch = metadata.get("uploaded_at_epoch")
    if uploaded_epoch is None:
        uploaded_epoch = _row_uploaded_epoch(document_row)
    uploaded_epoch_int = _safe_int(uploaded_epoch, default=0)
    if filters.get("uploaded_after_epoch") is not None and uploaded_epoch_int:
        if uploaded_epoch_int < int(filters["uploaded_after_epoch"]):
            return False
    if filters.get("uploaded_before_epoch") is not None and uploaded_epoch_int:
        if uploaded_epoch_int > int(filters["uploaded_before_epoch"]):
            return False
    page_number = _safe_int(row.get("page_number"), default=0)
    if filters.get("min_page") is not None and page_number < int(filters["min_page"]):
        return False
    if filters.get("max_page") is not None and page_number > int(filters["max_page"]):
        return False
    for key, value in (filters.get("metadata") or {}).items():
        if metadata.get(key) != value:
            return False
    return True


def _chunk_document_from_row(
    row: dict[str, Any],
    *,
    document_row: dict[str, Any],
    workspace_id: str,
    default_index: int,
) -> Document:
    document_id = str(
        document_row.get("id")
        or document_row.get("document_id")
        or row.get("document_id")
    )
    filename = _document_filename(document_row, fallback=document_id)
    metadata = row.get("metadata") if isinstance(row.get("metadata"), dict) else {}
    page_number = _safe_int(row.get("page_number"), default=0)
    chunk_index = _safe_int(row.get("chunk_index"), default=default_index)
    return Document(
        page_content=str(row.get("content") or ""),
        metadata={
            **metadata,
            "workspace_id": workspace_id,
            "document_id": document_id,
            "filename": filename,
            "file_type": Path(filename).suffix.lower().lstrip("."),
            "page_number": page_number,
            "chunk_index": chunk_index,
            "document_type": "durable_chunk",
            "score": 0.55,
        },
    )


async def _durable_chunk_documents_for_filters(
    *,
    workspace_id: str,
    filters: dict[str, Any],
    limit: int,
) -> list[Document]:
    document_ids = [
        str(item).strip()
        for item in (filters.get("document_ids") or [])
        if str(item).strip()
    ]
    doc_repo = DocumentRepository()
    if not document_ids and filters.get("filename"):
        document_row = await doc_repo.find_by_filename(
            workspace_id=workspace_id,
            filename=str(filters["filename"]),
        )
        if document_row and _document_is_active(document_row):
            document_ids = [str(document_row.get("id") or "")]

    if not document_ids:
        return []

    safe_limit = max(1, min(limit, 50))
    chunk_repo = ChunkRepository()
    documents: list[Document] = []
    for document_id in document_ids[:25]:
        document_row = await doc_repo.get_document(
            workspace_id=workspace_id,
            document_id=document_id,
        )
        if not _document_is_active(document_row):
            continue
        rows = await chunk_repo.list_for_document(
            workspace_id=workspace_id,
            document_id=document_id,
        )
        for index, row in enumerate(rows):
            if not str(row.get("content") or "").strip():
                continue
            if not _chunk_row_matches_retrieval_filters(
                row,
                document_row=document_row or {},
                filters=filters,
            ):
                continue
            documents.append(
                _chunk_document_from_row(
                    row,
                    document_row=document_row or {},
                    workspace_id=workspace_id,
                    default_index=index,
                )
            )
            if len(documents) >= safe_limit:
                return documents
    return documents


def _row_to_job_response(
    row: dict[str, Any],
    *,
    document: DocumentMetadata | None = None,
) -> IngestionJobStatusResponse:
    def parse_dt(value: Any) -> datetime | None:
        if isinstance(value, datetime):
            return value
        if isinstance(value, str) and value:
            try:
                return datetime.fromisoformat(value.replace("Z", "+00:00"))
            except ValueError:
                return None
        return None

    status_value = str(row.get("status") or IngestionJobStatus.QUEUED.value)
    try:
        status = IngestionJobStatus(status_value)
    except ValueError:
        status = IngestionJobStatus.QUEUED

    return IngestionJobStatusResponse(
        job_id=str(row.get("id") or row.get("job_id") or ""),
        document_id=str(row.get("document_id") or ""),
        filename=document.filename if document else str(row.get("filename") or ""),
        status=status,
        stage=str(row.get("stage") or row.get("status") or "queued"),
        progress=_safe_int(row.get("progress"), default=0),
        message=str(row.get("stage") or row.get("status") or "queued"),
        error_message=row.get("error_message"),
        created_at=parse_dt(row.get("created_at")) or datetime.now(UTC),
        updated_at=parse_dt(row.get("updated_at")) or datetime.now(UTC),
        started_at=parse_dt(row.get("started_at")),
        completed_at=parse_dt(row.get("completed_at")),
        document=document,
    )


def _chunk_rows_from_documents(chunks: list[Document]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for index, chunk in enumerate(chunks):
        metadata = dict(chunk.metadata or {})
        original_chunk_index = _safe_int(metadata.get("chunk_index"), default=index)
        chunk_index = index
        content = chunk.page_content or ""
        page_number_value = metadata.get("page_number") or metadata.get("page")
        if original_chunk_index != chunk_index:
            metadata.setdefault("original_chunk_index", original_chunk_index)
        metadata["chunk_index"] = chunk_index
        rows.append(
            {
                "chunk_index": chunk_index,
                "content": content,
                "content_hash": compute_sha256(content.encode("utf-8", "ignore")),
                "page_number": (
                    _safe_int(page_number_value, default=0)
                    if page_number_value is not None
                    else None
                ),
                "section_title": metadata.get("section_title"),
                "token_count": (
                    _safe_int(metadata.get("token_count"), default=0)
                    if metadata.get("token_count") is not None
                    else None
                ),
                "qdrant_point_id": metadata.get("chunk_id"),
                "metadata": {
                    key: value
                    for key, value in metadata.items()
                    if key not in {"workspace_id", "document_id"}
                },
            }
        )
    return rows


def _stable_chunk_id(
    *,
    workspace_id: str,
    document_id: str,
    chunk_index: int,
    content_hash: str,
) -> str:
    return str(
        uuid.uuid5(
            uuid.NAMESPACE_URL,
            f"nexusrag:{workspace_id}:{document_id}:{chunk_index}:{content_hash}",
        )
    )


def _vector_chunks_from_documents(
    chunks: list[Document],
    embeddings: list[list[float]],
    *,
    workspace_id: str,
    document_id: str,
) -> list[VectorChunk]:
    vector_chunks: list[VectorChunk] = []
    for index, (chunk, embedding) in enumerate(zip(chunks, embeddings, strict=False)):
        metadata = chunk.metadata or {}
        chunk.metadata = metadata
        content = chunk.page_content or ""
        content_hash = compute_sha256(content.encode("utf-8", "ignore"))
        chunk_index = _safe_int(metadata.get("chunk_index"), default=index)
        chunk_id = str(
            metadata.get("chunk_id")
            or _stable_chunk_id(
                workspace_id=workspace_id,
                document_id=document_id,
                chunk_index=chunk_index,
                content_hash=content_hash,
            )
        )
        metadata["chunk_id"] = chunk_id
        metadata["content_hash"] = content_hash
        metadata.setdefault("workspace_id", workspace_id)
        metadata.setdefault("document_id", document_id)
        page_number_value = metadata.get("page_number") or metadata.get("page")
        vector_chunks.append(
            VectorChunk(
                chunk_id=chunk_id,
                content=content,
                embedding=embedding,
                filename=str(metadata.get("filename") or ""),
                chunk_index=chunk_index,
                page_number=(
                    _safe_int(page_number_value, default=0)
                    if page_number_value is not None
                    else None
                ),
                content_hash=content_hash,
                metadata={
                    key: value
                    for key, value in metadata.items()
                    if key not in {"workspace_id", "document_id"}
                },
            )
        )
    return vector_chunks


async def _sync_qdrant_chunks(
    *,
    settings: Settings,
    workspace_id: str,
    document_id: str,
    chunks: list[Document],
) -> int:
    if not chunks or not settings.enable_qdrant:
        return 0
    if not settings.qdrant_configured:
        if not settings.enable_local_faiss:
            raise RuntimeError("Qdrant is enabled as primary storage but is not configured.")
        logger.warning(
            "qdrant_index_skipped_not_configured",
            workspace_id=workspace_id,
            document_id=document_id,
        )
        return 0

    texts = [chunk.page_content or "" for chunk in chunks]
    try:
        embeddings = await asyncio.to_thread(get_embedder().embed_texts, texts)
        vector_chunks = _vector_chunks_from_documents(
            chunks,
            embeddings,
            workspace_id=workspace_id,
            document_id=document_id,
        )
        if not vector_chunks:
            return 0
        store = QdrantVectorStore(settings)
        await store.ensure_collection(vector_size=len(vector_chunks[0].embedding))
        indexed = await store.upsert_chunks(
            workspace_id=workspace_id,
            document_id=document_id,
            chunks=vector_chunks,
        )
        logger.info(
            "qdrant_chunks_indexed",
            workspace_id=workspace_id,
            document_id=document_id,
            chunks=indexed,
        )
        return indexed
    except Exception as exc:
        if not settings.enable_local_faiss:
            raise RuntimeError(f"Qdrant indexing failed: {str(exc)[:300]}") from exc
        logger.warning(
            "qdrant_index_failed_using_local_fallback",
            workspace_id=workspace_id,
            document_id=document_id,
            error=str(exc)[:300],
        )
        return 0


async def _delete_qdrant_document(
    *,
    settings: Settings,
    workspace_id: str,
    document_id: str,
) -> bool:
    if not settings.enable_qdrant:
        return False
    if not settings.qdrant_configured:
        if not settings.enable_local_faiss:
            raise RuntimeError("Qdrant is enabled as primary storage but is not configured.")
        return False
    try:
        await QdrantVectorStore(settings).delete_document(
            workspace_id=workspace_id,
            document_id=document_id,
        )
        return True
    except Exception as exc:
        if not settings.enable_local_faiss:
            raise RuntimeError(f"Qdrant delete failed: {str(exc)[:300]}") from exc
        logger.warning(
            "qdrant_delete_failed_using_local_fallback",
            workspace_id=workspace_id,
            document_id=document_id,
            error=str(exc)[:300],
        )
        return False


async def _persist_enterprise_upload_start(
    *,
    workspace: WorkspaceContext | None,
    settings: Settings,
    document_id: str,
    filename: str,
    original_filename: str,
    content: bytes,
    content_type: str | None,
) -> str | None:
    if not _should_persist_workspace_event(workspace, settings):
        return None

    workspace_id = _context_workspace_id(workspace)
    user_id = _context_user_id(workspace)
    if not user_id:
        return None

    doc_repo = DocumentRepository()
    document = await doc_repo.create_queued_document(
        workspace_id=workspace_id,
        uploaded_by=user_id,
        filename=filename,
        original_filename=original_filename,
        content_type=content_type,
        file_size_bytes=len(content),
        sha256=compute_sha256(content),
        document_id=document_id,
        storage_bucket=settings.supabase_storage_bucket,
    )
    job_repo = IngestionJobRepository()
    try:
        job = await job_repo.create_job(
            workspace_id=workspace_id,
            document_id=document_id,
        )
    except Exception:
        await doc_repo.update_document(
            workspace_id=workspace_id,
            document_id=document_id,
            values={
                "status": "failed",
                "error_message": "Unable to create ingestion job",
            },
        )
        raise

    job_id = str(job.get("id") or "")
    storage_path = str(document.get("storage_path") or "")
    try:
        if storage_path:
            await doc_repo.upload_original(
                storage_path=storage_path,
                content=content,
                content_type=content_type,
            )
    except Exception as exc:
        message = str(exc)[:500]
        await doc_repo.update_document(
            workspace_id=workspace_id,
            document_id=document_id,
            values={"status": "failed", "error_message": message},
        )
        await job_repo.update_job(
            workspace_id=workspace_id,
            job_id=job_id,
            values={
                "status": "failed",
                "stage": "storage_failed",
                "progress": 100,
                "error_message": message,
                "completed_at": datetime.now(UTC).isoformat(),
            },
        )
        raise
    return job_id


async def _persist_enterprise_upload_success(
    *,
    workspace: WorkspaceContext | None,
    settings: Settings,
    job_id: str,
    document: DocumentMetadata,
    chunks: list[Document],
) -> None:
    if not _should_persist_workspace_event(workspace, settings):
        return

    workspace_id = _context_workspace_id(workspace)
    await DocumentRepository().update_document(
        workspace_id=workspace_id,
        document_id=document.document_id,
        values={
            "status": "ready",
            "page_count": document.page_count,
            "chunk_count": document.chunk_count,
            "error_message": None,
        },
    )
    await ChunkRepository().replace_document_chunks(
        workspace_id=workspace_id,
        document_id=document.document_id,
        chunks=_chunk_rows_from_documents(chunks),
    )
    await IngestionJobRepository().update_job(
        workspace_id=workspace_id,
        job_id=job_id,
        values={
            "status": "completed",
            "stage": "completed",
            "progress": 100,
            "error_message": None,
            "completed_at": datetime.now(UTC).isoformat(),
        },
    )


async def _persist_enterprise_upload_failure(
    *,
    workspace: WorkspaceContext | None,
    settings: Settings,
    job_id: str,
    document_id: str,
    error: str,
) -> None:
    if not _should_persist_workspace_event(workspace, settings):
        return

    workspace_id = _context_workspace_id(workspace)
    message = error[:500]
    await DocumentRepository().update_document(
        workspace_id=workspace_id,
        document_id=document_id,
        values={"status": "failed", "error_message": message},
    )
    await IngestionJobRepository().update_job(
        workspace_id=workspace_id,
        job_id=job_id,
        values={
            "status": "failed",
            "stage": "failed",
            "progress": 100,
            "error_message": message,
            "completed_at": datetime.now(UTC).isoformat(),
        },
    )


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
    capture_chunks: bool = False,
) -> DocumentMetadata | tuple[DocumentMetadata, list[Document]]:
    job_store = get_ingestion_job_store()

    def report(stage: str, pct: float) -> None:
        job_store.mark_processing(job_id, stage=stage, progress=int(pct * 100))

    if not settings.enable_local_faiss and not settings.qdrant_configured:
        raise ValueError(
            "No vector backend is configured. Enable local FAISS or configure Qdrant."
        )

    try:
        pipeline = IngestionPipeline(
            vector_store=vs if settings.enable_local_faiss else None,
            settings=settings,
            progress_callback=report,
        )
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
    chunks_snapshot = list(result.chunks) if capture_chunks else []
    del result
    gc.collect()
    if capture_chunks:
        return doc_meta, chunks_snapshot
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


async def _process_enterprise_upload_job_background(**kwargs) -> None:
    workspace = kwargs.pop("workspace")
    settings = kwargs["settings"]
    job_id = kwargs["job_id"]
    document_id = kwargs["document_id"]
    try:
        processed = await asyncio.to_thread(
            _process_upload_job,
            **kwargs,
            capture_chunks=(
                _should_persist_workspace_event(workspace, settings)
                or settings.enable_qdrant
            ),
        )
        if isinstance(processed, tuple):
            doc_meta, chunks = processed
        else:
            doc_meta, chunks = processed, []
        document_row = await DocumentRepository().get_document(
            workspace_id=kwargs["workspace_id"],
            document_id=document_id,
        )
        uploaded_at_epoch = _datetime_epoch(
            document_row.get("created_at") if document_row else None
        )
        uploaded_by = _context_user_id(workspace)
        for chunk in chunks:
            chunk.metadata.setdefault("uploaded_at_epoch", uploaded_at_epoch)
            if uploaded_by:
                chunk.metadata.setdefault("uploaded_by", uploaded_by)
        await _sync_qdrant_chunks(
            settings=settings,
            workspace_id=kwargs["workspace_id"],
            document_id=document_id,
            chunks=chunks,
        )
        await _persist_enterprise_upload_success(
            workspace=workspace,
            settings=settings,
            job_id=job_id,
            document=doc_meta,
            chunks=chunks,
        )
    except Exception as exc:
        get_ingestion_job_store().mark_failed(
            job_id,
            stage="processing_error",
            error_message=str(exc)[:500],
        )
        await _persist_enterprise_upload_failure(
            workspace=workspace,
            settings=settings,
            job_id=job_id,
            document_id=document_id,
            error=str(exc),
        )
        logger.warning(
            "upload_background_job_failed",
            job_id=job_id,
            file=kwargs.get("safe_name"),
            error=str(exc),
        )


# ═══════════════════════════════════════════════════════════════════════════
#  DOCUMENTS
# ═══════════════════════════════════════════════════════════════════════════


async def _queue_durable_reindex_job(
    *,
    background_tasks: BackgroundTasks,
    workspace: WorkspaceContext | None,
    settings: Settings,
    document_id: str,
    vs: VectorStoreManager,
    chain: RAGChain,
    existing_job_id: str | None = None,
) -> IngestionJobStatusResponse:
    workspace_id = _context_workspace_id(workspace)
    if not _should_persist_workspace_event(workspace, settings):
        docs = vs.list_documents(workspace_id=workspace_id)
        if any(
            document_id in {str(doc.get("document_id") or ""), str(doc.get("filename") or "")}
            for doc in docs
        ):
            raise HTTPException(
                409,
                "Re-index requires a stored original document. Sign in with Supabase-backed "
                "storage or upload the file again in demo mode.",
            )
        raise HTTPException(404, f"Document '{document_id}' not found")

    doc_repo = DocumentRepository()
    job_repo = IngestionJobRepository()
    document = await doc_repo.get_document(workspace_id=workspace_id, document_id=document_id)
    if not document or str(document.get("status") or "") == "deleted":
        raise HTTPException(404, f"Document '{document_id}' not found")
    storage_path = str(document.get("storage_path") or "")
    if not storage_path:
        raise HTTPException(
            409,
            "Re-index requires a stored original document. This document has no storage path.",
        )

    safe_name = str(document.get("filename") or document.get("original_filename") or "document")
    try:
        content = await doc_repo.download_original(
            workspace_id=workspace_id,
            document_id=document_id,
            storage_path=storage_path,
        )
    except Exception as exc:
        logger.warning(
            "reindex_original_download_failed",
            workspace_id=workspace_id,
            document_id=document_id,
            error=str(exc)[:300],
        )
        raise HTTPException(
            503,
            "Stored original document is temporarily unavailable. Please retry later.",
        ) from exc

    if existing_job_id:
        job_row = await job_repo.update_job(
            workspace_id=workspace_id,
            job_id=existing_job_id,
            values={
                "status": "queued",
                "stage": "queued",
                "progress": 0,
                "error_message": None,
                "completed_at": None,
            },
        )
        if not job_row:
            raise HTTPException(404, f"Ingestion job '{existing_job_id}' not found")
    else:
        job_row = await job_repo.create_job(
            workspace_id=workspace_id,
            document_id=document_id,
            stage="reindex_queued",
        )

    job_id = str(job_row.get("id") or existing_job_id or "")
    await doc_repo.update_document(
        workspace_id=workspace_id,
        document_id=document_id,
        values={"status": "queued", "error_message": None},
    )
    job = get_ingestion_job_store().create(
        job_id=job_id,
        document_id=document_id,
        filename=safe_name,
        workspace_id=workspace_id,
    )
    vs.delete_by_identifier(document_id, workspace_id=workspace_id)
    chain.clear_cache(workspace_id=workspace_id)
    background_tasks.add_task(
        _process_enterprise_upload_job_background,
        workspace=workspace,
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
        action="document.reindex_queued" if not existing_job_id else "document.retry_queued",
        resource_type="document",
        resource_id=document_id,
        metadata={"job_id": job.job_id, "filename": safe_name},
    )
    return job.response()


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
    try:
        quota_docs = await _quota_documents(
            workspace=workspace,
            settings=settings,
            workspace_id=workspace_id,
            vs=vs,
        )
        quota_usage = await TenantQuotaEnforcer(settings).usage(
            workspace_id=workspace_id,
            persist=_should_persist_workspace_event(workspace, settings),
            documents=quota_docs,
        )
        TenantQuotaEnforcer(settings).assert_upload_allowed(
            quota_usage,
            file_size_bytes=len(content),
        )
    except QuotaExceededError as exc:
        raise HTTPException(status_code=429, detail=str(exc)) from exc

    document_id = str(uuid.uuid4())
    try:
        enterprise_job_id = await _persist_enterprise_upload_start(
            workspace=workspace,
            settings=settings,
            document_id=document_id,
            filename=safe_name,
            original_filename=file.filename,
            content=content,
            content_type=file.content_type,
        )
    except Exception as exc:
        logger.error(
            "enterprise_upload_start_failed",
            workspace_id=workspace_id,
            file=safe_name,
            error=str(exc)[:300],
        )
        raise HTTPException(
            503,
            "Document persistence is temporarily unavailable. Please retry the upload.",
        )
    job_store = get_ingestion_job_store()
    job = job_store.create(
        job_id=enterprise_job_id,
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
        background_task = (
            _process_enterprise_upload_job_background
            if enterprise_job_id
            else _process_upload_job_background
        )
        task_kwargs: dict[str, Any] = {
            "job_id": job.job_id,
            "workspace_id": workspace_id,
            "document_id": document_id,
            "safe_name": safe_name,
            "content": content,
            "settings": settings,
            "vs": vs,
            "chain": chain,
        }
        if enterprise_job_id:
            task_kwargs["workspace"] = workspace
        background_tasks.add_task(background_task, **task_kwargs)
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
        processed = await loop.run_in_executor(
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
                capture_chunks=bool(enterprise_job_id) or settings.enable_qdrant,
            ),
        )
        if isinstance(processed, tuple):
            doc_meta, processed_chunks = processed
        else:
            doc_meta, processed_chunks = processed, []
        await _sync_qdrant_chunks(
            settings=settings,
            workspace_id=workspace_id,
            document_id=document_id,
            chunks=processed_chunks,
        )
        if enterprise_job_id:
            await _persist_enterprise_upload_success(
                workspace=workspace,
                settings=settings,
                job_id=job.job_id,
                document=doc_meta,
                chunks=processed_chunks,
            )
    except Exception as exc:
        job_store.mark_failed(
            job.job_id,
            stage="processing_error",
            error_message=str(exc)[:500],
        )
        if enterprise_job_id:
            await _persist_enterprise_upload_failure(
                workspace=workspace,
                settings=settings,
                job_id=job.job_id,
                document_id=document_id,
                error=str(exc),
            )
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
    settings: Settings = Depends(get_settings),
    vs: VectorStoreManager = Depends(get_vector_store),
) -> DocumentListResponse:
    workspace_id = _context_workspace_id(workspace)
    if _should_persist_workspace_event(workspace, settings):
        try:
            rows = await DocumentRepository().list_documents(workspace_id=workspace_id)
            docs = [_row_to_document_metadata(row) for row in rows]
            return DocumentListResponse(documents=docs, total=len(docs))
        except Exception as exc:
            logger.warning(
                "durable_document_list_failed",
                workspace_id=workspace_id,
                error=str(exc)[:300],
            )

    docs_raw = vs.list_documents(workspace_id=workspace_id)
    docs = [
        DocumentMetadata(
            document_id=str(d.get("document_id") or d["filename"]),
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
    settings: Settings = Depends(get_settings),
) -> IngestionJobStatusResponse:
    workspace_id = _context_workspace_id(workspace)
    job = get_ingestion_job_store().get(job_id)
    if job and job.workspace_id == workspace_id:
        return job.response()
    if _should_persist_workspace_event(workspace, settings):
        row = await IngestionJobRepository().get_job(workspace_id=workspace_id, job_id=job_id)
        if row:
            document_row = await DocumentRepository().get_document(
                workspace_id=workspace_id,
                document_id=str(row.get("document_id") or ""),
            )
            document = _row_to_document_metadata(document_row) if document_row else None
            return _row_to_job_response(row, document=document)
    raise HTTPException(404, f"Ingestion job '{job_id}' not found")


@router.post("/documents/jobs/{job_id}/retry", response_model=IngestionJobStatusResponse)
async def retry_ingestion_job(
    job_id: str,
    background_tasks: BackgroundTasks,
    workspace: WorkspaceContext | None = Depends(
        require_enterprise_workspace_role(*EDITOR_ROLES)
    ),
    settings: Settings = Depends(get_settings),
    vs: VectorStoreManager = Depends(get_vector_store),
    chain: RAGChain = Depends(get_rag_chain),
) -> IngestionJobStatusResponse:
    workspace_id = _context_workspace_id(workspace)
    job = get_ingestion_job_store().get(job_id)
    if job and job.workspace_id == workspace_id:
        return await _queue_durable_reindex_job(
            background_tasks=background_tasks,
            workspace=workspace,
            settings=settings,
            document_id=job.document_id,
            vs=vs,
            chain=chain,
            existing_job_id=job_id,
        )

    if _should_persist_workspace_event(workspace, settings):
        row = await IngestionJobRepository().get_job(workspace_id=workspace_id, job_id=job_id)
        if row:
            return await _queue_durable_reindex_job(
                background_tasks=background_tasks,
                workspace=workspace,
                settings=settings,
                document_id=str(row.get("document_id") or ""),
                vs=vs,
                chain=chain,
                existing_job_id=job_id,
            )
    raise HTTPException(404, f"Ingestion job '{job_id}' not found")


@router.get("/documents/{document_id}/status", response_model=IngestionJobStatusResponse)
async def get_document_ingestion_status(
    document_id: str,
    workspace: WorkspaceContext | None = Depends(
        require_enterprise_workspace_role(*VIEWER_ROLES)
    ),
    settings: Settings = Depends(get_settings),
) -> IngestionJobStatusResponse:
    workspace_id = _context_workspace_id(workspace)
    job = get_ingestion_job_store().get_by_document_id(document_id)
    if job and job.workspace_id == workspace_id:
        return job.response()
    if _should_persist_workspace_event(workspace, settings):
        rows = await IngestionJobRepository().list_for_document(
            workspace_id=workspace_id,
            document_id=document_id,
        )
        if rows:
            document_row = await DocumentRepository().get_document(
                workspace_id=workspace_id,
                document_id=document_id,
            )
            document = _row_to_document_metadata(document_row) if document_row else None
            return _row_to_job_response(rows[0], document=document)
    raise HTTPException(404, f"Ingestion status for document '{document_id}' not found")


@router.post("/documents/{document_id}/reindex", response_model=IngestionJobStatusResponse)
async def reindex_document(
    document_id: str,
    background_tasks: BackgroundTasks,
    workspace: WorkspaceContext | None = Depends(
        require_enterprise_workspace_role(*EDITOR_ROLES)
    ),
    settings: Settings = Depends(get_settings),
    vs: VectorStoreManager = Depends(get_vector_store),
    chain: RAGChain = Depends(get_rag_chain),
) -> IngestionJobStatusResponse:
    return await _queue_durable_reindex_job(
        background_tasks=background_tasks,
        workspace=workspace,
        settings=settings,
        document_id=document_id,
        vs=vs,
        chain=chain,
    )


@router.get("/documents/{document_id}/chunks", response_model=DocumentChunkListResponse)
async def list_document_chunks(
    document_id: str,
    search: str | None = Query(default=None, max_length=200),
    limit: int = Query(default=25, ge=1, le=100),
    workspace: WorkspaceContext | None = Depends(
        require_enterprise_workspace_role(*VIEWER_ROLES)
    ),
    settings: Settings = Depends(get_settings),
    vs: VectorStoreManager = Depends(get_vector_store),
) -> DocumentChunkListResponse:
    workspace_id = _context_workspace_id(workspace)
    payload = vs.list_document_chunks(
        document_id,
        workspace_id=workspace_id,
        search=search,
        limit=limit,
    )
    if payload["total"] == 0 and _should_persist_workspace_event(workspace, settings):
        rows = await ChunkRepository().list_for_document(
            workspace_id=workspace_id,
            document_id=document_id,
        )
        needle = (search or "").strip().lower()
        filtered_rows = [
            row for row in rows if not needle or needle in str(row.get("content") or "").lower()
        ]
        previews = [
            _chunk_preview_from_row(row, default_index=index)
            for index, row in enumerate(filtered_rows[:limit])
        ]
        document_row = await DocumentRepository().get_document(
            workspace_id=workspace_id,
            document_id=document_id,
        )
        if previews or rows or _document_is_active(document_row):
            return DocumentChunkListResponse(
                document_id=document_id,
                filename=_document_filename(document_row, fallback=document_id),
                chunks=previews,
                total=len(filtered_rows),
                query=search,
            )
    if payload["total"] == 0:
        docs = vs.list_documents(workspace_id=workspace_id)
        if not any(
            document_id in {str(doc.get("document_id") or ""), str(doc.get("filename") or "")}
            for doc in docs
        ):
            raise HTTPException(404, f"Document '{document_id}' not found")
    return DocumentChunkListResponse(
        document_id=str(payload["document_id"]),
        filename=str(payload["filename"]),
        chunks=[DocumentChunkPreview(**chunk) for chunk in payload["chunks"]],
        total=int(payload["total"]),
        query=search,
    )


@router.delete("/documents/{document_identifier}", response_model=DocumentDeleteResponse)
async def delete_document(
    document_identifier: str,
    workspace: WorkspaceContext | None = Depends(
        require_enterprise_workspace_role(*EDITOR_ROLES)
    ),
    settings: Settings = Depends(get_settings),
    vs: VectorStoreManager = Depends(get_vector_store),
    chain: RAGChain = Depends(get_rag_chain),
) -> DocumentDeleteResponse:
    workspace_id = _context_workspace_id(workspace)
    removed = vs.delete_by_identifier(document_identifier, workspace_id=workspace_id)
    durable_document_id = document_identifier
    durable_removed = False
    if _should_persist_workspace_event(workspace, settings):
        doc_repo = DocumentRepository()
        document_row = await doc_repo.get_document(
            workspace_id=workspace_id,
            document_id=document_identifier,
        )
        if not document_row:
            document_row = await doc_repo.find_by_filename(
                workspace_id=workspace_id,
                filename=document_identifier,
            )
        if document_row:
            durable_document_id = str(document_row.get("id") or document_identifier)
            storage_path = str(document_row.get("storage_path") or "")
            if storage_path:
                try:
                    await doc_repo.delete_original(
                        workspace_id=workspace_id,
                        document_id=durable_document_id,
                        storage_path=storage_path,
                    )
                except Exception as exc:
                    logger.warning(
                        "document_storage_delete_failed",
                        workspace_id=workspace_id,
                        document_id=durable_document_id,
                        error=str(exc)[:300],
                    )
                    raise HTTPException(
                        502,
                        "Unable to delete the original document from private storage.",
                    ) from exc
            await ChunkRepository().delete_document_chunks(
                workspace_id=workspace_id,
                document_id=durable_document_id,
            )
            await doc_repo.mark_deleted(
                workspace_id=workspace_id,
                document_id=durable_document_id,
            )
            durable_removed = True
    try:
        qdrant_removed = await _delete_qdrant_document(
            settings=settings,
            workspace_id=workspace_id,
            document_id=durable_document_id,
        )
    except RuntimeError as exc:
        raise HTTPException(503, str(exc)) from exc
    if removed == 0 and not durable_removed:
        raise HTTPException(404, f"Document '{document_identifier}' not found")
    chain.clear_cache(workspace_id=workspace_id)
    get_layered_cache().invalidate(
        workspace_id=workspace_id,
        document_id=durable_document_id,
    )
    await _record_audit_event(
        workspace=workspace,
        settings=settings,
        action="document.deleted",
        resource_type="document",
        resource_id=durable_document_id,
        metadata={
            "document_identifier": document_identifier,
            "chunks_removed": removed,
            "durable_deleted": durable_removed,
            "qdrant_deleted": qdrant_removed,
        },
    )
    return DocumentDeleteResponse(
        success=True,
        message=f"Removed {removed} chunks",
        document_id=durable_document_id,
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
    retrieval_filters = _chat_retrieval_filters(body)
    estimated_input_tokens = estimate_tokens(body.question, *history_token_parts)

    try:
        enforcer = TenantQuotaEnforcer(settings)
        quota_usage = await enforcer.usage(
            workspace_id=workspace_id,
            persist=persist_event,
        )
        enforcer.assert_chat_allowed(
            quota_usage,
            estimated_tokens=estimated_input_tokens,
        )
    except QuotaExceededError as exc:
        await _record_audit_event(
            workspace=workspace,
            settings=settings,
            action="quota.chat_blocked",
            resource_type="chat_session",
            resource_id=body.session_id,
            metadata={
                "reason": str(exc),
                "quota": exc.payload,
            },
        )
        raise HTTPException(status_code=429, detail=str(exc)) from exc

    try:
        result = chain.query(
            body.question,
            workspace_id=workspace_id,
            session_id=body.session_id,
            conversation_history=history if history else None,
            top_k=body.top_k,
            use_reranking=body.use_reranking,
            retrieval_filters=retrieval_filters or None,
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
        await persist_provider_health_snapshot(
            chain,
            workspace_id=workspace_id,
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
                "chat_scope": body.chat_scope,
                "retrieval_filters": retrieval_filters,
                "error": str(exc)[:200],
            },
        )
        raise

    if (
        persist_event
        and not result.get("sources")
        and retrieval_filters
        and any(key in retrieval_filters for key in ("document_ids", "filename"))
    ):
        durable_docs = await _durable_chunk_documents_for_filters(
            workspace_id=workspace_id,
            filters=retrieval_filters,
            limit=max(5, min(body.top_k or settings.retrieval_top_k, 25)),
        )
        if durable_docs:
            result = chain.answer_from_documents(
                body.question,
                durable_docs,
                workspace_id=workspace_id,
                conversation_history=history if history else None,
                retrieval_filters=retrieval_filters,
                query_type=result.get("query_type", "specific"),
                transformed_queries=(
                    (result.get("metadata") or {}).get("transformed_queries")
                    or [body.question]
                ),
                k_used=len(durable_docs),
                metadata={
                    **dict(result.get("metadata", {}) or {}),
                    "durable_chunk_fallback": True,
                    "fallback_reason": "primary_vector_retrieval_empty",
                },
            )

    sources = [SourceChunk(**s) for s in result.get("sources", [])]
    metadata = dict(result.get("metadata", {}) or {})
    cache_hit = bool(result.get("from_cache") or metadata.get("from_cache"))
    generation_fallback = bool(metadata.get("generation_fallback"))
    metadata["from_cache"] = cache_hit
    metadata["query_type"] = result.get("query_type", "general")
    metadata["confidence"] = result.get("confidence", 0.0)
    metadata["response_time_seconds"] = result.get("response_time_seconds", 0.0)
    answer = result["answer"]
    latency_ms = int(float(result.get("response_time_seconds", 0.0) or 0.0) * 1000)

    await telemetry.record_llm_usage(
        workspace_id=workspace_id,
        user_id=_context_user_id(workspace),
        model=str(metadata.get("model") or settings.llm_model_name),
        operation="chat.query",
        input_tokens=0 if cache_hit else estimated_input_tokens,
        output_tokens=0 if cache_hit else estimate_tokens(answer),
        latency_ms=latency_ms,
        success=True,
        error_code=(
            "cache_hit" if cache_hit else "generation_fallback" if generation_fallback else None
        ),
        persist=persist_event,
    )
    await persist_provider_health_snapshot(
        chain,
        workspace_id=workspace_id,
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
            "chat_scope": body.chat_scope,
            "retrieval_filters": retrieval_filters,
            "query_type": result.get("query_type", "general"),
            "source_count": len(sources),
            "cache_hit": cache_hit,
            "generation_fallback": generation_fallback,
            "latency_ms": latency_ms,
        },
    )
    persisted_session_id = await _persist_chat_turn(
        workspace=workspace,
        settings=settings,
        session_id=body.session_id,
        question=body.question,
        answer=answer,
        sources=sources,
        metadata=metadata,
    )
    metadata["session_id"] = persisted_session_id or body.session_id
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
    durable_messages_deleted = 0
    if _should_persist_workspace_event(workspace, settings):
        try:
            durable_messages_deleted = await MessageRepository().clear_session(
                workspace_id=workspace_id,
                session_id=session_id,
            )
        except Exception as exc:
            logger.warning(
                "chat_history_clear_failed",
                workspace_id=workspace_id,
                session_id=session_id,
                error=str(exc)[:300],
            )
    await _record_audit_event(
        workspace=workspace,
        settings=settings,
        action="chat.session_cleared",
        resource_type="chat_session",
        resource_id=session_id,
        metadata={"durable_messages_deleted": durable_messages_deleted},
    )
    return {
        "success": True,
        "message": f"Session {session_id} cleared",
        "durable_messages_deleted": durable_messages_deleted,
    }


@router.get("/chat/sessions/{session_id}/messages", response_model=ChatHistoryResponse)
async def list_session_messages(
    session_id: str,
    workspace: WorkspaceContext | None = Depends(
        require_enterprise_workspace_role(*VIEWER_ROLES)
    ),
    settings: Settings = Depends(get_settings),
    chain: RAGChain = Depends(get_rag_chain),
) -> ChatHistoryResponse:
    workspace_id = _context_workspace_id(workspace)
    messages: list[ChatHistoryMessage] = []
    if _should_persist_workspace_event(workspace, settings):
        try:
            rows = await MessageRepository().list_messages(
                workspace_id=workspace_id,
                session_id=session_id,
            )
            messages = [
                ChatHistoryMessage(
                    role=str(row.get("role") or "assistant"),
                    content=str(row.get("content") or ""),
                    sources=row.get("sources") or [],
                    metadata=row.get("metadata") or {},
                    created_at=str(row.get("created_at")) if row.get("created_at") else None,
                )
                for row in rows
            ]
        except Exception as exc:
            logger.warning(
                "chat_history_read_failed",
                workspace_id=workspace_id,
                session_id=session_id,
                error=str(exc)[:300],
            )

    if not messages:
        messages = [
            ChatHistoryMessage(
                role=str(message.get("role") or "assistant"),
                content=str(message.get("content") or ""),
                metadata=message.get("metadata") or {},
                created_at=str(message.get("timestamp")) if message.get("timestamp") else None,
            )
            for message in chain.get_session_history(session_id, workspace_id=workspace_id)
        ]

    return ChatHistoryResponse(
        session_id=session_id,
        messages=messages,
        total=len(messages),
    )


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

        cast(Any, legacy_genai).configure(api_key=api_key)
        models = list(cast(Any, legacy_genai).list_models())
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


@router.delete("/apikey")
async def delete_api_key(
    provider: str = Query(default=GEMINI_PROVIDER, min_length=2, max_length=32),
    workspace: WorkspaceContext | None = Depends(
        require_enterprise_workspace_role(*ADMIN_ROLES)
    ),
    settings: Settings = Depends(get_settings),
) -> dict:
    """Deactivate the workspace-scoped provider key without returning secret material."""
    normalized_provider = normalize_provider(provider)
    if normalized_provider != GEMINI_PROVIDER:
        raise HTTPException(400, f"Provider '{provider}' is not supported yet.")

    workspace_id = _context_workspace_id(workspace)
    user_id = workspace.user.id if workspace else None
    manager = get_provider_key_manager()
    removed = manager.remove_key(workspace_id=workspace_id, provider=normalized_provider)

    storage = "memory"
    deactivated_rows = 0
    if workspace and not workspace.user.is_demo and settings.supabase_configured:
        try:
            rows = await manager.persist_delete_key(
                workspace_id=workspace_id,
                user_id=user_id,
                provider=normalized_provider,
            )
            deactivated_rows = len(rows)
            storage = "supabase"
        except Exception as exc:
            logger.warning(
                "api_key_delete_persist_failed",
                workspace_id=workspace_id,
                provider=normalized_provider,
                error=str(exc)[:300],
            )

    await _record_audit_event(
        workspace=workspace,
        settings=settings,
        action="provider_key.removed",
        resource_type="api_key",
        resource_id=removed.key_label if removed else None,
        metadata={
            "provider": normalized_provider,
            "had_memory_key": removed is not None,
            "deactivated_rows": deactivated_rows,
            "storage": storage,
        },
    )
    return {
        "success": True,
        "message": "Workspace API key removed.",
        "provider": normalized_provider,
        "workspace_id": workspace_id,
        "workspace_key_configured": False,
        "server_key_configured": bool(settings.google_api_key),
        "key_fingerprint": None,
        "storage": storage,
    }


@router.get("/billing/usage", response_model=BillingUsageResponse)
async def billing_usage(
    workspace: WorkspaceContext | None = Depends(
        require_enterprise_workspace_role(*VIEWER_ROLES)
    ),
    settings: Settings = Depends(get_settings),
) -> BillingUsageResponse:
    if not _should_persist_workspace_event(workspace, settings):
        return BillingUsageResponse(storage="memory", daily=[], totals={})
    workspace_id = _context_workspace_id(workspace)
    repo = BillingRepository()
    try:
        await repo.reconcile_day(workspace_id=workspace_id)
        daily = await repo.list_daily(workspace_id=workspace_id)
    except Exception as exc:
        logger.warning(
            "billing_reconciliation_failed",
            workspace_id=workspace_id,
            error=str(exc)[:300],
        )
        raise HTTPException(502, "Unable to reconcile durable workspace usage.") from exc
    totals = {
        "query_count": sum(_safe_int(row.get("query_count")) for row in daily),
        "total_tokens": sum(_safe_int(row.get("total_tokens")) for row in daily),
        "estimated_cost_microusd": sum(
            _safe_int(row.get("estimated_cost_microusd")) for row in daily
        ),
    }
    return BillingUsageResponse(storage="supabase", daily=daily, totals=totals)


@router.get("/privacy/settings", response_model=PrivacySettingsResponse)
async def privacy_settings(
    workspace: WorkspaceContext | None = Depends(
        require_enterprise_workspace_role(*VIEWER_ROLES)
    ),
    settings: Settings = Depends(get_settings),
) -> PrivacySettingsResponse:
    if not _should_persist_workspace_event(workspace, settings):
        return PrivacySettingsResponse()
    row = await WorkspaceSettingsRepository().get_settings(
        workspace_id=_context_workspace_id(workspace)
    )
    return PrivacySettingsResponse(
        retention_enabled=bool((row or {}).get("retention_enabled")),
        retention_days=_safe_int((row or {}).get("retention_days")),
        last_retention_at=(row or {}).get("last_retention_at"),
        next_retention_at=(row or {}).get("next_retention_at"),
    )


@router.patch("/privacy/settings", response_model=PrivacySettingsResponse)
async def update_privacy_settings(
    body: PrivacySettingsUpdateRequest,
    workspace: WorkspaceContext | None = Depends(
        require_enterprise_workspace_role(*ADMIN_ROLES)
    ),
    settings: Settings = Depends(get_settings),
) -> PrivacySettingsResponse:
    if not _should_persist_workspace_event(workspace, settings):
        raise HTTPException(403, "Demo mode cannot configure durable retention.")
    if body.retention_enabled and body.retention_days < 1:
        raise HTTPException(422, "Retention days must be at least 1 when retention is enabled.")
    workspace_id = _context_workspace_id(workspace)
    next_retention = (
        datetime.now(UTC) + timedelta(days=1) if body.retention_enabled else None
    )
    await WorkspaceSettingsRepository().upsert_settings(
        workspace_id=workspace_id,
        values={
            "retention_enabled": body.retention_enabled,
            "retention_days": body.retention_days if body.retention_enabled else 0,
            "next_retention_at": next_retention.isoformat() if next_retention else None,
            "retention_lease_owner": None,
            "retention_lease_expires_at": None,
        },
    )
    await _record_audit_event(
        workspace=workspace,
        settings=settings,
        action="privacy.retention_updated",
        resource_type="workspace_settings",
        resource_id=workspace_id,
        metadata=body.model_dump(),
    )
    return await privacy_settings(workspace=workspace, settings=settings)


@router.post("/privacy/retention/run", response_model=WorkspaceLifecycleResponse)
async def run_retention(
    workspace: WorkspaceContext | None = Depends(
        require_enterprise_workspace_role(*ADMIN_ROLES)
    ),
    settings: Settings = Depends(get_settings),
    vs: VectorStoreManager = Depends(get_vector_store),
) -> WorkspaceLifecycleResponse:
    if not _should_persist_workspace_event(workspace, settings):
        raise HTTPException(403, "Demo mode cannot run durable retention.")
    workspace_id = _context_workspace_id(workspace)
    row = await WorkspaceSettingsRepository().get_settings(workspace_id=workspace_id)
    retention_days = _safe_int((row or {}).get("retention_days"))
    if not (row or {}).get("retention_enabled") or retention_days < 1:
        raise HTTPException(409, "Enable a retention schedule before running cleanup.")
    qdrant = QdrantVectorStore(settings) if settings.qdrant_configured else None
    result = await WorkspaceLifecycleService(vector_store=vs, qdrant_store=qdrant).apply_retention(
        workspace_id=workspace_id,
        retention_days=retention_days,
    )
    now = datetime.now(UTC)
    if result.failures:
        await WorkspaceSettingsRepository().upsert_settings(
            workspace_id=workspace_id,
            values={
                "next_retention_at": (now + timedelta(hours=1)).isoformat(),
                "retention_lease_owner": None,
                "retention_lease_expires_at": None,
            },
        )
        await _record_audit_event(
            workspace=workspace,
            settings=settings,
            action="privacy.retention_failed",
            resource_type="workspace",
            resource_id=workspace_id,
            metadata={
                "documents_deleted": result.documents_deleted,
                "chat_sessions_deleted": result.chat_sessions_deleted,
                "failures": result.failures,
            },
        )
        raise HTTPException(
            502,
            "Retention cleanup completed with partial failures and was scheduled for retry.",
        )
    await WorkspaceSettingsRepository().upsert_settings(
        workspace_id=workspace_id,
        values={
            "last_retention_at": now.isoformat(),
            "next_retention_at": (now + timedelta(days=1)).isoformat(),
            "retention_lease_owner": None,
            "retention_lease_expires_at": None,
        },
    )
    await _record_audit_event(
        workspace=workspace,
        settings=settings,
        action="privacy.retention_run",
        resource_type="workspace",
        resource_id=workspace_id,
        metadata={
            "documents_deleted": result.documents_deleted,
            "chat_sessions_deleted": result.chat_sessions_deleted,
            "failures": len(result.failures),
        },
    )
    return WorkspaceLifecycleResponse(**result.__dict__)


@router.delete("/workspaces/current", response_model=WorkspaceLifecycleResponse)
async def delete_current_workspace(
    _body: WorkspaceDeleteRequest,
    workspace: WorkspaceContext | None = Depends(
        require_enterprise_workspace_role(WorkspaceRole.OWNER)
    ),
    settings: Settings = Depends(get_settings),
    vs: VectorStoreManager = Depends(get_vector_store),
    chain: RAGChain = Depends(get_rag_chain),
) -> WorkspaceLifecycleResponse:
    if not _should_persist_workspace_event(workspace, settings):
        raise HTTPException(403, "Demo mode cannot delete a durable workspace.")
    workspace_id = _context_workspace_id(workspace)
    qdrant = QdrantVectorStore(settings) if settings.qdrant_configured else None
    result = await WorkspaceLifecycleService(vector_store=vs, qdrant_store=qdrant).delete_workspace(
        workspace_id=workspace_id
    )
    if result.failures:
        raise HTTPException(
            502,
            {
                "message": "Workspace deletion stopped because data cleanup was incomplete.",
                "failures": result.failures,
            },
        )
    if not result.workspace_deleted:
        raise HTTPException(404, "Workspace not found.")
    chain.clear_cache(workspace_id=workspace_id)
    return WorkspaceLifecycleResponse(**result.__dict__)


#  ANALYTICS
# ═══════════════════════════════════════════════════════════════════════════


def _evaluation_gates(
    summary: dict[str, Any],
    *,
    recall_threshold: float,
    citation_threshold: float,
) -> dict[str, Any]:
    recall = float(summary.get("avg_retrieval_recall_at_k", 0.0) or 0.0)
    citation_precision = float(summary.get("avg_citation_precision", 0.0) or 0.0)
    leaks = int(summary.get("cross_workspace_leaks", 0) or 0)
    pass_rate = float(summary.get("pass_rate", 0.0) or 0.0)
    checks: dict[str, dict[str, Any]] = {
        "retrieval_recall": {
            "value": recall,
            "threshold": recall_threshold,
            "passed": recall >= recall_threshold,
        },
        "citation_precision": {
            "value": citation_precision,
            "threshold": citation_threshold,
            "passed": citation_precision >= citation_threshold,
        },
        "cross_workspace_leaks": {
            "value": leaks,
            "threshold": 0,
            "passed": leaks == 0,
        },
        "case_pass_rate": {
            "value": pass_rate,
            "threshold": 1.0,
            "passed": pass_rate >= 1.0,
        },
    }
    return {
        "passed": all(check["passed"] for check in checks.values()),
        "checks": checks,
    }


@router.post("/evaluations/sample", response_model=EvaluationReportResponse)
async def run_sample_evaluation(
    body: EvaluationRunRequest = Body(default_factory=lambda: EvaluationRunRequest(top_k=None)),
    workspace: WorkspaceContext | None = Depends(
        require_enterprise_workspace_role(*VIEWER_ROLES)
    ),
    settings: Settings = Depends(get_settings),
) -> EvaluationReportResponse:
    """Run the bundled CI-safe evaluation corpus without external LLM calls."""
    started = time.perf_counter()
    report_path = Path(
        tempfile.gettempdir(),
        f"nexusrag-eval-{uuid.uuid4().hex}.json",
    )
    try:
        report = await asyncio.to_thread(
            run_evaluation,
            dataset_path=DEFAULT_DATASET,
            report_path=report_path,
            mode=body.mode,
            top_k=body.top_k,
            fail_under_recall=0.0,
            fail_on_leak=False,
        )
    except Exception as exc:
        logger.warning("evaluation_run_failed", mode=body.mode, error=str(exc)[:300])
        raise HTTPException(
            status_code=500,
            detail=f"Evaluation failed to run: {str(exc)[:200]}",
        ) from exc
    finally:
        try:
            report_path.unlink(missing_ok=True)
        except Exception:
            pass

    summary = dict(report.get("summary") or {})
    gates = _evaluation_gates(
        summary,
        recall_threshold=body.fail_under_recall,
        citation_threshold=body.fail_under_citation_precision,
    )
    await _record_audit_event(
        workspace=workspace,
        settings=settings,
        action="evaluation.run",
        resource_type="evaluation",
        resource_id=Path(DEFAULT_DATASET).name,
        metadata={
            "mode": body.mode,
            "top_k": body.top_k,
            "passed": gates["passed"],
            "total_cases": summary.get("total", 0),
            "cross_workspace_leaks": summary.get("cross_workspace_leaks", 0),
        },
    )
    return EvaluationReportResponse(
        dataset=Path(DEFAULT_DATASET).name,
        mode=str(report.get("mode") or body.mode),
        generated_at=datetime.now(UTC).isoformat(),
        duration_ms=round((time.perf_counter() - started) * 1000, 2),
        summary=summary,
        gates=gates,
        results=[EvaluationCaseResponse(**item) for item in report.get("results", [])],
    )


@router.get("/analytics/summary", response_model=AnalyticsSummary)
async def analytics_summary(
    workspace: WorkspaceContext | None = Depends(
        require_enterprise_workspace_role(*VIEWER_ROLES)
    ),
    vs: VectorStoreManager = Depends(get_vector_store),
) -> AnalyticsSummary:
    workspace_id = _context_workspace_id(workspace)
    settings_instance = get_settings()
    docs = await _quota_documents(
        workspace=workspace,
        settings=settings_instance,
        workspace_id=workspace_id,
        vs=vs,
    )
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
        usage_tokens_today=telemetry_summary.get("usage_tokens_today", 0),
        audit_events=telemetry_summary.get("audit_events", 0),
        last_activity_at=telemetry_summary.get("last_activity_at"),
        quota=await _quota_payload(
            workspace=workspace,
            settings=settings_instance,
            workspace_id=workspace_id,
            documents=docs,
        ),
    )


@router.get("/audit", response_model=AuditEventListResponse)
async def list_audit_events(
    limit: int = Query(default=50, ge=1, le=200),
    workspace: WorkspaceContext | None = Depends(
        require_enterprise_workspace_role(*ADMIN_ROLES)
    ),
    settings: Settings = Depends(get_settings),
) -> AuditEventListResponse:
    """Return recent sanitized audit events for the current workspace."""
    persist = _should_persist_workspace_event(workspace, settings)
    rows = await get_telemetry_recorder().list_audit_events(
        workspace_id=_context_workspace_id(workspace),
        persist=persist,
        limit=limit,
    )
    events = [AuditEventResponse(**row) for row in rows]
    return AuditEventListResponse(
        events=events,
        total=len(events),
        storage="supabase" if persist else "memory",
    )


@router.get("/status", response_model=SystemStatusResponse)
async def system_status(
    settings: Settings = Depends(get_settings),
    vs: VectorStoreManager = Depends(get_vector_store),
    supabase: SupabaseClient = Depends(get_supabase_client),
) -> SystemStatusResponse:
    """Operational status payload for dashboards and deployment smoke tests."""
    workspace_id = normalize_workspace_id(None)
    docs = vs.list_documents(workspace_id=workspace_id)
    cache: dict = {"hits": 0, "misses": 0, "entries": 0, "hit_rate": 0.0}
    try:
        from src.api.dependencies import get_rag_chain as _get_chain

        chain = _get_chain()
        cache = chain.cache_stats
        provider_health = getattr(chain.llm, "_router", None)
        provider_health_snapshot = (
            provider_health.health_snapshot() if provider_health is not None else []
        )
    except Exception:
        provider_health_snapshot = []

    data_api_reachable, data_api_status = await _probe_supabase_data_api(
        settings=settings,
        supabase=supabase,
    )
    service_status = "healthy" if data_api_reachable else "degraded"

    return SystemStatusResponse(
        status=service_status,
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
            "supabase_service_role_configured": (
                settings.supabase_service_role_configured
            ),
            "supabase_service_role_key_kind": settings.supabase_service_role_key_kind,
            "supabase_auth_configured": settings.supabase_auth_configured,
            "supabase_data_api_reachable": data_api_reachable,
            "supabase_data_api_status": data_api_status,
            "auth_required": settings.auth_required,
            "anonymous_demo_enabled": settings.enable_anonymous_demo,
            "qdrant_configured": settings.qdrant_configured,
            "enable_qdrant": settings.enable_qdrant,
            "qdrant_collection": settings.qdrant_collection,
            "vector_backend": (
                "qdrant+local_faiss"
                if settings.qdrant_configured and settings.enable_local_faiss
                else "qdrant"
                if settings.qdrant_configured
                else "local_faiss"
                if settings.enable_local_faiss
                else "unconfigured"
            ),
            "enable_pgvector_fallback": settings.enable_pgvector_fallback,
            "enable_local_faiss": settings.enable_local_faiss,
            "enable_async_ingestion": settings.enable_async_ingestion,
            "enforce_tenant_quotas": settings.enforce_tenant_quotas,
            "quota_daily_queries": settings.quota_daily_queries,
            "quota_daily_tokens": settings.quota_daily_tokens,
            "quota_max_documents": settings.quota_max_documents,
            "quota_max_storage_mb": settings.quota_max_storage_mb,
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
        provider_health=provider_health_snapshot,
    )
