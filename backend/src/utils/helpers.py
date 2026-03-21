"""
General-Purpose Helper Utilities
================================

Pure functions with no side effects. Used across the codebase.
"""

from __future__ import annotations

import hashlib
import re
import time
from datetime import datetime
from functools import wraps
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, TypeVar

from src.utils.logger import get_logger

logger = get_logger(__name__)

T = TypeVar("T")


# ── File Helpers ──────────────────────────────────────────────────────────


def file_hash(content: bytes) -> str:
    """Return the SHA-256 hex digest of raw bytes (first 16 chars)."""
    return hashlib.sha256(content).hexdigest()[:16]


def format_file_size(size_bytes: int) -> str:
    """Human-readable file size string."""
    for unit in ("B", "KB", "MB", "GB"):
        if size_bytes < 1024:
            return f"{size_bytes:.1f} {unit}"
        size_bytes /= 1024
    return f"{size_bytes:.1f} TB"


def get_file_extension(filename: str) -> str:
    """Return lowercased file extension including the dot."""
    return Path(filename).suffix.lower()


# ── Text Helpers ──────────────────────────────────────────────────────────


def clean_text(text: str) -> str:
    """Normalize whitespace, fix encoding artifacts, strip control chars."""
    if not text:
        return ""

    replacements = {
        "\u2018": "'", "\u2019": "'",
        "\u201c": '"', "\u201d": '"',
        "\u2013": "-", "\u2014": "--",
        "\u2026": "...",
        "\u200b": "",   # zero-width space
        "\xa0": " ",    # non-breaking space
    }
    for old, new in replacements.items():
        text = text.replace(old, new)

    # Remove control characters except newline / tab
    text = "".join(ch for ch in text if ord(ch) >= 32 or ch in "\n\t")

    # Collapse multiple whitespace (but preserve paragraph breaks)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)

    return text.strip()


def truncate(text: str, max_len: int = 500, suffix: str = "…") -> str:
    """Truncate text to *max_len* characters, appending *suffix*."""
    if len(text) <= max_len:
        return text
    return text[: max_len - len(suffix)] + suffix


def word_count(text: str) -> int:
    return len(text.split())


# ── Timing Decorator ─────────────────────────────────────────────────────


def timed(func: Callable[..., T]) -> Callable[..., T]:
    """Decorator that logs execution time of sync functions."""

    @wraps(func)
    def wrapper(*args: Any, **kwargs: Any) -> T:
        start = time.perf_counter()
        try:
            result = func(*args, **kwargs)
            return result
        finally:
            elapsed = time.perf_counter() - start
            level = "warning" if elapsed > 5.0 else "debug"
            getattr(logger, level)(
                "function_executed",
                function=func.__name__,
                elapsed_seconds=round(elapsed, 4),
            )

    return wrapper


def async_timed(func: Callable) -> Callable:
    """Decorator that logs execution time of async functions."""

    @wraps(func)
    async def wrapper(*args: Any, **kwargs: Any) -> Any:
        start = time.perf_counter()
        try:
            result = await func(*args, **kwargs)
            return result
        finally:
            elapsed = time.perf_counter() - start
            level = "warning" if elapsed > 5.0 else "debug"
            getattr(logger, level)(
                "async_function_executed",
                function=func.__name__,
                elapsed_seconds=round(elapsed, 4),
            )

    return wrapper


# ── Formatting Helpers ────────────────────────────────────────────────────


def format_value(value: Any) -> str:
    """Format a cell value for text representation (Excel/CSV rows)."""
    import pandas as pd

    if pd.isna(value):
        return "N/A"
    if isinstance(value, float):
        return str(int(value)) if value == int(value) else f"{value:,.2f}"
    if isinstance(value, (datetime,)):
        return value.strftime("%Y-%m-%d")
    try:
        import pandas as pd
        if isinstance(value, pd.Timestamp):
            return value.strftime("%Y-%m-%d")
    except Exception:
        pass
    return str(value)


def build_metadata(
    file_path: Path,
    *,
    extra: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Build standard metadata dict for a file."""
    stat = file_path.stat() if file_path.exists() else None
    meta: Dict[str, Any] = {
        "source": str(file_path),
        "filename": file_path.name,
        "file_extension": file_path.suffix.lower(),
    }
    if stat:
        meta["file_size_bytes"] = stat.st_size
        meta["modified_time"] = datetime.fromtimestamp(stat.st_mtime).isoformat()
    if extra:
        meta.update(extra)
    return meta