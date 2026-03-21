"""
Query Transformation
=====================

Three strategies applied in sequence:

1. **History-aware reformulation** — rewrites the user's query so it is
   self-contained (resolves pronouns / references using chat history).
2. **Multi-query generation** — generates 2–3 alternative phrasings of
   the query to increase recall.
3. **HyDE** *(optional)* — generates a hypothetical answer and uses it
   as an additional retrieval query.

When no LLM is available (missing API key) the transformer gracefully
returns the original query unchanged.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from config.settings import Settings, get_settings
from src.utils.logger import get_logger

logger = get_logger(__name__)

_REFORMULATE_PROMPT = """Given the conversation history and the latest user question,
rewrite the question so it is self-contained (no pronouns or implicit references).
If the question is already self-contained, return it unchanged.

Conversation history:
{history}

Latest question: {question}

Rewritten question (output ONLY the rewritten question):"""

_MULTI_QUERY_PROMPT = """Generate 2 alternative versions of the following search
query to improve document retrieval.  Each version should approach the topic
from a different angle.  Return ONLY the two queries, one per line.

Original query: {question}

Alternative queries:"""


class QueryTransformer:
    """Transform user queries for better retrieval."""

    def __init__(self, settings: Optional[Settings] = None) -> None:
        self._settings = settings or get_settings()
        self._llm = None

    def _get_llm(self):
        if self._llm is not None:
            return self._llm
        if not self._settings.google_api_key:
            return None

        from langchain_google_genai import ChatGoogleGenerativeAI

        s = self._settings
        self._llm = ChatGoogleGenerativeAI(
            model=s.llm_model_name,
            temperature=0.3,
            max_tokens=256,
            google_api_key=s.google_api_key,
        )
        return self._llm

    def transform(
        self,
        query: str,
        *,
        history: Optional[List[Dict[str, str]]] = None,
    ) -> Dict[str, Any]:
        """Apply all transformations and return variant queries.

        Returns:
            ``{"queries": [str, ...], "original": str, "reformulated": str}``
        """
        original = query
        reformulated = query

        # 1. History-aware reformulation
        if history:
            reformulated = self._reformulate(query, history)

        # 2. Multi-query expansion
        variants = self._multi_query(reformulated)

        # Always include the reformulated query as the first entry
        all_queries = [reformulated] + [v for v in variants if v != reformulated]

        return {
            "queries": all_queries,
            "original": original,
            "reformulated": reformulated,
        }

    # ── strategies ────────────────────────────────────────────────────

    def _reformulate(self, query: str, history: List[Dict[str, str]]) -> str:
        llm = self._get_llm()
        if llm is None:
            return query

        history_text = "\n".join(
            f"{'User' if m.get('role') == 'user' else 'Assistant'}: {m.get('content', '')}"
            for m in history[-6:]  # last 6 messages
        )

        try:
            prompt = _REFORMULATE_PROMPT.format(history=history_text, question=query)
            resp = llm.invoke(prompt)
            text = resp.content if hasattr(resp, "content") else str(resp)
            result = text.strip()
            if result and len(result) > 5:
                logger.debug("query_reformulated", original=query, reformulated=result)
                return result
        except Exception as exc:
            logger.debug("reformulation_failed", error=str(exc))

        return query

    def _multi_query(self, query: str) -> List[str]:
        llm = self._get_llm()
        if llm is None:
            return []

        try:
            prompt = _MULTI_QUERY_PROMPT.format(question=query)
            resp = llm.invoke(prompt)
            text = resp.content if hasattr(resp, "content") else str(resp)
            lines = [l.strip().lstrip("0123456789.-) ") for l in text.strip().split("\n") if l.strip()]
            return [l for l in lines if len(l) > 10][:3]
        except Exception as exc:
            logger.debug("multi_query_failed", error=str(exc))

        return []