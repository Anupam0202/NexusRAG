"""Supabase-backed repository boundaries for enterprise persistence."""

from src.repositories.api_keys import ApiKeyRepository
from src.repositories.audit import AuditRepository
from src.repositories.billing import BillingRepository
from src.repositories.chunks import ChunkRepository
from src.repositories.documents import (
    DocumentRepository,
    compute_sha256,
    document_storage_path,
)
from src.repositories.jobs import IngestionJobRepository
from src.repositories.messages import MessageRepository
from src.repositories.provider_health import (
    ProviderHealthRepository,
    persist_provider_health_snapshot,
)
from src.repositories.settings import WorkspaceSettingsRepository
from src.repositories.usage import UsageRepository
from src.repositories.workspaces import WorkspaceRepository

__all__ = [
    "ApiKeyRepository",
    "AuditRepository",
    "BillingRepository",
    "ChunkRepository",
    "DocumentRepository",
    "IngestionJobRepository",
    "MessageRepository",
    "ProviderHealthRepository",
    "persist_provider_health_snapshot",
    "UsageRepository",
    "WorkspaceRepository",
    "WorkspaceSettingsRepository",
    "compute_sha256",
    "document_storage_path",
]
