"""
Custom Exception Hierarchy
==========================

Every exception carries a machine-readable ``code`` and an optional
``details`` dict so that API error responses are consistent and debuggable.
"""

from __future__ import annotations

from typing import Any, Dict, Optional


class RAGException(Exception):
    """Base exception for the NexusRAG system.

    Args:
        message: Human-readable description.
        code: Machine-readable error code (e.g. ``DOCUMENT_LOAD_ERROR``).
        details: Arbitrary structured data for debugging.
    """

    def __init__(
        self,
        message: str = "An internal error occurred",
        code: str = "RAG_ERROR",
        details: Optional[Dict[str, Any]] = None,
    ) -> None:
        self.message = message
        self.code = code
        self.details = details or {}
        super().__init__(self.message)

    def to_dict(self) -> Dict[str, Any]:
        return {"code": self.code, "message": self.message, "details": self.details}


# ── Ingestion Errors ──────────────────────────────────────────────────────

class DocumentLoadError(RAGException):
    """Raised when a document cannot be loaded or parsed."""

    def __init__(self, message: str = "Failed to load document", **kw: Any) -> None:
        super().__init__(message, code="DOCUMENT_LOAD_ERROR", **kw)


class ChunkingError(RAGException):
    """Raised when document chunking fails."""

    def __init__(self, message: str = "Chunking failed", **kw: Any) -> None:
        super().__init__(message, code="CHUNKING_ERROR", **kw)


class EmbeddingError(RAGException):
    """Raised when embedding generation fails."""

    def __init__(self, message: str = "Embedding generation failed", **kw: Any) -> None:
        super().__init__(message, code="EMBEDDING_ERROR", **kw)


# ── Retrieval Errors ──────────────────────────────────────────────────────

class RetrievalError(RAGException):
    """Raised when retrieval from the vector store fails."""

    def __init__(self, message: str = "Retrieval failed", **kw: Any) -> None:
        super().__init__(message, code="RETRIEVAL_ERROR", **kw)


class VectorStoreError(RAGException):
    """Raised for vector store operations (add/delete/search)."""

    def __init__(self, message: str = "Vector store error", **kw: Any) -> None:
        super().__init__(message, code="VECTOR_STORE_ERROR", **kw)


# ── Generation Errors ─────────────────────────────────────────────────────

class GenerationError(RAGException):
    """Raised when LLM generation fails."""

    def __init__(self, message: str = "Generation failed", **kw: Any) -> None:
        super().__init__(message, code="GENERATION_ERROR", **kw)


class RateLimitError(GenerationError):
    """Raised when an LLM provider rate-limits the request."""

    def __init__(self, message: str = "Rate limit exceeded", **kw: Any) -> None:
        super().__init__(message, **kw)
        self.code = "RATE_LIMIT_ERROR"


# ── Configuration / Auth Errors ───────────────────────────────────────────

class ConfigurationError(RAGException):
    """Raised for invalid or missing configuration."""

    def __init__(self, message: str = "Configuration error", **kw: Any) -> None:
        super().__init__(message, code="CONFIGURATION_ERROR", **kw)


class AuthenticationError(RAGException):
    """Raised when API authentication fails."""

    def __init__(self, message: str = "Authentication failed", **kw: Any) -> None:
        super().__init__(message, code="AUTHENTICATION_ERROR", **kw)