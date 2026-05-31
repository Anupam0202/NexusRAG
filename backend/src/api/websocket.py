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
from src.utils.logger import get_logger
from src.utils.tenant import normalize_workspace_id

logger = get_logger("websocket")

router = APIRouter()


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

            try:
                async for frame in chain.stream(
                    question,
                    workspace_id=workspace_id,
                    session_id=session_id,
                    conversation_history=history_dicts,
                    top_k=data.get("top_k"),
                    use_reranking=data.get("use_reranking"),
                ):
                    if not await _safe_send(ws, frame):
                        # Client disconnected mid-stream — stop generating
                        logger.info("client_disconnected_mid_stream")
                        return
            except WebSocketDisconnect:
                logger.info("websocket_disconnected_during_stream")
                return
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
