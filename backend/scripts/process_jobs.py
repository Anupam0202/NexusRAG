"""Process queued Supabase ingestion jobs outside the FastAPI request path.

Run from ``backend/``:

    python scripts/process_jobs.py --limit 5

This free-first worker uses the same ingestion functions as the upload route,
but claims durable Supabase jobs so processing can be moved off Render request
handlers on larger deployments.
"""

from __future__ import annotations

import argparse
import asyncio
import os
import socket
import sys
from pathlib import Path
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from config.settings import get_settings  # noqa: E402
from src.api.auth import CurrentUser, WorkspaceContext, WorkspaceRole  # noqa: E402
from src.api.dependencies import get_rag_chain, get_vector_store  # noqa: E402
from src.api.routes import _process_enterprise_upload_job_background  # noqa: E402
from src.repositories.documents import DocumentRepository  # noqa: E402
from src.repositories.jobs import IngestionJobRepository  # noqa: E402
from src.utils.logger import get_logger  # noqa: E402

logger = get_logger("scripts.process_jobs")


async def process_one(*, worker_id: str, workspace_id: str | None = None) -> bool:
    settings = get_settings()
    jobs = IngestionJobRepository()
    documents = DocumentRepository()

    job = await jobs.claim_next_queued(worker_id=worker_id, workspace_id=workspace_id)
    if not job:
        return False

    job_workspace_id = str(job["workspace_id"])
    document_id = str(job["document_id"])
    document = await documents.get_document(
        workspace_id=job_workspace_id,
        document_id=document_id,
    )
    if not document:
        await jobs.update_job(
            workspace_id=job_workspace_id,
            job_id=str(job["id"]),
            values={
                "status": "failed",
                "stage": "document_missing",
                "progress": 100,
                "error_message": "Document row not found for queued ingestion job.",
            },
        )
        return True

    storage_path = str(document.get("storage_path") or "")
    if not storage_path:
        await jobs.update_job(
            workspace_id=job_workspace_id,
            job_id=str(job["id"]),
            values={
                "status": "failed",
                "stage": "storage_path_missing",
                "progress": 100,
                "error_message": "Document has no Supabase Storage path.",
            },
        )
        return True

    try:
        content = await documents.download_original(
            workspace_id=job_workspace_id,
            document_id=document_id,
            storage_path=storage_path,
        )
        user = CurrentUser(
            id=str(document.get("uploaded_by") or "00000000-0000-0000-0000-000000000000"),
            email=None,
            role=WorkspaceRole.EDITOR.value,
            claims={},
        )
        workspace = WorkspaceContext(
            workspace_id=job_workspace_id,
            user=user,
            role=WorkspaceRole.EDITOR,
        )
        await _process_enterprise_upload_job_background(
            workspace=workspace,
            job_id=str(job["id"]),
            workspace_id=job_workspace_id,
            document_id=document_id,
            safe_name=str(
                document.get("filename") or document.get("original_filename") or "document"
            ),
            content=content,
            settings=settings,
            vs=get_vector_store(),
            chain=get_rag_chain(),
        )
        completed = await jobs.get_job(workspace_id=job_workspace_id, job_id=str(job["id"]))
        if completed and str(completed.get("status")) == "failed":
            await jobs.requeue_claimed_job(
                job_id=str(job["id"]),
                worker_id=worker_id,
                error_message=str(completed.get("error_message") or "Ingestion failed."),
                retry_seconds=min(300, 15 * (2 ** max(int(job.get("attempts") or 1) - 1, 0))),
            )
    except Exception as exc:
        await jobs.requeue_claimed_job(
            job_id=str(job["id"]),
            worker_id=worker_id,
            error_message=str(exc),
            retry_seconds=min(300, 15 * (2 ** max(int(job.get("attempts") or 1) - 1, 0))),
        )
        logger.warning("queued_ingestion_job_requeued", job_id=str(job["id"]), error=str(exc))
        return True
    logger.info("queued_ingestion_job_processed", job_id=str(job["id"]), document_id=document_id)
    return True


async def main() -> None:
    parser = argparse.ArgumentParser(description="Process queued NexusRAG ingestion jobs.")
    parser.add_argument("--workspace-id", default=None, help="Optional workspace scope.")
    parser.add_argument("--limit", type=int, default=1, help="Maximum queued jobs to process.")
    parser.add_argument("--poll", action="store_true", help="Keep polling until interrupted.")
    parser.add_argument("--sleep", type=float, default=5.0, help="Poll sleep seconds.")
    parser.add_argument(
        "--worker-id",
        default=os.getenv("NEXUSRAG_WORKER_ID") or f"{socket.gethostname()}-{uuid4().hex[:8]}",
        help="Stable worker identity used for queue leases.",
    )
    args = parser.parse_args()

    processed = 0
    while args.poll or processed < args.limit:
        did_work = await process_one(worker_id=args.worker_id, workspace_id=args.workspace_id)
        if did_work:
            processed += 1
            continue
        if not args.poll:
            break
        await asyncio.sleep(args.sleep)

    logger.info("queued_ingestion_worker_finished", processed=processed)


if __name__ == "__main__":
    asyncio.run(main())
