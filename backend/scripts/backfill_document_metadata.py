"""Backfill durable document metadata after enterprise migration.

The script is intentionally conservative: it updates only scoped documents and
never assigns legacy unscoped rows to a public workspace.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.repositories.chunks import ChunkRepository  # noqa: E402
from src.repositories.documents import DocumentRepository, document_storage_path  # noqa: E402


async def backfill_workspace(*, workspace_id: str, apply: bool) -> dict[str, int]:
    documents = DocumentRepository()
    chunks = ChunkRepository()
    rows = await documents.list_documents(workspace_id=workspace_id, include_deleted=True)
    updates = 0
    inspected = 0
    for row in rows:
        inspected += 1
        document_id = str(row.get("id") or "")
        filename = str(row.get("filename") or row.get("original_filename") or "document")
        doc_chunks = await chunks.list_for_document(
            workspace_id=workspace_id,
            document_id=document_id,
        )
        values: dict[str, object] = {}
        if not row.get("storage_path"):
            values["storage_path"] = document_storage_path(workspace_id, document_id, filename)
        values["chunk_count"] = len(doc_chunks)
        values["page_count"] = max(
            [int(chunk.get("page_number") or 0) for chunk in doc_chunks] or [0]
        )
        if apply and values:
            await documents.update_document(
                workspace_id=workspace_id,
                document_id=document_id,
                values=values,
            )
        if values:
            updates += 1
    return {"documents_inspected": inspected, "documents_with_backfill": updates}


def main() -> None:
    parser = argparse.ArgumentParser(description="Backfill workspace document metadata.")
    parser.add_argument("--workspace-id", required=True)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    print(asyncio.run(backfill_workspace(workspace_id=args.workspace_id, apply=args.apply)))


if __name__ == "__main__":
    main()
