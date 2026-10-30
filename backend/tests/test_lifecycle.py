from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from fastapi import HTTPException

from config.settings import Settings
from src.api import routes
from src.api.auth import CurrentUser, WorkspaceContext, WorkspaceRole
from src.tenancy.lifecycle import WorkspaceLifecycleService
from src.tenancy.retention_scheduler import RetentionScheduler


class FakeDocuments:
    def __init__(self, *, fail_storage: bool = False) -> None:
        self.fail_storage = fail_storage
        self.deleted_rows: list[str] = []
        self.documents = [
            {
                "id": "doc-old",
                "workspace_id": "workspace-1",
                "storage_path": "workspace-1/doc-old/old.txt",
                "created_at": (datetime.now(UTC) - timedelta(days=40)).isoformat(),
            },
            {
                "id": "doc-new",
                "workspace_id": "workspace-1",
                "storage_path": "workspace-1/doc-new/new.txt",
                "created_at": datetime.now(UTC).isoformat(),
            },
        ]

    async def list_documents(self, *, workspace_id: str, include_deleted: bool = False):
        assert workspace_id == "workspace-1"
        assert include_deleted is True
        return self.documents

    async def delete_original(self, *, workspace_id: str, document_id: str, storage_path: str):
        if self.fail_storage:
            raise RuntimeError("storage unavailable")

    async def delete_document_row(self, *, workspace_id: str, document_id: str):
        self.deleted_rows.append(document_id)
        return 1


class FakeWorkspaces:
    def __init__(self, *, fail_delete: bool = False) -> None:
        self.deleted = 0
        self.fail_delete = fail_delete

    async def delete_workspace(self, *, workspace_id: str):
        if self.fail_delete:
            raise RuntimeError("workspace foreign key blocked")
        self.deleted += 1
        return 1


class FakeMessages:
    def __init__(self) -> None:
        self.cutoffs: list[str] = []
        self.deleted_workspaces: list[str] = []

    async def delete_sessions_before(self, *, workspace_id: str, created_before: str):
        self.cutoffs.append(created_before)
        return 2

    async def delete_workspace_history(self, *, workspace_id: str):
        self.deleted_workspaces.append(workspace_id)
        return 3


class FakeWorkspaceScopedCleanup:
    def __init__(self, *, fail: bool = False) -> None:
        self.fail = fail
        self.deleted_workspaces: list[str] = []

    async def delete_settings(self, *, workspace_id: str):
        self.deleted_workspaces.append(workspace_id)
        if self.fail:
            raise RuntimeError("settings unavailable")
        return 1

    async def delete_workspace_keys(self, *, workspace_id: str):
        self.deleted_workspaces.append(workspace_id)
        return 1

    async def delete_workspace_events(self, *, workspace_id: str):
        self.deleted_workspaces.append(workspace_id)
        return 1

    async def delete_workspace_daily_usage(self, *, workspace_id: str):
        self.deleted_workspaces.append(workspace_id)
        return 1

    async def delete_workspace_state(self, *, workspace_id: str):
        self.deleted_workspaces.append(workspace_id)
        return 1

    async def detach_workspace_events(self, *, workspace_id: str):
        self.deleted_workspaces.append(workspace_id)
        return 1


class FakeVectorStore:
    def __init__(self) -> None:
        self.deleted: list[str] = []

    def delete_by_identifier(self, identifier: str, *, workspace_id: str):
        self.deleted.append(identifier)
        return 1


class FakeRetentionSettings:
    def __init__(self) -> None:
        self.updated: list[tuple[str, dict[str, str]]] = []

    async def claim_due_retention(self, *, worker_id: str, limit: int, lease_seconds: int):
        assert worker_id == "retention-worker"
        assert limit == 10
        assert lease_seconds == 900
        return [
            {
                "workspace_id": "workspace-1",
                "retention_lease_owner": "retention-worker",
                "retention_lease_expires_at": "2099-01-01T00:00:00+00:00",
                "retention_enabled": True,
                "retention_days": 30,
            },
            {
                "workspace_id": "workspace-disabled",
                "retention_enabled": False,
                "retention_days": 7,
            },
        ]

    async def finish_retention_claim(self, *, workspace_id, **claim):
        self.updated.append((workspace_id, claim))
        return True

    async def upsert_settings(self, *, workspace_id: str, values: dict[str, str]):
        self.updated.append((workspace_id, values))
        return {**values, "workspace_id": workspace_id}


class FakeLifecycle:
    def __init__(self) -> None:
        self.runs: list[tuple[str, int]] = []

    async def apply_retention(self, *, workspace_id: str, retention_days: int):
        self.runs.append((workspace_id, retention_days))
        return type(
            "Result",
            (),
            {"documents_deleted": 2, "chat_sessions_deleted": 1, "failures": []},
        )()


