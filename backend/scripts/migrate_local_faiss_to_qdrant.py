"""Migrate scoped local FAISS chunks into Qdrant.

Legacy chunks without ``workspace_id`` are never migrated by default. They are
reported as quarantined so an admin can review and assign them explicitly.
"""

from __future__ import annotations

import argparse
import asyncio
import pickle
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from config.settings import get_settings  # noqa: E402
from src.vectorstores import QdrantVectorStore, VectorChunk  # noqa: E402


def _load_store(path: Path) -> tuple[list[Any], list[list[float]]]:
    meta = path / "store_meta.pkl"
    if not meta.exists():
        raise FileNotFoundError(f"No local vector metadata found at {meta}")
    with meta.open("rb") as handle:
        data = pickle.load(handle)
    return data.get("documents", []), data.get("embeddings", [])


async def migrate(*, data_dir: Path, dry_run: bool) -> dict[str, int]:
    documents, embeddings = _load_store(data_dir)
    grouped: dict[tuple[str, str], list[VectorChunk]] = {}
    quarantined = 0

    for index, doc in enumerate(documents):
        metadata = getattr(doc, "metadata", {}) or {}
        workspace_id = str(metadata.get("workspace_id") or "").strip()
        document_id = str(metadata.get("document_id") or "").strip()
        embedding = embeddings[index] if index < len(embeddings) else None
        if not workspace_id or not document_id or embedding is None or len(embedding) == 0:
            quarantined += 1
            continue
        chunk_index = int(metadata.get("chunk_index") or index)
        content = str(getattr(doc, "page_content", "") or "")
        grouped.setdefault((workspace_id, document_id), []).append(
            VectorChunk(
                chunk_id=str(metadata.get("chunk_id") or f"{document_id}:{chunk_index}"),
                content=content,
                embedding=[float(value) for value in embedding],
                filename=str(metadata.get("filename") or "legacy-document"),
                chunk_index=chunk_index,
                page_number=int(metadata.get("page_number") or 0),
                content_hash=str(metadata.get("content_hash") or ""),
                metadata=metadata,
            )
        )

    migrated = 0
    if not dry_run and grouped:
        settings = get_settings()
        store = QdrantVectorStore(settings)
        first = next(iter(grouped.values()))[0]
        await store.ensure_collection(vector_size=len(first.embedding))
        for (workspace_id, document_id), chunks in grouped.items():
            migrated += await store.upsert_chunks(
                workspace_id=workspace_id,
                document_id=document_id,
                chunks=chunks,
            )
    else:
        migrated = sum(len(chunks) for chunks in grouped.values())

    return {
        "documents_seen": len(documents),
        "scoped_chunks_ready": sum(len(chunks) for chunks in grouped.values()),
        "quarantined_unscoped_chunks": quarantined,
        "migrated_chunks": migrated if not dry_run else 0,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Migrate local FAISS chunks to Qdrant.")
    parser.add_argument("--data-dir", default="data/vector_store", help="Local FAISS store path.")
    parser.add_argument("--apply", action="store_true", help="Actually write to Qdrant.")
    args = parser.parse_args()
    result = asyncio.run(migrate(data_dir=Path(args.data_dir), dry_run=not args.apply))
    print(result)


if __name__ == "__main__":
    main()
