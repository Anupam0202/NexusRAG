"""
FastAPI Application — Entry Point
===================================
"""

from __future__ import annotations

import os
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

# Build CORS origins list — always include common patterns
cors_origins = settings.cors_origins.copy()
# On Render, also accept the Render URL itself
render_url = os.environ.get("RENDER_EXTERNAL_URL", "")
if render_url and render_url not in cors_origins:
    cors_origins.append(render_url)
# On Railway, accept the Railway public domain
railway_domain = os.environ.get("RAILWAY_PUBLIC_DOMAIN", "")
if railway_domain:
    railway_url = f"https://{railway_domain}"
    if railway_url not in cors_origins:
        cors_origins.append(railway_url)
# Log the origins for debugging
logger.info("cors_origins_configured", origins=cors_origins)

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Request-ID"],
    max_age=86400,  # Cache preflight for 24h
)

register_exception_handlers(app)

# ── Root (Railway / Render health probe hits / with HEAD first) ───────────


@app.api_route("/", methods=["GET", "HEAD"], tags=["system"], include_in_schema=False)
async def root() -> dict:
    return {"service": "NexusRAG API", "status": "ok", "version": "1.0.0"}


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