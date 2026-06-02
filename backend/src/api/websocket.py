"""
WebSocket Streaming Endpoint
==============================

Accepts a JSON message with the query, streams back tokens + sources
+ metadata as JSON frames.

Protocol::

    Client → Server (JSON):
        {"question": "...", "session_id": "...", "conversation_history": [...]}

    Server → Client (JSON, multiple frames):
        {"type": "token",   "content": "Some text..."}
        {"type": "sources", "sources": [...]}
        {"type": "done",    "metadata": {...}}
        {"type": "error",   "content": "Error message"}
"""

from __future__ import annotations

import json
import uuid
from asyncio import wait_for

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect, status
from starlette.websockets import WebSocketState

from config.settings import get_settings
from src.api.auth import (
    WorkspaceContext,
    authenticate_supabase_token,
    resolve_workspace_context,
)
from src.api.dependencies import get_rag_chain
from src.infrastructure.supabase_client import get_supabase_client
from src.repositories.messages import MessageRepository
from src.telemetry.events import estimate_tokens, get_telemetry_recorder
from src.tenancy.quotas import QuotaExceededError, TenantQuotaEnforcer
from src.utils.logger import get_logger
from src.utils.tenant import normalize_workspace_id

logger = get_logger("websocket")

router = APIRouter()


def _valid_chat_session_id(session_id: str | None) -> str | None:
    if not session_id:
        return str(uuid.uuid4())
    try:
        uuid.UUID(str(session_id))
    except ValueError:
        return None
    return str(session_id)


def _chat_title(question: str) -> str:
    title = " ".join(question.split())
    return (title[:77] + "...") if len(title) > 80 else title


def _stream_retrieval_filters(data: dict) -> dict:
    filters: dict = {}
    raw_ids = data.get("document_ids") or []
    if data.get("chat_scope") == "documents" or raw_ids:
        document_ids = [
            str(item).strip()
            for item in (raw_ids if isinstance(raw_ids, list) else [raw_ids])
            if str(item).strip()
        ]
        if document_ids:
            filters["document_ids"] = sorted(set(document_ids))
    filename = str(data.get("filename") or "").strip()
    if filename:
        filters["filename"] = filename
    uploaded_by = str(data.get("uploaded_by") or "").strip()
    if uploaded_by:
        filters["uploaded_by"] = uploaded_by
    for key in ("min_page", "max_page"):
        try:
            if data.get(key) is not None:
                filters[key] = int(data[key])
        except (TypeError, ValueError):
            continue
    return filters


async def _persist_stream_history(
    *,
    workspace: WorkspaceContext | None,
    workspace_id: str,
    persist: bool,
    session_id: str | None,
    question: str,
    answer: str,
    sources: list[dict],
    metadata: dict,
) -> str | None:
    if not persist:
        return session_id

    durable_session_id = _valid_chat_session_id(session_id)
    if durable_session_id is None:
        logger.warning(
            "stream_chat_history_invalid_session_id",
            workspace_id=workspace_id,
            session_id=session_id,
        )
        return session_id

    try:
        repo = MessageRepository()
        await repo.ensure_session(
            workspace_id=workspace_id,
            session_id=durable_session_id,
            user_id=workspace.user.id if workspace else None,
            title=_chat_title(question),
        )
        await repo.add_message(
            workspace_id=workspace_id,
            session_id=durable_session_id,
            role="user",
            content=question,
            metadata={"source": "chat_ws"},
        )
        await repo.add_message(
            workspace_id=workspace_id,
            session_id=durable_session_id,
            role="assistant",
            content=answer,
            sources=sources,
            metadata={
                "source": "chat_ws",
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
            "stream_chat_history_persist_failed",
            workspace_id=workspace_id,
            session_id=durable_session_id,
            error=str(exc)[:300],
        )
        return session_id
    return durable_session_id


async def _safe_send(ws: WebSocket, data: dict) -> bool:
    """Send JSON to WebSocket only if still connected. Returns False if send failed."""
    try:
        if ws.client_state == WebSocketState.CONNECTED:
            await ws.send_json(data)
            return True
    except Exception:
        pass
    return False


async def _authenticate_workspace_socket(
    workspace_id: str | None,
    access_token: str | None,
) -> WorkspaceContext | None:
    settings = get_settings()
    if not settings.auth_required:
        return None

    token = (access_token or "").strip()
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing Supabase access token.",
        )

    user = authenticate_supabase_token(token, settings)
    return await resolve_workspace_context(user, workspace_id, get_supabase_client())


