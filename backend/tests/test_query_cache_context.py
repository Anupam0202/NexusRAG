"""Real cache contracts with synthetic retrieval and generation, never providers."""

from types import SimpleNamespace

import pytest
from langchain_core.documents import Document

from config.settings import Settings
from src.generation.chain import RAGChain
from src.retrieval.cache import SemanticCache
from src.retrieval.retriever import QueryType


class ConstantEmbedder:
    def embed_query(self, _query):
        return [1.0, 0.0, 0.0]


@pytest.fixture
def cached_chain(monkeypatch):
    calls = []

    class Retriever:
        def retrieve(self, _question, **kwargs):
            calls.append(kwargs)
            history = kwargs["history"]
            marker = history[-1]["content"] if history else "no prior context"
            text = f"Evidence for {marker}; k={kwargs['top_k']}; rerank={kwargs['use_reranking']}"
            return {
                "documents": [Document(page_content=text, metadata={"filename": "synthetic.txt", "score": 0.9})],
                "query_type": QueryType.SPECIFIC,
                "k_used": kwargs["top_k"] or 1,
                "transformed_queries": ["synthetic evidence"],
            }

    class LLM:
        _model_name = "synthetic-only"

        def invoke_messages(self, messages):
            return messages[-1].content

        async def stream_messages(self, messages):
            yield messages[-1].content

    monkeypatch.setattr("src.generation.chain.get_llm_provider", lambda: LLM())
    chain = RAGChain(SimpleNamespace(), settings=Settings(_env_file=None, enable_cache=True))
    chain._retriever = Retriever()
    chain._cache._embedder = ConstantEmbedder()
    return chain, calls


async def answer(chain, mode, session, **kwargs):
    if mode == "query":
        return chain.query("What does it say?", workspace_id="synthetic-workspace", session_id=session, **kwargs)
    events = [event async for event in chain.stream(
        "What does it say?", workspace_id="synthetic-workspace", session_id=session, **kwargs
    )]
    return {"answer": "".join(e["content"] for e in events if e["type"] == "token"), "metadata": events[-1]["metadata"]}


@pytest.mark.asyncio
@pytest.mark.parametrize("mode", ["query", "stream"])
async def test_answer_cache_separates_retrieval_history(cached_chain, mode):
    chain, calls = cached_chain
    first = await answer(chain, mode, "resume", conversation_history=[{"role": "user", "content": "resume-only marker"}])
    second = await answer(chain, mode, "letter", conversation_history=[{"role": "user", "content": "cover-letter-only marker"}])
    assert len(calls) == 2
    assert "resume-only marker" in first["answer"]
    assert "cover-letter-only marker" in second["answer"]
    assert "resume-only marker" not in second["answer"]
    assert first["metadata"]["cache_namespace"] != second["metadata"]["cache_namespace"]
    assert "resume-only marker" not in first["metadata"]["cache_namespace"]


@pytest.mark.asyncio
@pytest.mark.parametrize("mode", ["query", "stream"])
@pytest.mark.parametrize("options", [(dict(top_k=1), dict(top_k=5)), (dict(use_reranking=False), dict(use_reranking=True))])
async def test_answer_cache_separates_options_and_retains_matching_hits(cached_chain, mode, options):
    chain, calls = cached_chain
    first = await answer(chain, mode, "first", **options[0])
    second = await answer(chain, mode, "second", **options[1])
    cached = await answer(chain, mode, "same-context-new-session", **options[1])
    assert len(calls) == 2
    assert first["answer"] != second["answer"]
    assert cached["answer"] == second["answer"]
    assert cached["metadata"]["from_cache"] is True
    assert chain.get_session_history("same-context-new-session", workspace_id="synthetic-workspace")[-2:][0]["role"] == "user"


@pytest.mark.asyncio
@pytest.mark.parametrize("modes", [("query", "stream"), ("stream", "query")])
async def test_blocking_and_stream_cache_response_contracts_do_not_alias(cached_chain, modes):
    chain, calls = cached_chain
    first = await answer(chain, modes[0], "first")
    second = await answer(chain, modes[1], "second")
    assert len(calls) == 2
    assert first["metadata"]["cache_namespace"] != second["metadata"]["cache_namespace"]
    if modes[1] == "query":
        assert second["query_type"] == "specific"
    else:
        assert second["metadata"]["query_type"] == "specific"


@pytest.mark.asyncio
@pytest.mark.parametrize("mode", ["query", "stream"])
async def test_cache_hit_records_memory_for_the_followup(cached_chain, mode):
    chain, calls = cached_chain
    first = await answer(chain, mode, "first")
    hit = await answer(chain, mode, "fresh")
    assert hit["answer"] == first["answer"]
    assert len(calls) == 1
    history = chain.get_session_history("fresh", workspace_id="synthetic-workspace")
    assert [m["role"] for m in history] == ["user", "assistant"]
    await answer(chain, mode, "fresh")
    assert len(calls) == 2
    assert calls[-1]["history"] == [{"role": m["role"], "content": m["content"]} for m in history]


@pytest.mark.parametrize("mutated_side", ["set_input", "get_output"])
def test_semantic_cache_owns_nested_response_snapshots(mutated_side):
    cache = SemanticCache(settings=Settings(_env_file=None, enable_cache=True))
    cache._embedder = ConstantEmbedder()
    response = {"answer": "original", "sources": [{"metadata": {"document_id": "original"}}]}
    cache.set("question", response, workspace_id="workspace")
    changed = response if mutated_side == "set_input" else cache.get("question", workspace_id="workspace")
    changed["answer"] = "overwritten"
    changed["sources"][0]["metadata"]["document_id"] = "overwritten"
    assert cache.get("question", workspace_id="workspace") == {
        "answer": "original", "sources": [{"metadata": {"document_id": "original"}}]
    }
