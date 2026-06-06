"""Repository boundary tests for enterprise Supabase persistence."""

from __future__ import annotations

from typing import Any

import pytest

from src.api.auth import WorkspaceRole
from src.repositories import (
    ApiKeyRepository,
    ChunkRepository,
    DocumentRepository,
    IngestionJobRepository,
    MessageRepository,
    ProviderHealthRepository,
    UsageRepository,
    WorkspaceRepository,
    compute_sha256,
    document_storage_path,
)


class FakeSupabase:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str, Any, dict[str, Any]]] = []
        self.rows: dict[str, list[dict[str, Any]]] = {}
        self.counter = 0

    def _next_id(self, table: str) -> str:
        self.counter += 1
        return f"{table}-{self.counter}"

    async def table_select(
        self,
        table: str,
        *,
        query: str = "select=*",
        service_role: bool = True,
    ) -> list[dict[str, Any]]:
        self.calls.append(("select", table, query, {"service_role": service_role}))
        return self.rows.get(table, [])

    async def table_insert(
        self,
        table: str,
        payload: dict[str, Any] | list[dict[str, Any]],
        *,
        service_role: bool = True,
        prefer: str = "return=representation",
    ) -> list[dict[str, Any]]:
        self.calls.append(
            ("insert", table, payload, {"service_role": service_role, "prefer": prefer})
        )
        items = payload if isinstance(payload, list) else [payload]
        return [{**item, "id": item.get("id", self._next_id(table))} for item in items]

    async def table_upsert(
        self,
        table: str,
        payload: dict[str, Any] | list[dict[str, Any]],
        *,
        on_conflict: str | None = None,
        service_role: bool = True,
        prefer: str = "resolution=merge-duplicates,return=representation",
    ) -> list[dict[str, Any]]:
        self.calls.append(
            (
                "upsert",
                table,
                payload,
                {"on_conflict": on_conflict, "service_role": service_role, "prefer": prefer},
            )
        )
        items = payload if isinstance(payload, list) else [payload]
        return [{**item, "id": item.get("id", self._next_id(table))} for item in items]

    async def table_update(
        self,
        table: str,
        payload: dict[str, Any],
        *,
        query: str,
        service_role: bool = True,
        prefer: str = "return=representation",
    ) -> list[dict[str, Any]]:
        self.calls.append(
            (
                "update",
                table,
                payload,
                {"query": query, "service_role": service_role, "prefer": prefer},
            )
        )
        return [{**payload, "id": self._next_id(table)}]

    async def table_delete(
        self,
        table: str,
        *,
        query: str,
        service_role: bool = True,
        prefer: str = "return=representation",
    ) -> list[dict[str, Any]]:
        self.calls.append(
            ("delete", table, query, {"service_role": service_role, "prefer": prefer})
        )
        return [{"deleted": True}]

    async def upload_object(
        self,
        path: str,
        content: bytes,
        *,
        content_type: str = "application/octet-stream",
        upsert: bool = False,
    ) -> None:
        self.calls.append(
            (
                "upload",
                "storage",
                path,
                {"content": content, "content_type": content_type, "upsert": upsert},
            )
        )

    async def delete_object(self, path: str) -> None:
        self.calls.append(("delete", "storage", path, {}))


def test_document_storage_path_and_sha256_are_deterministic() -> None:
    assert compute_sha256(b"nexus") == compute_sha256(b"nexus")
    assert document_storage_path("workspace", "document", "../invoice.pdf") == (
        "workspace/document/invoice.pdf"
    )


@pytest.mark.asyncio
async def test_document_repository_deletes_original_from_workspace_storage_path() -> None:
    fake = FakeSupabase()
    repo = DocumentRepository(fake)  # type: ignore[arg-type]

    await repo.delete_original(
        workspace_id="workspace-1",
        document_id="doc-1",
        storage_path="workspace-1/doc-1/report.pdf",
    )

    assert fake.calls == [
        ("delete", "storage", "workspace-1/doc-1/report.pdf", {})
    ]


@pytest.mark.asyncio
async def test_document_repository_rejects_untrusted_storage_delete_path() -> None:
    fake = FakeSupabase()
    repo = DocumentRepository(fake)  # type: ignore[arg-type]

    with pytest.raises(ValueError, match="trusted document prefix"):
        await repo.delete_original(
            workspace_id="workspace-1",
            document_id="doc-1",
            storage_path="workspace-2/doc-9/private.pdf",
        )

    assert fake.calls == []


