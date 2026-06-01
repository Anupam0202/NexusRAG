"""Workspace-scoped BYOK provider key handling.

This module intentionally keeps user supplied provider keys out of process
environment variables and out of global settings. Keys are encrypted before
they are kept in memory or optionally persisted to Supabase.
"""

from __future__ import annotations

import hashlib
import threading
from dataclasses import dataclass
from datetime import UTC, datetime
from functools import lru_cache

from cryptography.fernet import Fernet, InvalidToken

from config.settings import Settings, get_settings
from src.repositories.api_keys import ApiKeyRepository
from src.utils.logger import get_logger
from src.utils.tenant import DEFAULT_WORKSPACE_ID, normalize_workspace_id

logger = get_logger(__name__)

GEMINI_PROVIDER = "gemini"


def normalize_provider(provider: str | None) -> str:
    """Normalize provider ids used by routes, storage, and the LLM router."""
    value = (provider or GEMINI_PROVIDER).strip().lower()
    if value in {"google", "google-genai", "google_generative_ai"}:
        return GEMINI_PROVIDER
    return value


def key_fingerprint(api_key: str) -> str:
    """Return a stable non-secret fingerprint for cache/status labels."""
    return hashlib.sha256(api_key.strip().encode("utf-8")).hexdigest()


def key_label(api_key: str) -> str:
    """Return a non-secret display label for a provider key."""
    return f"sha256:{key_fingerprint(api_key)[:12]}"


@dataclass(frozen=True)
class StoredProviderKey:
    workspace_id: str
    user_id: str
    provider: str
    encrypted_key: str
    key_fingerprint: str
    key_label: str
    created_at: datetime


class ProviderKeyCrypto:
    """Encrypt and decrypt BYOK keys with a configured or ephemeral Fernet key."""

    def __init__(self, settings: Settings | None = None) -> None:
        self._settings = settings or get_settings()
        configured_key = self._settings.byok_encryption_key.strip()
        self.is_ephemeral = not configured_key
        raw_key = configured_key.encode("utf-8") if configured_key else Fernet.generate_key()
        try:
            self._fernet = Fernet(raw_key)
        except Exception:
            logger.warning("invalid_byok_encryption_key_using_ephemeral")
            self.is_ephemeral = True
            self._fernet = Fernet(Fernet.generate_key())

    def encrypt(self, api_key: str) -> str:
        return self._fernet.encrypt(api_key.strip().encode("utf-8")).decode("utf-8")

    def decrypt(self, encrypted_key: str) -> str:
        try:
            return self._fernet.decrypt(encrypted_key.encode("utf-8")).decode("utf-8")
        except InvalidToken as exc:
            raise ValueError("Stored provider key cannot be decrypted.") from exc


class ScopedProviderKeyManager:
    """Workspace-scoped provider key store and resolver.

    The in-memory store keeps Render demo behavior fast and dependency-light.
    Enterprise deployments can additionally persist encrypted metadata to
    Supabase through ``persist_key``.
    """

    def __init__(self, settings: Settings | None = None) -> None:
        self._settings = settings or get_settings()
        self._crypto = ProviderKeyCrypto(self._settings)
        self._lock = threading.RLock()
        self._keys: dict[tuple[str, str], StoredProviderKey] = {}

    def store_key(
        self,
        *,
        workspace_id: str | None,
        user_id: str | None,
        provider: str,
        api_key: str,
    ) -> StoredProviderKey:
        scoped_workspace = normalize_workspace_id(workspace_id)
        normalized_provider = normalize_provider(provider)
        record = StoredProviderKey(
            workspace_id=scoped_workspace,
            user_id=user_id or DEFAULT_WORKSPACE_ID,
            provider=normalized_provider,
            encrypted_key=self._crypto.encrypt(api_key),
            key_fingerprint=key_fingerprint(api_key),
            key_label=key_label(api_key),
            created_at=datetime.now(UTC),
        )
        with self._lock:
            self._keys[(scoped_workspace, normalized_provider)] = record
        logger.info(
            "workspace_provider_key_stored",
            workspace_id=scoped_workspace,
            provider=normalized_provider,
            storage="memory",
        )
        return record

    def get_key(self, *, workspace_id: str | None, provider: str) -> str | None:
        record = self.describe(workspace_id=workspace_id, provider=provider)
        if not record:
            return None
        return self._crypto.decrypt(record.encrypted_key)

    def describe(
        self,
        *,
        workspace_id: str | None,
        provider: str,
    ) -> StoredProviderKey | None:
        scoped_workspace = normalize_workspace_id(workspace_id)
        normalized_provider = normalize_provider(provider)
        with self._lock:
            return self._keys.get((scoped_workspace, normalized_provider))

    def has_active_key(self, *, workspace_id: str | None, provider: str) -> bool:
        return self.describe(workspace_id=workspace_id, provider=provider) is not None

    def remove_key(self, *, workspace_id: str | None, provider: str) -> StoredProviderKey | None:
        scoped_workspace = normalize_workspace_id(workspace_id)
        normalized_provider = normalize_provider(provider)
        with self._lock:
            return self._keys.pop((scoped_workspace, normalized_provider), None)

    def effective_api_key(
        self,
        *,
        workspace_id: str | None,
        provider: str,
        settings: Settings | None = None,
    ) -> str:
        if normalize_provider(provider) != GEMINI_PROVIDER:
            return ""
        workspace_key = self.get_key(workspace_id=workspace_id, provider=provider)
        if workspace_key:
            return workspace_key
        return (settings or self._settings).google_api_key

    def status_payload(
        self,
        *,
        workspace_id: str | None,
        provider: str,
        settings: Settings | None = None,
    ) -> dict:
        normalized_provider = normalize_provider(provider)
        record = self.describe(workspace_id=workspace_id, provider=normalized_provider)
        active = record is not None
        return {
            "provider": normalized_provider,
            "workspace_id": normalize_workspace_id(workspace_id),
            "workspace_key_configured": active,
            "server_key_configured": bool((settings or self._settings).google_api_key),
            "key_fingerprint": record.key_label if record else None,
            "created_at": record.created_at.isoformat() if record else None,
            "storage": "memory",
        }

    async def persist_key(self, record: StoredProviderKey) -> None:
        """Persist encrypted key metadata to Supabase when enterprise storage is enabled."""
        repo = ApiKeyRepository()
        await repo.deactivate_active_keys(
            workspace_id=record.workspace_id,
            user_id=record.user_id,
            provider=record.provider,
        )
        await repo.store_encrypted_key(
            workspace_id=record.workspace_id,
            user_id=record.user_id,
            provider=record.provider,
            encrypted_key=record.encrypted_key,
            key_prefix=record.key_label,
        )

    async def persist_delete_key(
        self,
        *,
        workspace_id: str,
        user_id: str | None,
        provider: str,
    ) -> list[dict]:
        repo = ApiKeyRepository()
        return await repo.deactivate_active_keys(
            workspace_id=normalize_workspace_id(workspace_id),
            user_id=user_id or DEFAULT_WORKSPACE_ID,
            provider=normalize_provider(provider),
        )

    def clear(self) -> None:
        with self._lock:
            self._keys.clear()


@lru_cache(maxsize=1)
def get_provider_key_manager() -> ScopedProviderKeyManager:
    return ScopedProviderKeyManager()
