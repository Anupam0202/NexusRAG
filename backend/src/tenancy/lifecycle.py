"""Fail-closed workspace retention and deletion orchestration."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any

from src.repositories.api_keys import ApiKeyRepository
from src.repositories.audit import AuditRepository
from src.repositories.billing import BillingRepository
from src.repositories.documents import DocumentRepository
from src.repositories.messages import MessageRepository
from src.repositories.provider_health import ProviderHealthRepository
from src.repositories.settings import WorkspaceSettingsRepository
from src.repositories.usage import UsageRepository
from src.repositories.workspaces import WorkspaceRepository
from src.utils.layered_cache import get_layered_cache
from src.utils.logger import get_logger

logger = get_logger(__name__)


@dataclass
class WorkspaceLifecycleResult:
    workspace_deleted: bool = False
    documents_deleted: int = 0
    chat_sessions_deleted: int = 0
    local_chunks_deleted: int = 0
    qdrant_chunks_deleted: int = 0
    failures: list[dict[str, str]] = field(default_factory=list)


class WorkspaceLifecycleService:
    def __init__(
        self,
        *,
        documents: DocumentRepository | None = None,
        workspaces: WorkspaceRepository | None = None,
        messages: MessageRepository | None = None,
        settings: WorkspaceSettingsRepository | None = None,
        api_keys: ApiKeyRepository | None = None,
        usage: UsageRepository | None = None,
        billing: BillingRepository | None = None,
        provider_health: ProviderHealthRepository | None = None,
        audit: AuditRepository | None = None,
        vector_store: Any | None = None,
        qdrant_store: Any | None = None,
    ) -> None:
        self._documents = documents or DocumentRepository()
        self._workspaces = workspaces or WorkspaceRepository()
        self._messages = messages or MessageRepository()
        self._settings = settings or WorkspaceSettingsRepository()
        self._api_keys = api_keys or ApiKeyRepository()
        self._usage = usage or UsageRepository()
        self._billing = billing or BillingRepository()
        self._provider_health = provider_health or ProviderHealthRepository()
        self._audit = audit or AuditRepository()
        self._vector_store = vector_store
        self._qdrant_store = qdrant_store

    async def apply_retention(
        self,
        *,
        workspace_id: str,
        retention_days: int,
    ) -> WorkspaceLifecycleResult:
        if retention_days < 1:
            raise ValueError("Retention days must be at least 1.")
        cutoff = datetime.now(UTC) - timedelta(days=retention_days)
        result = WorkspaceLifecycleResult()
        documents = await self._documents.list_documents(
            workspace_id=workspace_id,
            include_deleted=True,
        )
        for document in documents:
            created_at = self._parse_datetime(document.get("created_at"))
            if created_at and created_at < cutoff:
                await self._delete_document(workspace_id, document, result)
        result.chat_sessions_deleted = await self._messages.delete_sessions_before(
            workspace_id=workspace_id,
            created_before=cutoff.isoformat(),
        )
        return result

    async def delete_workspace(self, *, workspace_id: str) -> WorkspaceLifecycleResult:
        result = WorkspaceLifecycleResult()
        documents = await self._documents.list_documents(
            workspace_id=workspace_id,
            include_deleted=True,
        )
        for document in documents:
            await self._delete_document(workspace_id, document, result)
        if result.failures:
            return result
        await self._delete_workspace_rows(workspace_id, result)
        if result.failures:
            return result
        try:
            result.workspace_deleted = (
                await self._workspaces.delete_workspace(workspace_id=workspace_id)
            ) > 0
        except Exception as exc:
            message = str(exc)[:300]
            logger.warning(
                "workspace_lifecycle_workspace_delete_failed",
                workspace_id=workspace_id,
                error=message,
            )
            result.failures.append({"resource": "workspaces", "message": message})
            return result
        get_layered_cache().invalidate(workspace_id=workspace_id)
        return result

    async def _delete_workspace_rows(
        self,
        workspace_id: str,
        result: WorkspaceLifecycleResult,
    ) -> None:
        cleanup_steps = [
            ("chat_history", self._messages.delete_workspace_history),
            ("workspace_settings", self._settings.delete_settings),
            ("api_keys", self._api_keys.delete_workspace_keys),
            ("llm_usage_events", self._usage.delete_workspace_events),
            ("workspace_usage_daily", self._billing.delete_workspace_daily_usage),
            ("provider_health_state", self._provider_health.delete_workspace_state),
            ("audit_events", self._audit.detach_workspace_events),
        ]
        for resource, cleanup in cleanup_steps:
            try:
                deleted = int(await cleanup(workspace_id=workspace_id))
                if resource == "chat_history":
                    result.chat_sessions_deleted += deleted
            except Exception as exc:
                message = str(exc)[:300]
                logger.warning(
                    "workspace_lifecycle_workspace_cleanup_failed",
                    workspace_id=workspace_id,
                    resource=resource,
                    error=message,
                )
                result.failures.append({"resource": resource, "message": message})

    async def _delete_document(
        self,
        workspace_id: str,
        document: dict[str, Any],
        result: WorkspaceLifecycleResult,
    ) -> None:
        document_id = str(document.get("id") or "")
        if not document_id:
            result.failures.append({"document_id": "", "message": "Document row has no ID."})
            return
        try:
            storage_path = str(document.get("storage_path") or "")
            if storage_path:
                await self._documents.delete_original(
                    workspace_id=workspace_id,
                    document_id=document_id,
                    storage_path=storage_path,
                )
            if self._qdrant_store is not None:
                result.qdrant_chunks_deleted += int(
                    await self._qdrant_store.delete_document(
                        workspace_id=workspace_id,
                        document_id=document_id,
                    )
                )
            if self._vector_store is not None:
                result.local_chunks_deleted += int(
                    self._vector_store.delete_by_identifier(
                        document_id,
                        workspace_id=workspace_id,
                    )
                )
            await self._documents.delete_document_row(
                workspace_id=workspace_id,
                document_id=document_id,
            )
            get_layered_cache().invalidate(
                workspace_id=workspace_id,
                document_id=document_id,
            )
            result.documents_deleted += 1
        except Exception as exc:
            logger.warning(
                "workspace_lifecycle_document_cleanup_failed",
                workspace_id=workspace_id,
                document_id=document_id,
                error=str(exc)[:300],
            )
            result.failures.append({"document_id": document_id, "message": str(exc)[:300]})

    @staticmethod
    def _parse_datetime(value: Any) -> datetime | None:
        if isinstance(value, datetime):
            return value if value.tzinfo else value.replace(tzinfo=UTC)
        if isinstance(value, str) and value:
            try:
                parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
                return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)
            except ValueError:
                return None
        return None