@pytest.mark.asyncio
async def test_document_repository_creates_queued_document_with_workspace_storage_path() -> None:
    fake = FakeSupabase()
    repo = DocumentRepository(fake)  # type: ignore[arg-type]

    document = await repo.create_queued_document(
        workspace_id="workspace-1",
        uploaded_by="user-1",
        filename="report.pdf",
        original_filename="Report.pdf",
        content_type="application/pdf",
        file_size_bytes=42,
        sha256="abc123",
        document_id="doc-1",
        storage_bucket="documents",
    )

    assert document["workspace_id"] == "workspace-1"
    assert document["storage_path"] == "workspace-1/doc-1/report.pdf"
    _, table, payload, _ = fake.calls[0]
    assert table == "documents"
    assert payload["status"] == "queued"
    assert payload["sha256"] == "abc123"


@pytest.mark.asyncio
async def test_chunk_repository_replaces_chunks_with_workspace_scope() -> None:
    fake = FakeSupabase()
    repo = ChunkRepository(fake)  # type: ignore[arg-type]

    rows = await repo.replace_document_chunks(
        workspace_id="workspace-1",
        document_id="doc-1",
        chunks=[
            {
                "chunk_index": 0,
                "content": "hello",
                "content_hash": "hash",
                "qdrant_point_id": "point-1",
            }
        ],
    )

    assert rows[0]["workspace_id"] == "workspace-1"
    assert rows[0]["document_id"] == "doc-1"
    assert fake.calls[0][0] == "delete"
    assert "workspace_id=eq.workspace-1" in fake.calls[0][2]
    assert "document_id=eq.doc-1" in fake.calls[0][2]
    assert fake.calls[1][1] == "document_chunks"


@pytest.mark.asyncio
async def test_job_repository_claims_next_job_with_workspace_scoped_update() -> None:
    fake = FakeSupabase()
    fake.rows["ingestion_jobs"] = [{"id": "job-1", "workspace_id": "workspace-1"}]
    repo = IngestionJobRepository(fake)  # type: ignore[arg-type]

    job = await repo.claim_next_queued()

    assert job is not None
    update_call = fake.calls[-1]
    assert update_call[0] == "update"
    assert update_call[1] == "ingestion_jobs"
    assert update_call[2]["status"] == "processing"
    assert "workspace_id=eq.workspace-1" in update_call[3]["query"]
    assert "id=eq.job-1" in update_call[3]["query"]


@pytest.mark.asyncio
async def test_job_repository_can_use_external_job_id() -> None:
    fake = FakeSupabase()
    repo = IngestionJobRepository(fake)  # type: ignore[arg-type]

    job = await repo.create_job(
        workspace_id="workspace-1",
        document_id="doc-1",
        job_id="11111111-1111-1111-1111-111111111111",
    )

    assert job["id"] == "11111111-1111-1111-1111-111111111111"
    insert_call = fake.calls[0]
    assert insert_call[0] == "insert"
    assert insert_call[1] == "ingestion_jobs"
    assert insert_call[2]["id"] == "11111111-1111-1111-1111-111111111111"


@pytest.mark.asyncio
async def test_workspace_repository_bootstraps_owner_and_settings() -> None:
    fake = FakeSupabase()
    repo = WorkspaceRepository(fake)  # type: ignore[arg-type]

    workspace = await repo.create_workspace(
        name="Acme",
        slug="acme",
        owner_id="user-1",
    )

    assert workspace["slug"] == "acme"
    assert fake.calls[0][1] == "workspaces"
    assert fake.calls[1][1] == "workspace_members"
    assert fake.calls[1][2]["role"] == WorkspaceRole.OWNER.value
    assert fake.calls[2][1] == "workspace_settings"


@pytest.mark.asyncio
async def test_workspace_repository_treats_hyphenated_email_as_email() -> None:
    fake = FakeSupabase()
    repo = WorkspaceRepository(fake)  # type: ignore[arg-type]

    await repo.find_profile("team-member@example.com")

    assert "email=eq.team-member%40example.com" in fake.calls[0][2]
    assert "id=eq." not in fake.calls[0][2]


@pytest.mark.asyncio
async def test_api_key_repository_never_lists_encrypted_key_by_default() -> None:
    fake = FakeSupabase()
    repo = ApiKeyRepository(fake)  # type: ignore[arg-type]

    await repo.list_active_keys(workspace_id="workspace-1", provider="gemini")

    select_query = fake.calls[0][2]
    assert "encrypted_key" not in select_query
    assert "workspace_id=eq.workspace-1" in select_query
    assert "provider=eq.gemini" in select_query


