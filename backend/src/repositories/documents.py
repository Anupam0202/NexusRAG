"""Document metadata and original-file storage helpers."""

from __future__ import annotations

import hashlib
from pathlib import Path, PurePosixPath
from typing import Any

from config.settings import get_settings
from src.repositories.base import SupabaseRepository, and_query, encoded, eq_filter, first_row


def compute_sha256(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def document_storage_path(workspace_id: str, document_id: str, filename: str) -> str:
    safe_name = Path(filename).name.strip() or "document"
    return f"{workspace_id}/{document_id}/{safe_name}"


def trusted_document_storage_path(
    *,
    workspace_id: str,
    document_id: str,
    storage_path: str,
) -> str:
    raw_path = storage_path.strip()
    if not raw_path or "\\" in raw_path or raw_path.startswith("/"):
        raise ValueError("Storage path is outside the trusted document prefix.")
    normalized = PurePosixPath(raw_path).as_posix()
    if ".." in PurePosixPath(normalized).parts:
        raise ValueError("Storage path is outside the trusted document prefix.")
    trusted_prefix = f"{workspace_id}/{document_id}/"
    if not normalized.startswith(trusted_prefix) or normalized == trusted_prefix.rstrip("/"):
        raise ValueError("Storage path is outside the trusted document prefix.")
    return normalized


class DocumentRepository(SupabaseRepository):
    async def create_queued_document(
        self,
        *,
        workspace_id: str,
        uploaded_by: str,
        filename: str,
        original_filename: str,
        content_type: str | None,
        file_size_bytes: int,
        sha256: str,
        document_id: str | None = None,
        storage_bucket: str | None = None,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "workspace_id": workspace_id,
            "uploaded_by": uploaded_by,
            "filename": filename,
            "original_filename": original_filename,
            "content_type": content_type,
            "file_size_bytes": file_size_bytes,
            "storage_bucket": storage_bucket or get_settings().supabase_storage_bucket,
            "sha256": sha256,
            "status": "queued",
        }
        if document_id:
            payload["id"] = document_id
            payload["storage_path"] = document_storage_path(workspace_id, document_id, filename)

        rows = await self._supabase.table_insert("documents", payload)
        document = rows[0]
        if not document.get("storage_path"):
            storage_path = document_storage_path(workspace_id, str(document["id"]), filename)
            updated = await self.update_document(
                workspace_id=workspace_id,
                document_id=str(document["id"]),
                values={"storage_path": storage_path},
            )
            return updated or {**document, "storage_path": storage_path}
        return document

    async def upload_original(
        self,
        *,
        storage_path: str,
        content: bytes,
        content_type: str | None,
        upsert: bool = False,
    ) -> None:
        await self._supabase.upload_object(
            storage_path,
            content,
            content_type=content_type or "application/octet-stream",
            upsert=upsert,
        )

    async def delete_original(
        self,
        *,
        workspace_id: str,
        document_id: str,
        storage_path: str,
    ) -> None:
        trusted_path = trusted_document_storage_path(
            workspace_id=workspace_id,
            document_id=document_id,
            storage_path=storage_path,
        )
        await self._supabase.delete_object(trusted_path)

    async def download_original(
        self,
        *,
        workspace_id: str,
        document_id: str,
        storage_path: str,
    ) -> bytes:
        trusted_path = trusted_document_storage_path(
            workspace_id=workspace_id,
            document_id=document_id,
            storage_path=storage_path,
        )
        return await self._supabase.download_object(trusted_path)

    async def find_duplicate_ready_document(
        self,
        *,
        workspace_id: str,
        sha256: str,
    ) -> dict[str, Any] | None:
        rows = await self._supabase.table_select(
            "documents",
            query=and_query(
                "select=*",
                eq_filter("workspace_id", workspace_id),
                eq_filter("sha256", sha256),
                "status=neq.deleted",
                "limit=1",
            ),
        )
        return first_row(rows)

    async def get_document(
        self,
        *,
        workspace_id: str,
        document_id: str,
    ) -> dict[str, Any] | None:
        rows = await self._supabase.table_select(
            "documents",
            query=and_query(
                "select=*",
                eq_filter("workspace_id", workspace_id),
                eq_filter("id", document_id),
                "limit=1",
            ),
        )
        return first_row(rows)

    async def list_documents(
        self,
        *,
        workspace_id: str,
        include_deleted: bool = False,
    ) -> list[dict[str, Any]]:
        filters = ["select=*", eq_filter("workspace_id", workspace_id), "order=created_at.desc"]
        if not include_deleted:
            filters.insert(2, "status=neq.deleted")
        return await self._supabase.table_select("documents", query=and_query(*filters))

    async def update_document(
        self,
        *,
        workspace_id: str,
        document_id: str,
        values: dict[str, Any],
    ) -> dict[str, Any] | None:
        rows = await self._supabase.table_update(
            "documents",
            values,
            query=and_query(eq_filter("workspace_id", workspace_id), eq_filter("id", document_id)),
        )
        return first_row(rows)

    async def mark_deleted(self, *, workspace_id: str, document_id: str) -> dict[str, Any] | None:
        return await self.update_document(
            workspace_id=workspace_id,
            document_id=document_id,
            values={"status": "deleted"},
        )

    async def delete_document_row(self, *, workspace_id: str, document_id: str) -> int:
        rows = await self._supabase.table_delete(
            "documents",
            query=and_query(eq_filter("workspace_id", workspace_id), eq_filter("id", document_id)),
        )
        return len(rows)

    async def find_by_filename(
        self,
        *,
        workspace_id: str,
        filename: str,
    ) -> dict[str, Any] | None:
        rows = await self._supabase.table_select(
            "documents",
            query=and_query(
                "select=*",
                eq_filter("workspace_id", workspace_id),
                f"filename=eq.{encoded(filename)}",
                "status=neq.deleted",
                "limit=1",
            ),
        )
        return first_row(rows)
