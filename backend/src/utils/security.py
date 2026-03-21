"""
Security Utilities
==================

Input sanitisation (anti-prompt-injection), file validation, and
PII redaction.  Merged and improved from REPO-B's ``InputSanitizer``
and ``FileValidator`` with additions for enterprise use.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from src.utils.logger import get_logger

logger = get_logger(__name__)


# ── Input Sanitisation ────────────────────────────────────────────────────


@dataclass(frozen=True)
class SanitisationResult:
    """Immutable result of input sanitisation."""

    text: str
    is_safe: bool
    warnings: Tuple[str, ...] = ()


class InputSanitizer:
    """Prevent prompt injection, XSS, and other input attacks.

    Usage::

        result = InputSanitizer.sanitize(user_input)
        if not result.is_safe:
            logger.warning("unsafe input", warnings=result.warnings)
        safe_text = result.text
    """

    MAX_LENGTH: int = 10_000
    MAX_CHAR_REPEAT: int = 50

    _DANGEROUS_PATTERNS: List[Tuple[re.Pattern[str], str]] = [
        # Instruction overrides
        (re.compile(r"ignore\s+(all\s+)?previous\s+instructions?", re.I), "instruction_override"),
        (re.compile(r"disregard\s+(all\s+)?above", re.I), "instruction_override"),
        (re.compile(r"forget\s+(everything|all)", re.I), "context_manipulation"),
        # System prompt exposure
        (re.compile(r"(show|reveal|output|repeat)\s+(your\s+)?(system\s+)?(prompt|instructions)", re.I), "prompt_exposure"),
        # Credential extraction
        (re.compile(r"(api|access)\s*key", re.I), "credential_extraction"),
        # XSS / code injection
        (re.compile(r"<script[\s>]", re.I), "xss_attempt"),
        (re.compile(r"javascript:", re.I), "xss_attempt"),
        (re.compile(r"(eval|exec)\s*\(", re.I), "code_injection"),
        # SQL injection
        (re.compile(r"'\s*(OR|AND)\s*'?\d*'?\s*=\s*'?\d", re.I), "sql_injection"),
        (re.compile(r";?\s*DROP\s+TABLE", re.I), "sql_injection"),
        # Role manipulation
        (re.compile(r"you\s+are\s+now\s+(a\s+)?(developer|admin|root)", re.I), "role_manipulation"),
        (re.compile(r"(enter|switch\s+to)\s+(developer|admin|debug)\s+mode", re.I), "mode_manipulation"),
    ]

    _DANGEROUS_UNICODE = frozenset(
        "\u200b\u200c\u200d\u202a\u202b\u202c\u202d\u202e\ufeff"
    )

    @classmethod
    def sanitize(cls, text: str, *, strict: bool = False) -> SanitisationResult:
        """Sanitise arbitrary user text.

        Args:
            text: Raw user input.
            strict: If *True*, return empty text on any suspicion.

        Returns:
            ``SanitisationResult`` with cleaned text and warnings.
        """
        if not text or not text.strip():
            return SanitisationResult(text="", is_safe=False, warnings=("Empty input",))

        warnings: List[str] = []
        is_safe = True

        # Length
        if len(text) > cls.MAX_LENGTH:
            text = text[: cls.MAX_LENGTH]
            warnings.append(f"Truncated to {cls.MAX_LENGTH} chars")

        # Dangerous patterns
        for pattern, threat in cls._DANGEROUS_PATTERNS:
            if pattern.search(text):
                warnings.append(f"Potential {threat}")
                is_safe = False
                if strict:
                    return SanitisationResult(text="", is_safe=False, warnings=tuple(warnings))

        # Control characters
        text = "".join(ch for ch in text if ord(ch) >= 32 or ch in "\n\t\r")

        # Dangerous unicode
        text = "".join(ch for ch in text if ch not in cls._DANGEROUS_UNICODE)

        # Excessive repetition
        text = cls._reduce_repetition(text)

        # Normalise whitespace
        text = " ".join(text.split())

        return SanitisationResult(text=text, is_safe=is_safe, warnings=tuple(warnings))

    @classmethod
    def sanitize_for_prompt(cls, text: str) -> str:
        """Sanitise specifically for insertion into an LLM prompt."""
        result = cls.sanitize(text)
        if not result.is_safe:
            logger.warning("input_sanitized", warnings=result.warnings)
        return result.text

    @classmethod
    def _reduce_repetition(cls, text: str) -> str:
        result: List[str] = []
        prev_char: Optional[str] = None
        count = 0
        for ch in text:
            if ch == prev_char:
                count += 1
                if count <= cls.MAX_CHAR_REPEAT:
                    result.append(ch)
            else:
                prev_char = ch
                count = 1
                result.append(ch)
        return "".join(result)


# ── PII Redaction ─────────────────────────────────────────────────────────

_PII_PATTERNS: List[Tuple[re.Pattern[str], str]] = [
    (re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b"), "[EMAIL]"),
    (re.compile(r"\b\d{3}[-.]?\d{3}[-.]?\d{4}\b"), "[PHONE]"),
    (re.compile(r"\b\d{3}-\d{2}-\d{4}\b"), "[SSN]"),
    (re.compile(r"\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b"), "[CARD]"),
]


def redact_pii(text: str) -> str:
    """Replace common PII patterns with redaction tokens."""
    for pattern, replacement in _PII_PATTERNS:
        text = pattern.sub(replacement, text)
    return text


# ── File Validation ───────────────────────────────────────────────────────


class FileValidator:
    """Validate uploaded files before processing."""

    @staticmethod
    def validate(
        filename: str,
        content: bytes,
        *,
        allowed_extensions: Optional[set[str]] = None,
        max_size_bytes: int = 100 * 1024 * 1024,
    ) -> Tuple[bool, str]:
        """Validate a file by name, content, and size.

        Returns:
            ``(is_valid, message)`` tuple.
        """
        from config.settings import get_settings

        settings = get_settings()

        if allowed_extensions is None:
            allowed_extensions = set(settings.SUPPORTED_EXTENSIONS.keys())

        ext = Path(filename).suffix.lower()
        if ext not in allowed_extensions:
            return False, f"Unsupported file type: {ext}"

        if len(content) == 0:
            return False, "File is empty"

        if len(content) > max_size_bytes:
            size_mb = len(content) / (1024 * 1024)
            limit_mb = max_size_bytes / (1024 * 1024)
            return False, f"File too large ({size_mb:.1f} MB > {limit_mb:.0f} MB limit)"

        # PDF magic bytes check
        if ext == ".pdf" and not content[:5] == b"%PDF-":
            return False, "Invalid PDF file (bad magic bytes)"

        return True, "Valid"

    @staticmethod
    def sanitize_filename(filename: str) -> str:
        """Remove dangerous characters from filename."""
        name = Path(filename).name
        name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "", name)
        name = name.replace(" ", "_")
        if not name or name.startswith("."):
            name = f"upload_{name}"
        return name[:255]