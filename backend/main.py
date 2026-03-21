"""
FastAPI Application — Entry Point
===================================
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config.settings import get_settings
from src.api.middleware import (
    RateLimitMiddleware,
    RequestLoggingMiddleware,
    register_exception_handlers,
)
from src.utils.logger import get_logger

logger = get_logger("main")
settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    logger.info(
        "application_starting",
        model=settings.llm_model_name,
        embedding=settings.embedding_model,
    )
    # Pre-warm heavy singletons
    from src.api.dependencies import get_rag_chain, get_vector_store

    get_vector_store()
    logger.info("vector_store_ready")

    # Only initialise LLM if API key is present
    if settings.google_api_key:
        try:
            get_rag_chain()
            logger.info("rag_chain_ready")
        except Exception as exc:
            logger.warning("rag_chain_init_deferred", error=str(exc))
    else:
        logger.warning("no_api_key — LLM features disabled until key is provided")

    logger.info("application_ready", port=settings.api_port)
    yield
    logger.info("application_shutdown")


app = FastAPI(
    title="NexusRAG API",
    version="1.0.0",
    description="NexusRAG — Enterprise Document Intelligence Platform powered by RAG",
    lifespan=lifespan,
)

# ── Middleware (order matters — outermost first) ──────────────────────────

app.add_middleware(RequestLoggingMiddleware)
app.add_middleware(RateLimitMiddleware, rpm=120)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

register_exception_handlers(app)

# ── Health ────────────────────────────────────────────────────────────────


@app.get("/health", tags=["system"])
async def health() -> dict:
    from src.api.dependencies import get_vector_store

    vs = get_vector_store()
    return {
        "status": "healthy",
        "version": "1.0.0",
        "total_chunks": vs.total_chunks,
    }


# ── Mount Routers ─────────────────────────────────────────────────────────

from src.api.routes import router as api_router  # noqa: E402
from src.api.websocket import router as ws_router  # noqa: E402

app.include_router(api_router, prefix="/api/v1")
app.include_router(ws_router)