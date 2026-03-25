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
import traceback

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from starlette.websockets import WebSocketState

from src.api.dependencies import get_rag_chain
from src.utils.logger import get_logger

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


@router.websocket("/ws/chat")
async def chat_stream(ws: WebSocket) -> None:
    await ws.accept()
    chain = get_rag_chain()
    logger.info("websocket_connected")

    try:
        while True:
            raw = await ws.receive_text()
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                await _safe_send(ws, {"type": "error", "content": "Invalid JSON"})
                continue

            question = data.get("question", "").strip()
            if not question:
                await _safe_send(ws, {"type": "error", "content": "Empty question"})
                continue

            session_id = data.get("session_id", "ws-default")
            history = data.get("conversation_history", [])
            history_dicts = (
                [{"role": m["role"], "content": m["content"]} for m in history]
                if history
                else None
            )

            try:
                async for frame in chain.stream(
                    question,
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
                is_quota = any(kw in err_msg.lower() for kw in (
                    "429", "quota", "rate limit", "resource_exhausted", "resource exhausted"
                ))
                logger.error("stream_error", error=err_msg, is_quota=is_quota)
                if is_quota:
                    await _safe_send(ws, {
                        "type": "error",
                        "content": "API quota exceeded. Please provide your own Google API key to continue.",
                        "error_code": "QUOTA_EXCEEDED",
                    })
                else:
                    await _safe_send(ws, {"type": "error", "content": err_msg})

    except WebSocketDisconnect:
        logger.info("websocket_disconnected")
    except Exception as exc:
        logger.error("websocket_fatal", error=str(exc))