@pytest.mark.asyncio
async def test_retention_purges_only_expired_workspace_data() -> None:
    documents = FakeDocuments()
    messages = FakeMessages()
    vectors = FakeVectorStore()
    service = WorkspaceLifecycleService(
        documents=documents,  # type: ignore[arg-type]
        workspaces=FakeWorkspaces(),  # type: ignore[arg-type]
        messages=messages,  # type: ignore[arg-type]
        vector_store=vectors,
    )

    result = await service.apply_retention(workspace_id="workspace-1", retention_days=30)

    assert result.documents_deleted == 1
    assert result.chat_sessions_deleted == 2
    assert documents.deleted_rows == ["doc-old"]
    assert vectors.deleted == ["doc-old"]
    assert result.failures == []


@pytest.mark.asyncio
async def test_workspace_deletion_fails_closed_when_storage_cleanup_fails() -> None:
    documents = FakeDocuments(fail_storage=True)
    workspaces = FakeWorkspaces()
    service = WorkspaceLifecycleService(
        documents=documents,  # type: ignore[arg-type]
        workspaces=workspaces,  # type: ignore[arg-type]
        messages=FakeMessages(),  # type: ignore[arg-type]
        vector_store=FakeVectorStore(),
    )

    result = await service.delete_workspace(workspace_id="workspace-1")

    assert result.workspace_deleted is False
    assert result.failures
    assert workspaces.deleted == 0


@pytest.mark.asyncio
async def test_workspace_deletion_cleans_workspace_scoped_rows_before_workspace_row() -> None:
    documents = FakeDocuments()
    documents.documents = []
    workspaces = FakeWorkspaces()
    messages = FakeMessages()
    settings = FakeWorkspaceScopedCleanup()
    api_keys = FakeWorkspaceScopedCleanup()
    usage = FakeWorkspaceScopedCleanup()
    billing = FakeWorkspaceScopedCleanup()
    provider_health = FakeWorkspaceScopedCleanup()
    audit = FakeWorkspaceScopedCleanup()
    service = WorkspaceLifecycleService(
        documents=documents,  # type: ignore[arg-type]
        workspaces=workspaces,  # type: ignore[arg-type]
        messages=messages,  # type: ignore[arg-type]
        settings=settings,  # type: ignore[arg-type]
        api_keys=api_keys,  # type: ignore[arg-type]
        usage=usage,  # type: ignore[arg-type]
        billing=billing,  # type: ignore[arg-type]
        provider_health=provider_health,  # type: ignore[arg-type]
        audit=audit,  # type: ignore[arg-type]
    )

    result = await service.delete_workspace(workspace_id="workspace-1")

    assert result.workspace_deleted is True
    assert result.failures == []
    assert messages.deleted_workspaces == ["workspace-1"]
    assert settings.deleted_workspaces == ["workspace-1"]
    assert api_keys.deleted_workspaces == ["workspace-1"]
    assert usage.deleted_workspaces == ["workspace-1"]
    assert billing.deleted_workspaces == ["workspace-1"]
    assert provider_health.deleted_workspaces == ["workspace-1"]
    assert audit.deleted_workspaces == ["workspace-1"]
    assert workspaces.deleted == 1


@pytest.mark.asyncio
async def test_workspace_deletion_fails_closed_when_scoped_cleanup_fails() -> None:
    documents = FakeDocuments()
    documents.documents = []
    workspaces = FakeWorkspaces()
    settings = FakeWorkspaceScopedCleanup(fail=True)
    service = WorkspaceLifecycleService(
        documents=documents,  # type: ignore[arg-type]
        workspaces=workspaces,  # type: ignore[arg-type]
        messages=FakeMessages(),  # type: ignore[arg-type]
        settings=settings,  # type: ignore[arg-type]
        api_keys=FakeWorkspaceScopedCleanup(),  # type: ignore[arg-type]
        usage=FakeWorkspaceScopedCleanup(),  # type: ignore[arg-type]
        billing=FakeWorkspaceScopedCleanup(),  # type: ignore[arg-type]
        provider_health=FakeWorkspaceScopedCleanup(),  # type: ignore[arg-type]
        audit=FakeWorkspaceScopedCleanup(),  # type: ignore[arg-type]
    )

    result = await service.delete_workspace(workspace_id="workspace-1")

    assert result.workspace_deleted is False
    assert result.failures == [
        {"resource": "workspace_settings", "code": "WORKSPACE_CLEANUP_FAILED", "message": "Workspace data cleanup failed; deletion remains incomplete."}
    ]
    assert workspaces.deleted == 0


