"""
Ingestion Module — Multi-format loading, scientific parsing,
chunking, contextual enrichment, embedding, pipeline orchestration.
"""

from src.ingestion.loader import LoaderFactory
from src.ingestion.chunker import SmartChunker
from src.ingestion.contextualizer import ContextualEnricher
from src.ingestion.embedder import Embedder
from src.ingestion.pipeline import IngestionPipeline, IngestionResult
from src.ingestion.scientific import ScientificPDFParser

__all__ = [
    "LoaderFactory",
    "SmartChunker",
    "ContextualEnricher",
    "Embedder",
    "IngestionPipeline",
    "IngestionResult",
    "ScientificPDFParser",
]