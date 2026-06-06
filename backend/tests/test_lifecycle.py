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
    def __init__(self) -> None:
        self.deleted = 0

    async def delete_workspace(self, *, workspace_id: str):
        self.deleted += 1
        return 1


class FakeMessages:
    def __init__(self) -> None:
        self.cutoffs: list[str] = []

    async def delete_sessions_before(self, *, workspace_id: str, created_before: str):
        self.cutoffs.append(created_before)
        return 2


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
                "retention_enabled": True,
                "retention_days": 30,
            },
            {
                "workspace_id": "workspace-disabled",
                "retention_enabled": False,
                "retention_days": 7,
            },
        ]

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
    assert settings.updated[0][1]["last_retention_at"]
    assert settings.updated[0][1]["next_retention_at"]
    assert settings.updated[0][1]["retention_lease_owner"] is None


@pytest.mark.asyncio
async def test_manual_retention_reports_partial_failure_and_schedules_retry(monkeypatch) -> None:
    updated: list[dict] = []
    audits: list[dict] = []

    class FakeSettingsRepository:
        async def get_settings(self, *, workspace_id: str):
            assert workspace_id == "workspace-1"
            return {"retention_enabled": True, "retention_days": 30}

        async def upsert_settings(self, *, workspace_id: str, values: dict):
            assert workspace_id == "workspace-1"
            updated.append(values)
            return values

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
    assert "last_retention_at" not in updated[0]
    assert updated[0]["next_retention_at"]
    assert updated[0]["retention_lease_owner"] is None
    assert audits[0]["action"] == "privacy.retention_failed"