@pytest.mark.asyncio
async def test_api_key_repository_deactivates_active_key_by_workspace_user_provider() -> None:
    fake = FakeSupabase()
    repo = ApiKeyRepository(fake)  # type: ignore[arg-type]

    await repo.deactivate_active_keys(
        workspace_id="workspace-1",
        user_id="user-1",
        provider="gemini",
    )

    update_call = fake.calls[0]
    assert update_call[0] == "update"
    assert update_call[1] == "api_keys"
    assert update_call[2]["is_active"] is False
    assert "workspace_id=eq.workspace-1" in update_call[3]["query"]
    assert "user_id=eq.user-1" in update_call[3]["query"]
    assert "provider=eq.gemini" in update_call[3]["query"]
    assert "is_active=eq.true" in update_call[3]["query"]


@pytest.mark.asyncio
async def test_usage_repository_records_and_lists_workspace_events() -> None:
    fake = FakeSupabase()
    fake.rows["llm_usage_events"] = [
        {
            "workspace_id": "workspace-1",
            "provider": "gemini",
            "model": "gemini-2.5-flash",
            "operation": "chat.query",
        }
    ]
    repo = UsageRepository(fake)  # type: ignore[arg-type]

    await repo.record_event(
        workspace_id="workspace-1",
        user_id="user-1",
        provider="gemini",
        model="gemini-2.5-flash",
        operation="chat.query",
        input_tokens=12,
        output_tokens=20,
        latency_ms=450,
    )
    events = await repo.list_events(workspace_id="workspace-1")

    insert_call = fake.calls[0]
    assert insert_call[0] == "insert"
    assert insert_call[1] == "llm_usage_events"
    assert insert_call[2]["workspace_id"] == "workspace-1"
    assert insert_call[2]["input_tokens"] == 12
    assert events[0]["operation"] == "chat.query"
    select_call = fake.calls[1]
    assert "workspace_id=eq.workspace-1" in select_call[2]


@pytest.mark.asyncio
async def test_provider_health_repository_persists_workspace_snapshot() -> None:
    fake = FakeSupabase()
    repo = ProviderHealthRepository(fake)  # type: ignore[arg-type]

    persisted = await repo.upsert_snapshot(
        workspace_id="workspace-1",
        snapshot=[
            {
                "provider": "gemini",
                "model": "gemini-2.5-flash",
                "mode": "server_default_key",
                "consecutive_failures": 2,
                "quota_exhausted": True,
                "last_error_code": "quota",
                "circuit_open_until": "2026-06-06T12:00:00Z",
            }
        ],
    )

    assert persisted == 1
    upsert_call = fake.calls[0]
    assert upsert_call[1] == "provider_health_state"
    assert upsert_call[2][0]["workspace_id"] == "workspace-1"
    assert upsert_call[2][0]["quota_exhausted"] is True
    assert upsert_call[3]["on_conflict"] == "workspace_id,provider,model,mode"


@pytest.mark.asyncio
async def test_message_repository_ensures_explicit_session_id() -> None:
    fake = FakeSupabase()
    repo = MessageRepository(fake)  # type: ignore[arg-type]

    session = await repo.ensure_session(
        workspace_id="workspace-1",
        session_id="11111111-1111-1111-1111-111111111111",
        user_id="user-1",
        title="First question",
    )

    assert session["id"] == "11111111-1111-1111-1111-111111111111"
    assert fake.calls[0][0] == "select"
    assert "id=eq.11111111-1111-1111-1111-111111111111" in fake.calls[0][2]
    insert_call = fake.calls[1]
    assert insert_call[0] == "insert"
    assert insert_call[1] == "chat_sessions"
    assert insert_call[2]["id"] == "11111111-1111-1111-1111-111111111111"


@pytest.mark.asyncio
async def test_message_repository_lists_and_clears_workspace_session_messages() -> None:
    fake = FakeSupabase()
    fake.rows["chat_messages"] = [{"role": "user", "content": "hello"}]
    repo = MessageRepository(fake)  # type: ignore[arg-type]

    messages = await repo.list_messages(
        workspace_id="workspace-1",
        session_id="11111111-1111-1111-1111-111111111111",
    )
    deleted = await repo.clear_session(
        workspace_id="workspace-1",
        session_id="11111111-1111-1111-1111-111111111111",
    )

    assert messages[0]["content"] == "hello"
    assert deleted == 1
    assert "workspace_id=eq.workspace-1" in fake.calls[0][2]
    assert "session_id=eq.11111111-1111-1111-1111-111111111111" in fake.calls[0][2]
    assert "workspace_id=eq.workspace-1" in fake.calls[1][2]
    assert "session_id=eq.11111111-1111-1111-1111-111111111111" in fake.calls[1][2]
