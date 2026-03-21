"""
Structured Logging with structlog
==================================

Provides JSON (production) or pretty-printed (development) log output.
Every log entry includes timestamp, log level, logger name, and any
bound context (request_id, session_id, etc.).
"""

from __future__ import annotations

import logging
import sys
from functools import lru_cache
from typing import Any

import structlog

from config.settings import get_settings


def _configure_structlog() -> None:
    """One-time structlog configuration.  Called lazily on first ``get_logger``."""

    settings = get_settings()
    is_json = settings.log_format.lower() == "json"

    shared_processors: list[Any] = [
        structlog.contextvars.merge_contextvars,
        structlog.stdlib.add_logger_name,
        structlog.stdlib.add_log_level,
        structlog.stdlib.PositionalArgumentsFormatter(),
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.UnicodeDecoder(),
    ]

    if is_json:
        renderer = structlog.processors.JSONRenderer()
    else:
        renderer = structlog.dev.ConsoleRenderer(colors=True)

    structlog.configure(
        processors=[
            *shared_processors,
            structlog.stdlib.ProcessorFormatter.wrap_for_formatter,
        ],
        logger_factory=structlog.stdlib.LoggerFactory(),
        wrapper_class=structlog.stdlib.BoundLogger,
        cache_logger_on_first_use=True,
    )

    formatter = structlog.stdlib.ProcessorFormatter(
        processors=[
            structlog.stdlib.ProcessorFormatter.remove_processors_meta,
            renderer,
        ],
    )

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(formatter)

    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(getattr(logging, settings.log_level.upper(), logging.INFO))

    # Quiet noisy third-party loggers
    for name in ("httpx", "httpcore", "urllib3", "faiss", "sentence_transformers"):
        logging.getLogger(name).setLevel(logging.WARNING)


_configured = False


@lru_cache(maxsize=128)
def get_logger(name: str | None = None) -> structlog.stdlib.BoundLogger:
    """Get a structured logger, configuring structlog on first call.

    Args:
        name: Logger name (typically ``__name__``).

    Returns:
        A bound structlog logger.
    """
    global _configured
    if not _configured:
        _configure_structlog()
        _configured = True

    return structlog.get_logger(name or "contextual_rag")