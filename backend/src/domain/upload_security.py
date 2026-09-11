"""Deterministic upload and archive controls for private evidence objects."""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import PurePosixPath
import hashlib
import re

MAX_OBJECT_BYTES = 25_000_000
MAX_ARCHIVE_FILES = 2_000
MAX_ARCHIVE_EXPANDED_BYTES = 250_000_000
MAX_ARCHIVE_RATIO = 100
MAX_SIGNED_DOWNLOAD_SECONDS = 900

ALLOWED_MEDIA_TYPES = frozenset({
    "application/pdf",
    "application/json",
    "application/zip",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "text/csv",
    "text/html",
    "text/markdown",
    "text/plain",
    "image/jpeg",
    "image/png",
    "image/webp",
})

_MAGIC = (
    (b"%PDF-", "application/pdf"),
    (b"PK\x03\x04", "application/zip"),
    (b"\x89PNG\r\n\x1a\n", "image/png"),
    (b"\xff\xd8\xff", "image/jpeg"),
    (b"RIFF", "image/webp"),
)
_UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", re.I)


@dataclass(frozen=True, slots=True)
class UploadPreflight:
    filename: str
    declared_media_type: str
    byte_size: int

    def validate(self) -> None:
        if not self.filename or len(self.filename) > 255 or any(c in self.filename for c in "\x00\r\n"):
            raise ValueError("INVALID_FILENAME")
        if self.declared_media_type not in ALLOWED_MEDIA_TYPES:
            raise ValueError("UNSUPPORTED_MEDIA_TYPE")
        if not 1 <= self.byte_size <= MAX_OBJECT_BYTES:
            raise ValueError("UPLOAD_LIMIT_EXCEEDED")


@dataclass(frozen=True, slots=True)
class ArchiveManifest:
    compressed_bytes: int
    expanded_bytes: int
    file_count: int
    member_paths: tuple[str, ...]

    def validate(self) -> None:
        if not 1 <= self.compressed_bytes <= MAX_OBJECT_BYTES:
            raise ValueError("ARCHIVE_COMPRESSED_LIMIT")
        if not 1 <= self.file_count <= MAX_ARCHIVE_FILES:
            raise ValueError("ARCHIVE_FILE_COUNT_LIMIT")
        if not 1 <= self.expanded_bytes <= MAX_ARCHIVE_EXPANDED_BYTES:
            raise ValueError("ARCHIVE_EXPANSION_LIMIT")
        if self.expanded_bytes > self.compressed_bytes * MAX_ARCHIVE_RATIO:
            raise ValueError("ARCHIVE_RATIO_LIMIT")
        if len(self.member_paths) != self.file_count:
            raise ValueError("ARCHIVE_MANIFEST_MISMATCH")
        for member in self.member_paths:
            path = PurePosixPath(member)
            if not member or path.is_absolute() or ".." in path.parts or "\\" in member or "\x00" in member:
                raise ValueError("ARCHIVE_UNSAFE_PATH")


def sniff_media_type(prefix: bytes) -> str:
    for magic, media_type in _MAGIC:
        if prefix.startswith(magic):
            if media_type == "image/webp" and prefix[8:12] != b"WEBP":
                break
            return media_type
    sample = prefix[:4096]
    if sample and b"\x00" not in sample:
        try:
            text = sample.decode("utf-8").lstrip()
        except UnicodeDecodeError:
            pass
        else:
            if text.startswith(("{", "[")):
                return "application/json"
            if text.lower().startswith(("<!doctype html", "<html")):
                return "text/html"
            return "text/plain"
    raise ValueError("UNRECOGNIZED_MEDIA_TYPE")


def require_media_match(declared: str, sniffed: str) -> None:
    compatible_text = declared in {"text/csv", "text/markdown", "text/plain"} and sniffed == "text/plain"
    office_zip = declared.startswith("application/vnd.openxmlformats-officedocument.") and sniffed == "application/zip"
    if declared != sniffed and not compatible_text and not office_zip:
        raise ValueError("MEDIA_TYPE_MISMATCH")


def server_object_key(workspace_id: str, document_id: str, version_id: str) -> str:
    values = (workspace_id, document_id, version_id)
    if not all(_UUID.fullmatch(value) for value in values):
        raise ValueError("INVALID_OBJECT_IDENTITY")
    return f"{workspace_id.lower()}/{document_id.lower()}/{version_id.lower()}/original"


def signed_download_ttl(requested_seconds: int) -> int:
    if requested_seconds <= 0:
        raise ValueError("INVALID_DOWNLOAD_TTL")
    return min(requested_seconds, MAX_SIGNED_DOWNLOAD_SECONDS)


def content_receipt(payload: bytes) -> tuple[str, int]:
    return hashlib.sha256(payload).hexdigest(), len(payload)
