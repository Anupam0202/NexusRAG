"""
Centralized Configuration via Pydantic Settings
================================================

All configuration is loaded from environment variables and/or .env file.
Every setting has a sensible default and is fully typed and validated.
"""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path
from typing import List, Optional

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings — loaded from environment variables / .env file.

    Attributes are grouped by subsystem for clarity. Every attribute has a
    default so the application can start with *only* GOOGLE_API_KEY set.
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ── LLM Provider ──────────────────────────────────────────────────────
    google_api_key: str = Field(
        default="",
        description="Google AI API key (required for Gemini models)",
    )
    llm_model_name: str = Field(
        default="gemini-2.0-flash",
        description="Primary LLM model identifier (gemini-2.0-flash has 1500 RPD free tier)",
    )
    llm_fallback_models: str = Field(
        default="gemini-2.5-flash,gemini-1.5-flash,gemini-1.5-pro",
        description="Comma-separated fallback model names",
    )
    llm_temperature: float = Field(default=0.1, ge=0.0, le=2.0)
    llm_max_tokens: int = Field(default=8192, ge=128, le=65536)
    llm_top_p: float = Field(default=0.95, ge=0.0, le=1.0)
    llm_top_k: int = Field(default=40, ge=1, le=100)

    # ── Embedding ─────────────────────────────────────────────────────────
    embedding_model: str = Field(
        default="sentence-transformers/all-MiniLM-L6-v2",
    )
    embedding_device: str = Field(default="cpu")
    embedding_batch_size: int = Field(default=64, ge=1)
    embedding_normalize: bool = Field(default=True)

    # ── Chunking ──────────────────────────────────────────────────────────
    chunk_size: int = Field(default=1000, ge=100, le=8000)
    chunk_overlap: int = Field(default=200, ge=0, le=2000)
    enable_semantic_chunking: bool = Field(default=True)
    enable_contextual_enrichment: bool = Field(default=True)
    min_chunk_length: int = Field(default=50, ge=10)
    chunk_separators: str = Field(
        default=r"\n\n\n|\n\n|\n|\.\ |!\ |\?\ |;\ |,\ |\ ",
        description="Pipe-separated regex separators for recursive splitting",
    )

    # ── Scientific Mode ───────────────────────────────────────────────
    enable_scientific_mode: bool = Field(
        default=True,
        description="Use advanced scientific parsing for PDFs (equations, figures, sections)",
    )
    scientific_output_dir: str = Field(default="data/scientific_output")
    enable_multimodal_embeddings: bool = Field(
        default=False,
        description="Generate CLIP embeddings for extracted figures (requires GPU)",
    )

    # ── Retrieval ─────────────────────────────────────────────────────────
    retrieval_top_k: int = Field(default=10, ge=1, le=100)
    similarity_threshold: float = Field(default=0.25, ge=0.0, le=1.0)
    hybrid_search_alpha: float = Field(
        default=0.6,
        ge=0.0,
        le=1.0,
        description="Weight for dense search. (1-alpha) for sparse.",
    )
    enable_reranking: bool = Field(default=True)
    rerank_model: str = Field(
        default="cross-encoder/ms-marco-MiniLM-L-6-v2",
    )
    rerank_top_k: int = Field(default=5, ge=1, le=50)

    # ── Vector Store ──────────────────────────────────────────────────────
    vector_store_path: str = Field(default="data/vector_store")

    # ── API ────────────────────────────────────────────────────────────────
    api_host: str = Field(default="0.0.0.0")
    api_port: int = Field(default=int(os.environ.get("PORT", "8000")), ge=1, le=65535)
    api_cors_origins: str = Field(
        default="http://localhost:3000,http://127.0.0.1:3000",
        description="Comma-separated allowed origins. Set to * for development.",
    )
    api_key: str = Field(
        default="",
        description="Optional API key to protect endpoints (empty = disabled)",
    )
    max_upload_size_mb: int = Field(default=100, ge=1, le=500)

    # ── Performance ───────────────────────────────────────────────────────
    enable_cache: bool = Field(default=True)
    cache_ttl_seconds: int = Field(default=3600, ge=60)
    max_concurrent_ingestions: int = Field(default=4, ge=1, le=16)

    # ── Context / Memory ──────────────────────────────────────────────────
    context_window_messages: int = Field(
        default=10,
        ge=1,
        le=50,
        description="Number of recent conversation turns to include",
    )
    max_context_chars: int = Field(default=6000, ge=500, le=50000)

    # ── Logging ───────────────────────────────────────────────────────────
    log_level: str = Field(default="INFO")
    log_format: str = Field(default="json", description="json | console")

    # ── Derived / Computed ────────────────────────────────────────────────

    @property
    def cors_origins(self) -> List[str]:
        """Parse comma-separated CORS origins into a list.

        Automatically includes the platform external URL if available
        (supports both Render and Railway).
        Supports wildcard '*' for development.
        """
        raw = [o.strip() for o in self.api_cors_origins.split(",") if o.strip()]
        if "*" in raw:
            return ["*"]
        # Auto-add Render external URL if set by the platform
        render_url = os.environ.get("RENDER_EXTERNAL_URL", "")
        if render_url and render_url not in raw:
            raw.append(render_url)
        # Auto-add Railway public domain if set by the platform
        railway_domain = os.environ.get("RAILWAY_PUBLIC_DOMAIN", "")
        if railway_domain:
            railway_url = f"https://{railway_domain}"
            if railway_url not in raw:
                raw.append(railway_url)
        return raw

    @property
    def fallback_models(self) -> List[str]:
        """Parse comma-separated fallback models into a list."""
        return [m.strip() for m in self.llm_fallback_models.split(",") if m.strip()]

    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_size_mb * 1024 * 1024

    @property
    def vector_store_dir(self) -> Path:
        p = Path(self.vector_store_path)
        p.mkdir(parents=True, exist_ok=True)
        return p

    @property
    def data_dir(self) -> Path:
        p = Path("data")
        p.mkdir(parents=True, exist_ok=True)
        return p

    @property
    def upload_dir(self) -> Path:
        p = self.data_dir / "uploads"
        p.mkdir(parents=True, exist_ok=True)
        return p

    @field_validator("chunk_overlap")
    @classmethod
    def overlap_less_than_size(cls, v: int, info) -> int:
        """Ensure overlap < chunk_size."""
        chunk_size = info.data.get("chunk_size", 1000)
        if v >= chunk_size:
            raise ValueError(
                f"chunk_overlap ({v}) must be less than chunk_size ({chunk_size})"
            )
        return v

    @field_validator("google_api_key")
    @classmethod
    def warn_empty_key(cls, v: str) -> str:
        if not v:
            import warnings
            warnings.warn(
                "GOOGLE_API_KEY is empty. LLM features will not work.",
                UserWarning,
                stacklevel=2,
            )
        return v

    # ── Supported file types ──────────────────────────────────────────────

    SUPPORTED_EXTENSIONS: dict[str, str] = {
        ".pdf": "pdf",
        ".docx": "docx",
        ".xlsx": "excel",
        ".xls": "excel",
        ".csv": "csv",
        ".txt": "text",
        ".md": "markdown",
        ".json": "json",
        ".png": "image",
        ".jpg": "image",
        ".jpeg": "image",
        ".gif": "image",
        ".webp": "image",
        ".bmp": "image",
        ".tiff": "image",
    }


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Singleton settings instance.

    Uses ``lru_cache`` so the .env file is read only once across the
    entire application lifetime.
    """
    return Settings()