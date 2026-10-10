"""
FastAPI Middleware
==================

* **RequestLoggingMiddleware** — structured log for every request.
* **RateLimitMiddleware** — bounded per-process sliding-window rate limiter.
* Global exception handler that converts ``RAGException`` → JSON.
"""

from __future__ import annotations

import time
import uuid
from collections import OrderedDict, deque
from collections.abc import Callable
from math import ceil

import structlog
from fastapi import FastAPI, Request, Response
from fastapi.exceptions import HTTPException, RequestValidationError
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
    """Bounded per-IP sliding window; not a distributed quota authority."""

    def __init__(
        self,
        app: FastAPI,
        rpm: int = 60,
        *,
        max_clients: int = 10_000,
        clock: Callable[[], float] | None = None,
    ) -> None:
        if rpm < 1 or max_clients < 1:
            raise ValueError("Rate and tracked-client capacity must be positive.")
        super().__init__(app)
        self._rpm = rpm
        self._max_clients = max_clients
        self._clock = clock or time.monotonic
        # Sorted by the last admitted request, not by untrusted headers or
        # denied-request traffic. Idle clients are removed without a full scan.
        self._buckets: OrderedDict[str, deque[float]] = OrderedDict()

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        ip = request.client.host if request.client else "unknown"
        now = self._clock()
        cutoff = now - 60
        while self._buckets:
            oldest = next(iter(self._buckets.values()))
            if oldest[-1] > cutoff:
                break
            self._buckets.popitem(last=False)

        bucket = self._buckets.get(ip)
        if bucket is None:
            if len(self._buckets) >= self._max_clients:
                # Never evict a live client's history to admit a new IP: that
                # would let address churn bypass limits and grow memory.
                oldest = next(iter(self._buckets.values()))
                return JSONResponse(
                    {
                        "detail": "Rate-limit tracking capacity reached. Retry later.",
                        "code": "RATE_LIMIT_CAPACITY_REACHED",
                    },
                    status_code=429,
                    headers={
                        "Retry-After": str(max(1, ceil(oldest[-1] + 60 - now))),
                        "X-RateLimit-Limit": str(self._rpm),
                    },
                )
            bucket = deque()
            self._buckets[ip] = bucket
        while bucket and bucket[0] <= cutoff:
            bucket.popleft()
        if len(bucket) >= self._rpm:
            return JSONResponse(
                {"detail": "Rate limit exceeded. Try again in a moment."},
                status_code=429,
                headers={
                    "Retry-After": str(max(1, ceil(bucket[0] + 60 - now))),
                    "X-RateLimit-Limit": str(self._rpm),
                },
            )

        # No await between admission checks and reservation.
        bucket.append(now)
        self._buckets.move_to_end(ip)
        response = await call_next(request)
        response.headers["X-RateLimit-Limit"] = str(self._rpm)
        response.headers["X-RateLimit-Remaining"] = str(max(self._rpm - len(bucket), 0))
        return response


# ── Global Exception Handler ─────────────────────────────────────────────


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        # Pydantic errors include submitted inputs, unknown-field names and
        # validator context. All may contain credentials or private content.
        # Do not reflect or log them, including for malformed JSON requests.
        return JSONResponse(
            {"detail": "Invalid request. Check the entered fields."},
            status_code=422,
        )

    @app.exception_handler(HTTPException)
    async def http_exception_handler(
        request: Request, exc: HTTPException
    ) -> JSONResponse:
        return JSONResponse({"detail": exc.detail}, status_code=exc.status_code)

    @app.exception_handler(RAGException)
    async def rag_exception_handler(
        request: Request, exc: RAGException
    ) -> JSONResponse:
        logger.error("rag_exception", code=exc.code, type=type(exc).__name__)
        status = 429 if "RATE_LIMIT" in exc.code else 400
        return JSONResponse(exc.to_dict(), status_code=status)

    @app.exception_handler(Exception)
    async def generic_handler(request: Request, exc: Exception) -> JSONResponse:
        if isinstance(exc, HTTPException):
            return JSONResponse({"detail": exc.detail}, status_code=exc.status_code)
        # Arbitrary provider/SQL error text may contain keys or document content.
        logger.error("unhandled_exception", type=type(exc).__name__)
        return JSONResponse(
            {"code": "INTERNAL_ERROR", "message": "An internal error occurred."},
            status_code=500,
        )
