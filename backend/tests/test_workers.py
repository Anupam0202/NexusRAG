from __future__ import annotations

import pytest

from scripts import process_jobs


@pytest.mark.asyncio
async def test_ingestion_worker_requeues_transient_original_download_failure(monkeypatch) -> None:
    requeued: list[dict] = []

    class FakeJobs:
        async def claim_next_queued(self, **_kwargs):
            return {
                "id": "job-1",
                "workspace_id": "workspace-1",
                "document_id": "doc-1",
                "attempts": 1,
            }

        async def requeue_claimed_job(self, **kwargs):
            requeued.append(kwargs)
            return {"id": "job-1", "status": "queued"}

    class FakeDocuments:
        async def get_document(self, **_kwargs):
            return {
                "id": "doc-1",
                "workspace_id": "workspace-1",
                "storage_path": "workspace-1/doc-1/report.pdf",
            }

        async def download_original(self, **_kwargs):
            raise RuntimeError("storage temporarily unavailable")

    monkeypatch.setattr(process_jobs, "IngestionJobRepository", FakeJobs)
    monkeypatch.setattr(process_jobs, "DocumentRepository", FakeDocuments)

    assert await process_jobs.process_one(worker_id="worker-1") is True
    assert requeued[0]["job_id"] == "job-1"
    assert requeued[0]["worker_id"] == "worker-1"
    assert "storage temporarily unavailable" in requeued[0]["error_message"]