@pytest.mark.asyncio
async def test_workspace_deletion_reports_workspace_row_delete_failure() -> None:
    documents = FakeDocuments()
    documents.documents = []
    workspaces = FakeWorkspaces(fail_delete=True)
    service = WorkspaceLifecycleService(
        documents=documents,  # type: ignore[arg-type]
        workspaces=workspaces,  # type: ignore[arg-type]
        messages=FakeMessages(),  # type: ignore[arg-type]
        settings=FakeWorkspaceScopedCleanup(),  # type: ignore[arg-type]
        api_keys=FakeWorkspaceScopedCleanup(),  # type: ignore[arg-type]
        usage=FakeWorkspaceScopedCleanup(),  # type: ignore[arg-type]
        billing=FakeWorkspaceScopedCleanup(),  # type: ignore[arg-type]
        provider_health=FakeWorkspaceScopedCleanup(),  # type: ignore[arg-type]
        audit=FakeWorkspaceScopedCleanup(),  # type: ignore[arg-type]
    )

    result = await service.delete_workspace(workspace_id="workspace-1")

    assert result.workspace_deleted is False
    assert result.failures == [
        {"resource": "workspaces", "code": "WORKSPACE_DELETE_FAILED", "message": "Workspace deletion failed; complete deletion is not confirmed."}
    ]
    assert workspaces.deleted == 0


@pytest.mark.asyncio
async def test_retention_scheduler_runs_due_workspaces_and_advances_schedule() -> None:
    settings = FakeRetentionSettings()
    lifecycle = FakeLifecycle()
    scheduler = RetentionScheduler(
        settings=settings,  # type: ignore[arg-type]
        lifecycle=lifecycle,  # type: ignore[arg-type]
    )

    summary = await scheduler.run_due(worker_id="retention-worker", limit=10, lease_seconds=900)

    assert summary.claimed == 2
    assert summary.completed == 1
    assert summary.skipped == 1
    assert summary.failed == 0
    assert lifecycle.runs == [("workspace-1", 30)]
    assert settings.updated[0][0] == "workspace-1"
    assert settings.updated[0][1]["succeeded"] is True
    assert settings.updated[0][1]["worker_id"] == "retention-worker"
    assert settings.updated[0][1]["lease_expires_at"] == "2099-01-01T00:00:00+00:00"


@pytest.mark.asyncio
async def test_manual_retention_reports_partial_failure_and_schedules_retry(monkeypatch) -> None:
    updated: list[dict] = []
    audits: list[dict] = []

    class FakeSettingsRepository:
        async def claim_workspace_retention(self, *, workspace_id: str, actor_id: str, worker_id: str):
            assert workspace_id == "workspace-1"
            assert actor_id == "owner-1"
            return {"workspace_id": workspace_id, "retention_enabled": True, "retention_days": 30,
                    "retention_lease_owner": worker_id, "retention_lease_expires_at": "2099-01-01T00:00:00+00:00"}

        async def finish_retention_claim(self, **values):
            assert values["workspace_id"] == "workspace-1"
            updated.append(values)
            return True

    class FakeLifecycleService:
        def __init__(self, **_kwargs) -> None:
            pass

        async def apply_retention(self, *, workspace_id: str, retention_days: int):
            assert workspace_id == "workspace-1"
            assert retention_days == 30
            return type(
                "Result",
                (),
                {
                    "workspace_deleted": False,
                    "documents_deleted": 1,
                    "chat_sessions_deleted": 0,
                    "local_chunks_deleted": 1,
                    "qdrant_chunks_deleted": 0,
                    "failures": [{"resource": "document", "error": "storage unavailable"}],
                },
            )()

    async def fake_audit(**kwargs):
        audits.append(kwargs)

    monkeypatch.setattr(routes, "WorkspaceSettingsRepository", FakeSettingsRepository)
    monkeypatch.setattr(routes, "WorkspaceLifecycleService", FakeLifecycleService)
    monkeypatch.setattr(routes, "_record_audit_event", fake_audit)

    workspace = WorkspaceContext(
        workspace_id="workspace-1",
        user=CurrentUser(
            id="owner-1",
            email="owner@example.com",
            role="authenticated",
            claims={},
        ),
        role=WorkspaceRole.OWNER,
    )
    settings = Settings(
        _env_file=None,
        supabase_url="https://example.supabase.co",
        supabase_anon_key="anon",
        supabase_service_role_key="service",
    )

    with pytest.raises(HTTPException) as exc:
        await routes.run_retention(workspace=workspace, settings=settings, vs=object())

    assert exc.value.status_code == 502
    assert "partial failures" in str(exc.value.detail)
    assert updated[0]["succeeded"] is False
    assert updated[0]["worker_id"].startswith("manual-retention:")
    assert updated[0]["lease_expires_at"] == "2099-01-01T00:00:00+00:00"
    assert audits[0]["metadata"]["retry_scheduled"] is True
    assert audits[0]["action"] == "privacy.retention_failed"
