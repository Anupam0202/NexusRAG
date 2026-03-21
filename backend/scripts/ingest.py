#!/usr/bin/env python3
"""
CLI Document Ingestion Script
==============================

Usage::

    python scripts/ingest.py path/to/files/
    python scripts/ingest.py report.pdf data.xlsx
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

# Ensure the backend package is importable
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from config.settings import get_settings
from src.ingestion.pipeline import IngestionPipeline
from src.retrieval.vector_store import VectorStoreManager


def main() -> None:
    parser = argparse.ArgumentParser(description="Ingest documents into the RAG vector store")
    parser.add_argument(
        "paths",
        nargs="+",
        help="File paths or directories to ingest",
    )
    parser.add_argument("--chunk-size", type=int, default=None, help="Override chunk size")
    args = parser.parse_args()

    settings = get_settings()
    if args.chunk_size:
        settings.chunk_size = args.chunk_size

    # Collect files
    files: list[Path] = []
    for p_str in args.paths:
        p = Path(p_str)
        if p.is_dir():
            for ext in settings.SUPPORTED_EXTENSIONS:
                files.extend(p.glob(f"*{ext}"))
        elif p.is_file():
            files.append(p)
        else:
            print(f"⚠  Not found: {p}")

    if not files:
        print("No supported files found.")
        sys.exit(1)

    print(f"📁 Found {len(files)} file(s):")
    for f in files:
        print(f"   • {f.name}")

    vs = VectorStoreManager(settings=settings)
    pipeline = IngestionPipeline(
        vector_store=vs,
        settings=settings,
        progress_callback=lambda msg, pct: print(f"  [{pct:.0%}] {msg}"),
    )

    result = pipeline.ingest(file_paths=files)

    print(f"\n✅ Ingestion complete:")
    print(f"   Documents loaded:  {result.documents_loaded}")
    print(f"   Chunks created:    {result.chunks_created}")
    print(f"   Processing time:   {result.processing_time_seconds:.2f}s")
    if result.errors:
        print(f"   ⚠  Errors: {len(result.errors)}")
        for e in result.errors:
            print(f"      - {e['file']}: {e['error']}")


if __name__ == "__main__":
    main()