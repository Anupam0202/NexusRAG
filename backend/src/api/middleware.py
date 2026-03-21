"""
FastAPI Middleware
==================

* **RequestLoggingMiddleware** — structured log for every request.
* **RateLimitMiddleware** — simple in-memory token-bucket rate limiter.
* Global exception handler that converts ``RAGException`` → JSON.
"""

from __future__ import annotations

import time
import uuid
from collections import defaultdict
from typing import Callable, Dict

import structlog
from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from src.utils.exceptions import RAGException
from src.utils.logger import get_logger

logger = get_logger("middleware")


# ── Request Logging ──────────────────────────────────────────────────────


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        request_id = str(uuid.uuid4())[:8]
        structlog.contextvars.clear_contextvars()
        structlog.contextvars.bind_contextvars(request_id=request_id)

        start = time.perf_counter()
        response = await call_next(request)
        elapsed = round(time.perf_counter() - start, 4)

        logger.info(
            "request",
            method=request.method,
            path=str(request.url.path),
            status=response.status_code,
            elapsed_s=elapsed,
        )
        response.headers["X-Request-ID"] = request_id
        return response


# ── Rate Limiter ─────────────────────────────────────────────────────────


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Simple per-IP token-bucket rate limiter."""

    def __init__(self, app: FastAPI, rpm: int = 60) -> None:
        super().__init__(app)
        self._rpm = rpm
        self._buckets: Dict[str, list] = defaultdict(list)

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        ip = request.client.host if request.client else "unknown"
        now = time.time()

        # Prune old entries
        self._buckets[ip] = [t for t in self._buckets[ip] if now - t < 60]

        if len(self._buckets[ip]) >= self._rpm:
            return JSONResponse(
                {"detail": "Rate limit exceeded. Try again in a moment."},
                status_code=429,
            )

        self._buckets[ip].append(now)
        return await call_next(request)


# ── Global Exception Handler ─────────────────────────────────────────────


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(RAGException)
    async def rag_exception_handler(request: Request, exc: RAGException) -> JSONResponse:
        logger.error("rag_exception", code=exc.code, message=exc.message)
        status = 429 if "RATE_LIMIT" in exc.code else 400
        return JSONResponse(exc.to_dict(), status_code=status)

    @app.exception_handler(Exception)
    async def generic_handler(request: Request, exc: Exception) -> JSONResponse:
        logger.error("unhandled_exception", error=str(exc), type=type(exc).__name__)
        return JSONResponse(
            {"code": "INTERNAL_ERROR", "message": "An internal error occurred."},
            status_code=500,
        )