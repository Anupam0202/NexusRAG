"""
Contextual Chunk Enrichment  (Anthropic-style)
===============================================

Before embedding, each chunk is *enriched* with a brief, LLM-generated
context blurb that situates the chunk within its source document.  This
dramatically improves retrieval quality for chunks that lack standalone
meaning (e.g. "Revenue grew 15% YoY" — from which document? which section?).

The enrichment prompt is cheap (short input → short output), and results
are cached so re-ingesting the same document is nearly free.

Reference: https://www.anthropic.com/news/contextual-retrieval
"""

from __future__ import annotations

import hashlib
from typing import Dict, List, Optional

from langchain_core.documents import Document

from config.settings import Settings, get_settings
from src.utils.logger import get_logger

logger = get_logger(__name__)

_CONTEXT_PROMPT = """<document>
{doc_summary}
</document>

Here is the chunk we want to situate within the document:
<chunk>
{chunk_text}
</chunk>

Give a short, succinct context (2-3 sentences MAX) to situate this chunk
within the overall document for the purposes of improving search retrieval.
Answer ONLY with the context — no preamble, no labels."""


class ContextualEnricher:
    """Prepend LLM-generated document context to every chunk.

    Usage::

        enricher = ContextualEnricher(llm)
        enriched_chunks = enricher.enrich(chunks, source_docs)
    """

    def __init__(
        self,
        llm: Optional[object] = None,
        settings: Optional[Settings] = None,
    ) -> None:
        self._settings = settings or get_settings()
        self._llm = llm
        self._cache: Dict[str, str] = {}  # chunk_hash → context

    def _get_llm(self):
        """Lazy-load LLM only when needed."""
        if self._llm is not None:
            return self._llm

        from langchain_google_genai import ChatGoogleGenerativeAI

        s = self._settings
        self._llm = ChatGoogleGenerativeAI(
            model=s.llm_model_name,
            temperature=0.0,
            max_tokens=256,
            google_api_key=s.google_api_key,
        )
        return self._llm

    def enrich(
        self,
        chunks: List[Document],
        source_docs: List[Document],
    ) -> List[Document]:
        """Enrich every chunk with document-level context.

        Args:
            chunks: Chunked documents to enrich.
            source_docs: The *original* (pre-chunking) documents from
                         which the chunks were derived.  Used to generate
                         the document summary passed to the LLM.

        Returns:
            New list of ``Document`` objects with enriched ``page_content``.
        """
        if not self._settings.enable_contextual_enrichment:
            logger.info("contextual_enrichment_disabled")
            return chunks

        if not self._settings.google_api_key:
            logger.warning("contextual_enrichment_skipped — no API key")
            return chunks

        # Build source → summary map (truncated full-data docs)
        summaries = self._build_summaries(source_docs)

        enriched: List[Document] = []
        success = 0
        skipped = 0
        quota_hit = False

        for chunk in chunks:
            # If we already hit quota, skip remaining enrichments
            if quota_hit:
                enriched.append(chunk)
                skipped += 1
                continue

            source_file = chunk.metadata.get("filename", "")
            summary = summaries.get(source_file, "")

            if not summary:
                enriched.append(chunk)
                skipped += 1
                continue

            cache_key = self._hash(chunk.page_content + summary)
            if cache_key in self._cache:
                context = self._cache[cache_key]
            else:
                context, quota_hit = self._generate_context(summary, chunk.page_content)
                if context:
                    self._cache[cache_key] = context

            if context:
                new_content = f"[Context: {context}]\n\n{chunk.page_content}"
                new_meta = {**chunk.metadata, "contextual_enrichment": True}
                enriched.append(Document(page_content=new_content, metadata=new_meta))
                success += 1
            else:
                enriched.append(chunk)
                skipped += 1

        logger.info(
            "contextual_enrichment_complete",
            enriched=success,
            skipped=skipped,
            total=len(chunks),
        )
        return enriched

    # ── internals ─────────────────────────────────────────────────────

    def _build_summaries(self, source_docs: List[Document]) -> Dict[str, str]:
        """Map filename → truncated document text (max 4000 chars)."""
        summaries: Dict[str, str] = {}
        for doc in source_docs:
            fname = doc.metadata.get("filename", "")
            if fname and fname not in summaries:
                text = doc.page_content[:4000]
                summaries[fname] = text
        return summaries

    def _generate_context(self, summary: str, chunk_text: str) -> tuple[str, bool]:
        """Call LLM to generate contextual blurb for a single chunk.

        Returns:
            (context_text, quota_hit) — quota_hit is True when a rate-limit
            error is detected so the caller can skip remaining enrichments.
        """
        import time as _time

        try:
            llm = self._get_llm()
            prompt = _CONTEXT_PROMPT.format(
                doc_summary=summary[:3000],
                chunk_text=chunk_text[:1500],
            )
            response = llm.invoke(prompt)
            text = response.content if hasattr(response, "content") else str(response)

            # Throttle to stay under free-tier RPM limit (5 RPM = 12s apart)
            _time.sleep(2)

            return text.strip()[:500], False
        except Exception as exc:
            err_msg = str(exc).lower()
            is_quota = any(kw in err_msg for kw in (
                "429", "quota", "rate limit", "resource_exhausted", "resource exhausted",
            ))
            if is_quota:
                logger.warning("context_generation_quota_hit — skipping remaining")
                return "", True
            logger.debug("context_generation_failed", error=str(exc))
            return "", False

    @staticmethod
    def _hash(text: str) -> str:
        return hashlib.md5(text.encode()).hexdigest()