async def _receive_workspace_auth(ws: WebSocket) -> WorkspaceContext | None:
    settings = get_settings()
    if not settings.auth_required:
        return None

    try:
        raw = await wait_for(ws.receive_text(), timeout=10)
        data = json.loads(raw)
    except TimeoutError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication frame timed out.",
        ) from exc
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Authentication frame must be valid JSON.",
        ) from exc

    if data.get("type") != "auth":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication is required before chat messages.",
        )

    return await _authenticate_workspace_socket(
        str(data.get("workspace_id") or "").strip() or None,
        str(data.get("access_token") or "").strip() or None,
    )


@router.websocket("/ws/chat")
async def chat_stream(ws: WebSocket) -> None:
    await ws.accept()
    try:
        workspace = await _receive_workspace_auth(ws)
    except HTTPException as exc:
        await _safe_send(
            ws,
            {
                "type": "error",
                "content": exc.detail,
                "error_code": "AUTH_REQUIRED",
            },
        )
        await ws.close(code=1008)
        return

    try:
        chain = get_rag_chain()
    except Exception:
        await _safe_send(
            ws,
            {
                "type": "error",
                "content": (
                    "Service unavailable - API key not configured. "
                    "Please provide your Google API key."
                ),
                "error_code": "QUOTA_EXCEEDED",
            },
        )
        await ws.close(code=1011)
        return
    logger.info(
        "websocket_connected",
        workspace_id=workspace.workspace_id if workspace else None,
    )
    workspace_id = normalize_workspace_id(workspace.workspace_id if workspace else None)
    settings = get_settings()
    persist_event = bool(
        workspace
        and not workspace.user.is_demo
        and settings.supabase_configured
    )
    telemetry = get_telemetry_recorder()

    try:
        while True:
            raw = await ws.receive_text()
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                await _safe_send(ws, {"type": "error", "content": "Invalid JSON"})
                continue

            if data.get("type") == "auth":
                continue

            question = data.get("question", "").strip()
            if not question:
                await _safe_send(ws, {"type": "error", "content": "Empty question"})
                continue

            session_id = data.get("session_id", "ws-default")
            history = data.get("conversation_history", [])
            history_dicts = (
                [{"role": m["role"], "content": m["content"]} for m in history] if history else None
            )
            history_token_parts = [
                str(m.get("content", "")) for m in history if isinstance(m, dict)
            ]
            retrieval_filters = _stream_retrieval_filters(data)
            estimated_input_tokens = estimate_tokens(question, *history_token_parts)
            answer_parts: list[str] = []
            sources_count = 0
            sources_payload: list[dict] = []
            done_metadata: dict = {}

            try:
                quota_usage = await TenantQuotaEnforcer(settings).usage(
                    workspace_id=workspace_id,
                    persist=persist_event,
                )
                TenantQuotaEnforcer(settings).assert_chat_allowed(
                    quota_usage,
                    estimated_tokens=estimated_input_tokens,
                )
                async for frame in chain.stream(
                    question,
                    workspace_id=workspace_id,
                    session_id=session_id,
                    conversation_history=history_dicts,
                    top_k=data.get("top_k"),
                    use_reranking=data.get("use_reranking"),
                    retrieval_filters=retrieval_filters or None,
                ):
                    if frame.get("type") == "token":
                        answer_parts.append(str(frame.get("content", "")))
                    elif frame.get("type") == "sources":
                        raw_sources = frame.get("sources", []) or []
                        sources_payload = raw_sources if isinstance(raw_sources, list) else []
                        sources_count = len(sources_payload)
                    elif frame.get("type") == "done":
                        done_metadata = dict(frame.get("metadata", {}) or {})
                    if not await _safe_send(ws, frame):
                        # Client disconnected mid-stream — stop generating
                        logger.info("client_disconnected_mid_stream")
                        return
                cache_hit = bool(done_metadata.get("from_cache"))
                generation_fallback = bool(done_metadata.get("generation_fallback"))
                latency_ms = int(
                    float(done_metadata.get("response_time_seconds", 0.0) or 0.0) * 1000
                )
                await telemetry.record_llm_usage(
                    workspace_id=workspace_id,
                    user_id=workspace.user.id if workspace else None,
                    model=str(done_metadata.get("model") or settings.llm_model_name),
                    operation="chat.stream",
                    input_tokens=(
                        0 if cache_hit else estimate_tokens(question, *history_token_parts)
                    ),
                    output_tokens=0 if cache_hit else estimate_tokens("".join(answer_parts)),
                    latency_ms=latency_ms,
                    success=True,
                    error_code=(
                        "cache_hit"
                        if cache_hit
                        else "generation_fallback" if generation_fallback else None
                    ),
                    persist=persist_event,
                )
                await telemetry.record_audit_event(
                    workspace_id=workspace_id,
                    user_id=workspace.user.id if workspace else None,
                    action="chat.stream",
                    resource_type="chat_session",
                    resource_id=str(session_id),
                    metadata={
                        "question_chars": len(question),
                        "history_messages": len(history or []),
                        "top_k": data.get("top_k"),
                        "use_reranking": data.get("use_reranking"),
                        "chat_scope": data.get("chat_scope", "workspace"),
                        "retrieval_filters": retrieval_filters,
                        "query_type": done_metadata.get("query_type", "general"),
                        "source_count": sources_count or done_metadata.get("num_sources", 0),
                        "cache_hit": cache_hit,
                        "generation_fallback": generation_fallback,
                        "latency_ms": latency_ms,
                    },
                    persist=persist_event,
                )
                persisted_session_id = await _persist_stream_history(
                    workspace=workspace,
                    workspace_id=workspace_id,
                    persist=persist_event,
                    session_id=str(session_id),
                    question=question,
                    answer="".join(answer_parts),
                    sources=sources_payload,
                    metadata=done_metadata,
                )
                done_metadata["session_id"] = persisted_session_id or session_id
            except WebSocketDisconnect:
                logger.info("websocket_disconnected_during_stream")
                return
            except QuotaExceededError as exc:
                await telemetry.record_audit_event(
                    workspace_id=workspace_id,
                    user_id=workspace.user.id if workspace else None,
                    action="quota.chat_stream_blocked",
                    resource_type="chat_session",
                    resource_id=str(session_id),
                    metadata={"reason": str(exc), "quota": exc.payload},
                    persist=persist_event,
                )
                await _safe_send(
                    ws,
                    {
                        "type": "error",
                        "content": str(exc),
                        "error_code": "QUOTA_EXCEEDED",
                    },
                )
            except Exception as exc:
                err_msg = str(exc)
                if not err_msg:
                    err_msg = type(exc).__name__ or "Unknown error"
                is_quota = any(
                    kw in err_msg.lower()
                    for kw in (
                        "429",
                        "quota",
                        "rate limit",
                        "resource_exhausted",
                        "resource exhausted",
                    )
                )
                logger.error("stream_error", error=err_msg, is_quota=is_quota)
                await telemetry.record_llm_usage(
                    workspace_id=workspace_id,
                    user_id=workspace.user.id if workspace else None,
                    model=settings.llm_model_name,
                    operation="chat.stream",
                    input_tokens=estimate_tokens(question, *history_token_parts),
                    output_tokens=0,
                    latency_ms=0,
                    success=False,
                    error_code="quota" if is_quota else type(exc).__name__,
                    persist=persist_event,
                )
                await telemetry.record_audit_event(
                    workspace_id=workspace_id,
                    user_id=workspace.user.id if workspace else None,
                    action="chat.stream_failed",
                    resource_type="chat_session",
                    resource_id=str(session_id),
                    metadata={
                        "question_chars": len(question),
                        "history_messages": len(history or []),
                        "top_k": data.get("top_k"),
                        "use_reranking": data.get("use_reranking"),
                        "error": err_msg[:200],
                    },
                    persist=persist_event,
                )
                if is_quota:
                    await _safe_send(
                        ws,
                        {
                            "type": "error",
                            "content": (
                                "API quota exceeded. Please provide your own "
                                "Google API key to continue."
                            ),
                            "error_code": "QUOTA_EXCEEDED",
                        },
                    )
                else:
                    await _safe_send(ws, {"type": "error", "content": err_msg})

    except WebSocketDisconnect:
        logger.info("websocket_disconnected")
    except Exception as exc:
        logger.error("websocket_fatal", error=str(exc))
