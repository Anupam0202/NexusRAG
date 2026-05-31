"""Ingestion job state for sync and background upload processing.

This is an in-process store for the free/demo backend. The repository layer
added for Supabase is the durable target; this module gives the API and
frontend a stable job-status contract before the worker is fully externalized.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from threading import Lock
from typing import Any
from uuid import uuid4

from src.api.models import (
    DocumentMetadata,
    IngestionJobStatus,
    IngestionJobStatusResponse,
)
from src.utils.tenant import normalize_workspace_id


@dataclass
class IngestionJobRecord:
    job_id: str
    workspace_id: str
    document_id: str
    filename: str
    status: IngestionJobStatus
    stage: str
    progress: int
    message: str
    created_at: datetime
    updated_at: datetime
    started_at: datetime | None = None
    completed_at: datetime | None = None
    error_message: str | None = None
    document: DocumentMetadata | None = None

    def response(self) -> IngestionJobStatusResponse:
        return IngestionJobStatusResponse(
            job_id=self.job_id,
            document_id=self.document_id,
            filename=self.filename,
            status=self.status,
            stage=self.stage,
            progress=self.progress,
            message=self.message,
            error_message=self.error_message,
            created_at=self.created_at,
            updated_at=self.updated_at,
            started_at=self.started_at,
            completed_at=self.completed_at,
            document=self.document,
        )


class InMemoryIngestionJobStore:
    def __init__(self) -> None:
        self._jobs: dict[str, IngestionJobRecord] = {}
        self._document_index: dict[str, str] = {}
        self._lock = Lock()

    def create(
        self,
        *,
        document_id: str,
        filename: str,
        workspace_id: str | None = None,
    ) -> IngestionJobRecord:
        now = datetime.now(UTC)
        record = IngestionJobRecord(
            job_id=str(uuid4()),
            workspace_id=normalize_workspace_id(workspace_id),
            document_id=document_id,
            filename=filename,
            status=IngestionJobStatus.QUEUED,
            stage="queued",
            progress=0,
            message="Queued for ingestion",
            created_at=now,
            updated_at=now,
        )
        with self._lock:
            self._jobs[record.job_id] = record
            self._document_index[document_id] = record.job_id
        return record

    def get(self, job_id: str) -> IngestionJobRecord | None:
        with self._lock:
            return self._jobs.get(job_id)

    def get_by_document_id(self, document_id: str) -> IngestionJobRecord | None:
        with self._lock:
            job_id = self._document_index.get(document_id)
            return self._jobs.get(job_id) if job_id else None

    def update(self, job_id: str, **values: Any) -> IngestionJobRecord | None:
        with self._lock:
            record = self._jobs.get(job_id)
            if not record:
                return None
            for key, value in values.items():
                if hasattr(record, key):
                    setattr(record, key, value)
            record.updated_at = datetime.now(UTC)
            return record

    def mark_processing(self, job_id: str, *, stage: str, progress: int) -> None:
        record = self.get(job_id)
        started_at = record.started_at if record else datetime.now(UTC)
        self.update(
            job_id,
            status=IngestionJobStatus.PROCESSING,
            stage=stage,
            progress=max(1, min(progress, 99)),
            message=stage,
            started_at=started_at or datetime.now(UTC),
        )

    def mark_completed(self, job_id: str, *, document: DocumentMetadata, message: str) -> None:
        self.update(
            job_id,
            status=IngestionJobStatus.COMPLETED,
            stage="completed",
            progress=100,
            message=message,
            completed_at=datetime.now(UTC),
            document=document,
            error_message=None,
        )

    def mark_failed(self, job_id: str, *, stage: str, error_message: str) -> None:
        self.update(
            job_id,
            status=IngestionJobStatus.FAILED,
            stage=stage,
            progress=100,
            message="Ingestion failed",
            error_message=error_message,
            completed_at=datetime.now(UTC),
        )


_job_store = InMemoryIngestionJobStore()


def get_ingestion_job_store() -> InMemoryIngestionJobStore:
    return _job_store
