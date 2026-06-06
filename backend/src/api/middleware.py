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
from collections.abc import Callable

import structlog
from fastapi import FastAPI, Request, Response
from fastapi.exceptions import HTTPException
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from src.utils.exceptions import RAGException
from src.utils.logger import get_logger

logger = get_logger("middleware")


# ── Request Logging ──────────────────────────────────────────────────────


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        request_id = str(uuid.uuid4())[:8]
        request.state.request_id = request_id
        request.state.workspace_id = request.headers.get("X-Nexus-Workspace-Id")
        request.state.user_id = None
        structlog.contextvars.clear_contextvars()
        structlog.contextvars.bind_contextvars(request_id=request_id)

        start = time.perf_counter()
        response = await call_next(request)
        elapsed = round(time.perf_counter() - start, 4)
        route = getattr(request.scope.get("route"), "path", request.url.path)

        logger.info(
            "request",
            request_id=request_id,
            method=request.method,
            path=str(request.url.path),
            route=route,
            status_code=response.status_code,
            elapsed_s=elapsed,
            latency_ms=round(elapsed * 1000, 2),
            workspace_id=getattr(request.state, "workspace_id", None),
            user_id=getattr(request.state, "user_id", None),
            provider=getattr(request.state, "provider", None),
            model=getattr(request.state, "model", None),
            tokens=getattr(request.state, "tokens", None),
            fallback_reason=getattr(request.state, "fallback_reason", None),
            job_id=getattr(request.state, "job_id", None),
            document_id=getattr(request.state, "document_id", None),
        )
        response.headers["X-Request-ID"] = request_id
        response.headers["Server-Timing"] = f"app;dur={elapsed * 1000:.2f}"
        return response


# ── Rate Limiter ─────────────────────────────────────────────────────────


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Simple per-IP token-bucket rate limiter."""

    def __init__(self, app: FastAPI, rpm: int = 60) -> None:
        super().__init__(app)
        self._rpm = rpm
        self._buckets: dict[str, list] = defaultdict(list)

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        ip = request.client.host if request.client else "unknown"
        bucket_key = ip
        now = time.time()

        # Prune old entries
        self._buckets[bucket_key] = [t for t in self._buckets[bucket_key] if now - t < 60]

        if len(self._buckets[bucket_key]) >= self._rpm:
            return JSONResponse(
                {"detail": "Rate limit exceeded. Try again in a moment."},
                status_code=429,
                headers={"Retry-After": "60", "X-RateLimit-Limit": str(self._rpm)},
            )

        self._buckets[bucket_key].append(now)
        response = await call_next(request)
        response.headers["X-RateLimit-Limit"] = str(self._rpm)
        response.headers["X-RateLimit-Remaining"] = str(
            max(self._rpm - len(self._buckets[bucket_key]), 0)
        )
        return response


# ── Global Exception Handler ─────────────────────────────────────────────


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(HTTPException)
    async def http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
        return JSONResponse({"detail": exc.detail}, status_code=exc.status_code)

    @app.exception_handler(RAGException)
    async def rag_exception_handler(request: Request, exc: RAGException) -> JSONResponse:
        logger.error("rag_exception", code=exc.code, message=exc.message)
        status = 429 if "RATE_LIMIT" in exc.code else 400
        return JSONResponse(exc.to_dict(), status_code=status)

    @app.exception_handler(Exception)
    async def generic_handler(request: Request, exc: Exception) -> JSONResponse:
        if isinstance(exc, HTTPException):
            return JSONResponse({"detail": exc.detail}, status_code=exc.status_code)
        logger.error("unhandled_exception", error=str(exc), type=type(exc).__name__)
        return JSONResponse(
            {"code": "INTERNAL_ERROR", "message": "An internal error occurred."},
            status_code=500,
        )
