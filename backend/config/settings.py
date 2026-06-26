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

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


def _first_env(*names: str) -> str:
    """Return the first non-empty environment value from a list of aliases."""
    for name in names:
        value = os.environ.get(name, "").strip()
        if value:
            return value
    return ""


def _supabase_jwks_url(project_url: str) -> str:
    clean = project_url.rstrip("/")
    return f"{clean}/auth/v1/.well-known/jwks.json" if clean else ""


def supabase_service_role_key_kind(service_role_key: str, anon_key: str = "") -> str:
    """Return a non-secret category for the configured server-side Supabase key."""
    key = service_role_key.strip()
    if not key:
        return "missing"
    if anon_key and key == anon_key.strip():
        return "matches_anon_key"
    if key.startswith("sb_publishable_"):
        return "publishable_key"
    if key.startswith("sb_secret_"):
        return "secret_key"
    if key.startswith("sb_"):
        return "unsupported_key"
    return "legacy_service_role_key"


def valid_supabase_service_role_key(service_role_key: str, anon_key: str = "") -> bool:
    """True only for keys that can safely be used by trusted backend code."""
    return supabase_service_role_key_kind(service_role_key, anon_key) in {
        "secret_key",
        "legacy_service_role_key",
    }


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
        default="gemini-2.5-flash",
        description="Primary LLM model identifier",
    )
    llm_fallback_models: str = Field(
        default="gemini-2.5-flash-lite,gemini-2.0-flash,gemini-2.0-flash-lite",
        description="Comma-separated fallback model names",
    )
    llm_temperature: float = Field(default=0.1, ge=0.0, le=2.0)
    llm_max_tokens: int = Field(default=8192, ge=128, le=65536)
    llm_top_p: float = Field(default=0.95, ge=0.0, le=1.0)
    llm_top_k: int = Field(default=40, ge=1, le=100)
    llm_input_cost_usd_per_million: float = Field(
        default=0.0,
        ge=0.0,
        description="Configured estimated input-token cost used for billing reconciliation",
    )
    llm_output_cost_usd_per_million: float = Field(
        default=0.0,
        ge=0.0,
        description="Configured estimated output-token cost used for billing reconciliation",
    )
    byok_encryption_key: str = Field(
        default="",
        description=(
            "Optional Fernet key used to encrypt workspace BYOK provider keys. "
            "If unset, keys are encrypted with an ephemeral process key and are not durable."
        ),
    )

    # ── Embedding ─────────────────────────────────────────────────────────
    embedding_model: str = Field(
        default="sentence-transformers/all-MiniLM-L6-v2",
    )
    embedding_device: str = Field(default="cpu")
    embedding_batch_size: int = Field(default=64, ge=1)
    embedding_normalize: bool = Field(default=True)
    enable_lightweight_embeddings: bool = Field(
        default=False,
        description="Use deterministic hash embeddings instead of local transformer models",
    )

    # ── Chunking ──────────────────────────────────────────────────────────
    chunk_size: int = Field(default=1000, ge=100, le=8000)
    chunk_overlap: int = Field(default=200, ge=0, le=2000)
    enable_semantic_chunking: bool = Field(default=True)
    enable_contextual_enrichment: bool = Field(default=True)
    min_chunk_length: int = Field(default=50, ge=10)
    chunk_separators: str = Field(
        default=r"\n\n\n|\n\n|\n|\. |! |\? |; |, | ",
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
    enable_query_expansion: bool = Field(
        default=True,
        description="Use LLM-generated query variants for broader retrieval recall",
    )

    # ── Vector Store ──────────────────────────────────────────────────────
    vector_store_path: str = Field(default="data/vector_store")
    enable_qdrant: bool = Field(default=False)
    qdrant_url: str = Field(default="", description="Qdrant cluster URL")
    qdrant_api_key: str = Field(default="", description="Qdrant API key")
    qdrant_collection: str = Field(default="nexusrag_chunks")
    enable_pgvector_fallback: bool = Field(
        default=False,
        description="Use Supabase pgvector when Qdrant is unavailable",
    )
    enable_local_faiss: bool = Field(
        default=True,
        description="Allow local FAISS fallback for development and anonymous demo mode",
    )

    # ── Supabase / Enterprise Persistence ─────────────────────────────────
    supabase_url: str = Field(default="", description="Supabase project URL")
    supabase_anon_key: str = Field(default="", description="Supabase browser anon key")
    supabase_service_role_key: str = Field(
        default="",
        description="Supabase service role key for trusted backend operations",
    )
    supabase_jwt_secret: str = Field(
        default="",
        description="Legacy Supabase JWT secret. Prefer JWKS for hosted projects.",
    )
    supabase_jwks_url: str = Field(
        default="",
        description="Supabase JWKS URL for verifying access tokens",
    )
    supabase_storage_bucket: str = Field(default="documents")
    enable_anonymous_demo: bool = Field(
        default=False,
        description="Allow a local anonymous workspace only when explicitly enabled",
    )

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
    max_pdf_pages: int = Field(
        default=40,
        ge=1,
        le=500,
        description="Maximum PDF pages accepted by the upload endpoint",
    )
    max_pdf_ocr_pages: int = Field(
        default=12,
        ge=0,
        le=200,
        description="Maximum low-text PDF pages that can be OCR processed",
    )
    pdf_ocr_dpi: int = Field(
        default=150,
        ge=72,
        le=300,
        description="DPI used when rendering PDF pages for OCR",
    )
    enable_pdf_embedded_image_ocr: bool = Field(
        default=True,
        description="OCR embedded images in PDFs when enough memory is available",
    )
    enable_docx_embedded_image_ocr: bool = Field(
        default=True,
        description="OCR embedded images in DOCX files when enough memory is available",
    )
    max_pdf_embedded_images: int = Field(
        default=8,
        ge=0,
        le=200,
        description="Maximum embedded PDF images to OCR per upload",
    )
    max_docx_embedded_images: int = Field(
        default=8,
        ge=0,
        le=200,
        description="Maximum embedded DOCX images to OCR per upload",
    )
    max_image_megapixels: int = Field(
        default=25,
        ge=1,
        le=200,
        description="Maximum standalone image size accepted for OCR",
    )

    # ── Performance ───────────────────────────────────────────────────────
    enable_cache: bool = Field(default=True)
    cache_ttl_seconds: int = Field(default=3600, ge=60)
    max_concurrent_ingestions: int = Field(default=4, ge=1, le=16)
    enable_async_ingestion: bool = Field(
        default=False,
        description="Return upload requests immediately and process ingestion in background tasks",
    )

    # ── Tenant Quotas ─────────────────────────────────────────────────────────
    enforce_tenant_quotas: bool = Field(
        default=True,
        description="Enforce workspace query, token, document, and storage budgets.",
    )
    quota_daily_queries: int = Field(default=1000, ge=0)
    quota_daily_tokens: int = Field(default=250_000, ge=0)
    quota_max_documents: int = Field(default=100, ge=0)
    quota_max_storage_mb: int = Field(default=1024, ge=0)

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
    def cors_origins(self) -> list[str]:
        """Parse comma-separated CORS origins into a list.

        Automatically includes the Render external URL if available
        (set by the platform as RENDER_EXTERNAL_URL).
        Supports wildcard '*' for development.
        """
        raw = [o.strip() for o in self.api_cors_origins.split(",") if o.strip()]
        if "*" in raw:
            return ["*"]
        # Auto-add Render external URL if set by the platform
        render_url = os.environ.get("RENDER_EXTERNAL_URL", "")
        if render_url and render_url not in raw:
            raw.append(render_url)
        return raw

    @property
    def fallback_models(self) -> list[str]:
        """Parse comma-separated fallback models into a list."""
        return [m.strip() for m in self.llm_fallback_models.split(",") if m.strip()]

    @property
    def supabase_configured(self) -> bool:
        return bool(
            self.supabase_url
            and self.supabase_anon_key
            and self.supabase_service_role_configured
        )

    @property
    def supabase_service_role_key_kind(self) -> str:
        return supabase_service_role_key_kind(
            self.supabase_service_role_key,
            self.supabase_anon_key,
        )

    @property
    def supabase_service_role_configured(self) -> bool:
        return valid_supabase_service_role_key(
            self.supabase_service_role_key,
            self.supabase_anon_key,
        )

    @property
    def supabase_auth_configured(self) -> bool:
        return bool(self.supabase_jwks_url or self.supabase_jwt_secret)

    @property
    def auth_required(self) -> bool:
        return (
            bool(self.supabase_url)
            and self.supabase_auth_configured
            and not self.enable_anonymous_demo
        )

    @property
    def qdrant_configured(self) -> bool:
        return bool(self.enable_qdrant and self.qdrant_url and self.qdrant_api_key)

    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_size_mb * 1024 * 1024

    @property
    def max_image_pixels(self) -> int:
        return self.max_image_megapixels * 1_000_000

    @property
    def memory_constrained(self) -> bool:
        return (
            os.environ.get("CONSTRAINED_MEMORY", "").lower() == "true"
            or os.environ.get("DISABLE_CROSS_ENCODER", "").lower() == "true"
            or os.environ.get("ENABLE_LIGHTWEIGHT_EMBEDDINGS", "").lower() == "true"
        )

    @property
    def use_lightweight_embeddings(self) -> bool:
        return self.enable_lightweight_embeddings or self.memory_constrained

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

    @model_validator(mode="after")
    def normalize_supabase_aliases(self) -> Settings:
        """Accept env names emitted by Vercel's native Supabase integration.

        Render does not inherit Vercel integration variables automatically, but
        when operators mirror them into Render the names may be either the
        canonical backend names or Vercel's public/secret aliases.
        """
        if not self.supabase_url:
            self.supabase_url = _first_env("NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL")
        if not self.supabase_anon_key:
            self.supabase_anon_key = _first_env(
                "SUPABASE_ANON_KEY",
                "SUPABASE_PUBLISHABLE_KEY",
                "NEXT_PUBLIC_SUPABASE_ANON_KEY",
                "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
            )
        # Supabase secret keys are the current server-side credential format.
        # Prefer them over a legacy service_role JWT when both were mirrored
        # into a deployment, so stale legacy credentials cannot silently route
        # persistence to a different project.
        modern_secret_key = _first_env("SUPABASE_SECRET_KEY")
        if modern_secret_key:
            self.supabase_service_role_key = modern_secret_key
        elif not self.supabase_service_role_key:
            self.supabase_service_role_key = _first_env("SUPABASE_SERVICE_ROLE_KEY")
        if not self.supabase_jwks_url:
            self.supabase_jwks_url = _supabase_jwks_url(self.supabase_url)
        return self

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
        ".tif": "image",
        ".tiff": "image",
    }


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Singleton settings instance.

    Uses ``lru_cache`` so the .env file is read only once across the
    entire application lifetime.
    """
    return Settings()
