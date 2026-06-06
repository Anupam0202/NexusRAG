"""Process due workspace retention schedules outside the web request path."""

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
from src.api.dependencies import get_vector_store  # noqa: E402
from src.tenancy.lifecycle import WorkspaceLifecycleService  # noqa: E402
from src.tenancy.retention_scheduler import RetentionScheduler  # noqa: E402
from src.utils.logger import get_logger  # noqa: E402
from src.vectorstores import QdrantVectorStore  # noqa: E402

logger = get_logger("scripts.process_retention")


async def main() -> None:
    parser = argparse.ArgumentParser(description="Process due NexusRAG retention schedules.")
    parser.add_argument("--limit", type=int, default=100, help="Maximum schedules to process.")
    parser.add_argument(
        "--worker-id",
        default=os.getenv("NEXUSRAG_RETENTION_WORKER_ID")
        or f"{socket.gethostname()}-{uuid4().hex[:8]}",
        help="Stable worker identity used for schedule leases.",
    )
    args = parser.parse_args()

    settings = get_settings()
    lifecycle = WorkspaceLifecycleService(
        vector_store=get_vector_store(),
        qdrant_store=QdrantVectorStore(settings) if settings.qdrant_configured else None,
    )
    summary = await RetentionScheduler(lifecycle=lifecycle).run_due(
        worker_id=args.worker_id,
        limit=args.limit,
    )
    logger.info("retention_scheduler_finished", **summary.__dict__)


if __name__ == "__main__":
    asyncio.run(main())
