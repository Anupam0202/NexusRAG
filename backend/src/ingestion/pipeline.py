"""
Ingestion Pipeline Orchestrator — v2 (+ scientific mode)
=========================================================
"""

from __future__ import annotations

import time
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from langchain_core.documents import Document

from config.settings import Settings, get_settings
from src.ingestion.chunker import SmartChunker
from src.ingestion.contextualizer import ContextualEnricher
from src.ingestion.loader import LoaderFactory
from src.utils.logger import get_logger

logger = get_logger(__name__)

ProgressCallback = Callable[[str, float], None]


@dataclass
class IngestionResult:
    success: bool = True
    documents_loaded: int = 0
    chunks_created: int = 0
    files_processed: list[str] = field(default_factory=list)
    errors: list[dict[str, str]] = field(default_factory=list)
    processing_time_seconds: float = 0.0
    chunks: list[Document] = field(default_factory=list, repr=False)
    source_docs: list[Document] = field(default_factory=list, repr=False)
    scientific_figures: int = 0
    scientific_tables: int = 0
    scientific_equations: int = 0


class IngestionPipeline:
    def __init__(
        self,
        vector_store: Any | None = None,
        settings: Settings | None = None,
        progress_callback: ProgressCallback | None = None,
    ) -> None:
        self._settings = settings or get_settings()
        self._vector_store = vector_store
        self._progress = progress_callback
        self._chunker = SmartChunker(self._settings)
        self._enricher = ContextualEnricher(settings=self._settings)

    def _report(self, msg: str, pct: float) -> None:
        if self._progress:
            self._progress(msg, min(pct, 1.0))

    def ingest(
        self,
        file_paths: list[Path] | None = None,
        file_uploads: list[dict[str, Any]] | None = None,
    ) -> IngestionResult:
        t0 = time.perf_counter()
        result = IngestionResult()
        items = self._build_items(file_paths, file_uploads)
        total = len(items)
        all_docs: list[Document] = []

        self._report("Loading documents…", 0.05)

        for i, (path, content) in enumerate(items):
            try:
                docs = self._load_single(path, content, result)
                all_docs.extend(docs)
                result.files_processed.append(path.name)
            except Exception as exc:
                result.errors.append({"file": path.name, "error": str(exc)})
                logger.error("file_load_error", file=path.name, error=str(exc))
            self._report(f"Loaded {path.name}", 0.05 + 0.30 * ((i + 1) / max(total, 1)))

        if not all_docs:
            result.success = False
            result.processing_time_seconds = time.perf_counter() - t0
            return result

        result.documents_loaded = len(all_docs)
        result.source_docs = [d for d in all_docs if d.metadata.get("document_type") == "full_data"]

        self._report("Chunking documents…", 0.40)
        chunks = self._chunker.chunk(all_docs)
        self._report(f"Created {len(chunks)} chunks", 0.55)

        self._report("Enriching with contextual metadata…", 0.60)
        try:
            chunks = self._enricher.enrich(chunks, result.source_docs)
        except Exception as exc:
            logger.warning("enrichment_error", error=str(exc))
        self._report("Enrichment complete", 0.75)

        if self._vector_store is not None:
            self._report("Adding to vector store…", 0.80)
            try:
                self._vector_store.add_documents(chunks)
            except Exception as exc:
                logger.error("vector_store_error", error=str(exc))
                result.errors.append({"file": "vector_store", "error": str(exc)})
                result.success = False

        result.chunks_created = len(chunks)
        result.chunks = chunks
        result.processing_time_seconds = round(time.perf_counter() - t0, 3)
        self._report("Ingestion complete!", 1.0)
        logger.info(
            "ingestion_complete",
            docs=result.documents_loaded,
            chunks=result.chunks_created,
            files=len(result.files_processed),
            errors=len(result.errors),
            time_s=result.processing_time_seconds,
        )
        return result

    def _load_single(
        self, path: Path, content: bytes | None, result: IngestionResult
    ) -> list[Document]:
        """Load a file — use scientific parser for PDFs when enabled."""
        ext = path.suffix.lower()

        if ext == ".pdf" and self._settings.enable_scientific_mode:
            if self._settings.memory_constrained:
                logger.info(
                    "scientific_pdf_skipped_memory_constrained",
                    file=path.name,
                    reason="standard_pdf_loader_used",
                )
                docs = LoaderFactory.load_file(path, content)
            else:
                docs = self._load_scientific_pdf(path, content, result)
        else:
            docs = LoaderFactory.load_file(path, content)

        if not docs:
            logger.warning("no_documents_extracted", file=path.name)
        return docs

    def _load_scientific_pdf(
        self, path: Path, content: bytes | None, result: IngestionResult
    ) -> list[Document]:
        """Parse PDF through the full scientific pipeline.

        Falls back to the standard PDF loader on any error,
        so ingestion never fails due to scientific parsing issues.
        """
        from src.ingestion.scientific import ScientificPDFParser

        raw = content if content else path.read_bytes()
        try:
            parser = ScientificPDFParser(
                output_dir=str(self._settings.data_dir / "scientific_output")
            )
            sci_doc = parser.parse(raw)
            docs = parser.to_documents(sci_doc, path.name)

            result.scientific_figures += len(sci_doc.figures)
            result.scientific_tables += len(sci_doc.tables)
            result.scientific_equations += len(sci_doc.equations)

            if docs:
                return docs
            logger.info("scientific_parser_empty — falling back to standard loader")
        except Exception as exc:
            logger.warning("scientific_parse_failed — falling back", error=str(exc))

        # Fallback to standard loader — always succeeds for valid PDFs
        try:
            return LoaderFactory.load_file(path, content)
        except Exception as exc:
            logger.error("pdf_fallback_load_failed", file=path.name, error=str(exc))
            result.errors.append({"file": path.name, "error": str(exc)})
            return []

    @staticmethod
    def _build_items(
        file_paths: list[Path] | None,
        file_uploads: list[dict[str, Any]] | None,
    ) -> list[tuple[Path, bytes | None]]:
        items: list[tuple[Path, bytes | None]] = []
        if file_paths:
            for p in file_paths:
                items.append((p, None))
        if file_uploads:
            for fu in file_uploads:
                items.append((Path(fu["filename"]), fu["content"]))
        return items
