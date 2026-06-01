"""Run NexusRAG RAG quality evaluations.

Default modes avoid external LLM calls:

* retrieval: evaluate search and citations directly.
* extractive: build an answer by quoting retrieved chunks.
* rag: call the full RAG chain for manual provider-backed checks.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
import time
from collections.abc import Iterable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from langchain_core.documents import Document

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from config.settings import Settings, get_settings  # noqa: E402
from evals.metrics import RetrievedSource, evaluate_case, summarize_metrics  # noqa: E402
from src.ingestion.embedder import get_embedder  # noqa: E402
from src.retrieval.vector_store import SearchHit, VectorStoreManager  # noqa: E402
from src.utils.helpers import truncate  # noqa: E402
from src.utils.tenant import DEFAULT_WORKSPACE_ID, normalize_workspace_id  # noqa: E402

DEFAULT_DATASET = Path(__file__).resolve().parent / "datasets" / "sample_corpus.json"
DEFAULT_REPORT = Path(__file__).resolve().parent / "reports" / "latest.json"


@dataclass(frozen=True)
class CorpusItem:
    filename: str
    content: str
    workspace_id: str = DEFAULT_WORKSPACE_ID
    document_id: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class GoldenCase:
    id: str
    question: str
    workspace_id: str = DEFAULT_WORKSPACE_ID
    expected_answer: str = ""
    expected_terms: list[str] = field(default_factory=list)
    expected_sources: list[str] = field(default_factory=list)
    forbidden_sources: list[str] = field(default_factory=list)
    top_k: int = 5


def configure_eval_environment() -> None:
    """Set defaults before cached settings and embedder objects are created."""
    os.environ.setdefault("ENABLE_LIGHTWEIGHT_EMBEDDINGS", "true")
    os.environ.setdefault("ENABLE_CACHE", "false")
    os.environ.setdefault("ENABLE_RERANKING", "false")
    os.environ.setdefault("ENABLE_CONTEXTUAL_ENRICHMENT", "false")
    os.environ.setdefault("LOG_LEVEL", "WARNING")
    get_settings.cache_clear()
    get_embedder.cache_clear()


def load_dataset(path: Path) -> tuple[list[CorpusItem], list[GoldenCase]]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(raw, list):
        return [], [_case_from_dict(item, index) for index, item in enumerate(raw, 1)]
    corpus = [_corpus_from_dict(item) for item in raw.get("corpus", [])]
    cases = [_case_from_dict(item, index) for index, item in enumerate(raw.get("cases", []), 1)]
    return corpus, cases


def _corpus_from_dict(item: dict[str, Any]) -> CorpusItem:
    content = item.get("content")
    if content is None and isinstance(item.get("chunks"), list):
        content = "\n\n".join(str(chunk) for chunk in item["chunks"])
    return CorpusItem(
        filename=str(item["filename"]),
        content=str(content or ""),
        workspace_id=normalize_workspace_id(item.get("workspace_id")),
        document_id=str(item.get("document_id") or item["filename"]),
        metadata=dict(item.get("metadata") or {}),
    )


def _case_from_dict(item: dict[str, Any], index: int) -> GoldenCase:
    return GoldenCase(
        id=str(item.get("id") or f"case-{index}"),
        question=str(item["question"]),
        workspace_id=normalize_workspace_id(item.get("workspace_id")),
        expected_answer=str(item.get("expected_answer") or ""),
        expected_terms=[str(term) for term in item.get("expected_terms", [])],
        expected_sources=[str(source) for source in item.get("expected_sources", [])],
        forbidden_sources=[str(source) for source in item.get("forbidden_sources", [])],
        top_k=int(item.get("top_k") or 5),
    )


def build_vector_store(
    corpus: Iterable[CorpusItem],
    *,
    vector_store_path: str,
) -> VectorStoreManager:
    settings = Settings(
        vector_store_path=vector_store_path,
        enable_lightweight_embeddings=True,
        enable_cache=False,
        enable_reranking=False,
        enable_contextual_enrichment=False,
        similarity_threshold=0.0,
    )
    vs = VectorStoreManager(settings=settings)
    vs._documents = []
    vs._raw_embeddings = []
    vs._index = None
    vs._bm25 = None
    for index, item in enumerate(corpus):
        metadata = {
            "filename": item.filename,
            "file_type": Path(item.filename).suffix.lower().lstrip(".") or "text",
            "document_type": "eval",
            "chunk_index": index,
            **item.metadata,
        }
        vs.add_documents(
            [Document(page_content=item.content, metadata=metadata)],
            workspace_id=item.workspace_id,
            document_id=item.document_id or item.filename,
        )
    return vs


def sources_from_hits(hits: list[SearchHit]) -> list[RetrievedSource]:
    sources: list[RetrievedSource] = []
    for hit in hits:
        meta = hit.document.metadata
        sources.append(
            RetrievedSource(
                filename=str(meta.get("filename") or ""),
                document_id=str(meta.get("document_id") or ""),
                workspace_id=str(meta.get("workspace_id") or ""),
                content=hit.document.page_content,
                score=hit.score,
                metadata=dict(meta),
            )
        )
    return sources


def build_extractive_answer(question: str, sources: list[RetrievedSource]) -> str:
    if not sources:
        return (
            "No relevant document excerpts were retrieved for this question. "
            "The system should ask for more context or ingest the needed source."
        )
    lines = [f"Extractive answer for: {question}", ""]
    for index, source in enumerate(sources[:5], 1):
        lines.append(f"{index}. {source.filename}: {truncate(source.content, 450)}")
    return "\n".join(lines)


def run_evaluation(
    *,
    dataset_path: Path = DEFAULT_DATASET,
    report_path: Path = DEFAULT_REPORT,
    mode: str = "retrieval",
    top_k: int | None = None,
    fail_under_recall: float = 0.0,
    fail_on_leak: bool = True,
) -> dict[str, Any]:
    configure_eval_environment()
    corpus, cases = load_dataset(dataset_path)
    if not cases:
        raise ValueError(f"No evaluation cases found in {dataset_path}")

    with tempfile.TemporaryDirectory(prefix="nexusrag-eval-") as tmp_dir:
        vs = build_vector_store(corpus, vector_store_path=tmp_dir)
        chain = None
        if mode == "rag":
            from src.generation.chain import RAGChain

            chain = RAGChain(vector_store=vs)

        results: list[dict[str, Any]] = []
        for case in cases:
            started = time.perf_counter()
            case_top_k = top_k or case.top_k
            if mode == "rag" and chain is not None:
                response = chain.query(
                    case.question,
                    workspace_id=case.workspace_id,
                    session_id=f"eval-{case.id}",
                    top_k=case_top_k,
                    use_reranking=False,
                )
                answer = str(response.get("answer") or "")
                sources = [
                    RetrievedSource(
                        filename=str(source.get("filename") or ""),
                        document_id=str(source.get("metadata", {}).get("document_id") or ""),
                        workspace_id=str(
                            source.get("metadata", {}).get("workspace_id") or case.workspace_id
                        ),
                        content=str(source.get("content") or ""),
                        score=float(source.get("relevance_score") or 0.0),
                        metadata=dict(source.get("metadata") or {}),
                    )
                    for source in response.get("sources", [])
                ]
            else:
                hits = vs.search(case.question, top_k=case_top_k, workspace_id=case.workspace_id)
                sources = sources_from_hits(hits)
                answer = build_extractive_answer(case.question, sources)

            latency_ms = round((time.perf_counter() - started) * 1000, 2)
            metrics = evaluate_case(
                answer=answer,
                sources=sources,
                expected_sources=case.expected_sources,
                expected_answer=case.expected_answer,
                expected_terms=case.expected_terms,
                workspace_id=case.workspace_id,
                forbidden_sources=case.forbidden_sources,
            )
            metrics_payload = metrics.as_dict()
            metrics_payload["latency_ms"] = latency_ms
            results.append(
                {
                    "id": case.id,
                    "question": case.question,
                    "workspace_id": case.workspace_id,
                    "mode": mode,
                    "answer": answer,
                    "sources": [
                        {
                            "filename": source.filename,
                            "document_id": source.document_id,
                            "workspace_id": source.workspace_id,
                            "score": round(source.score, 4),
                        }
                        for source in sources
                    ],
                    "metrics": metrics_payload,
                    "passed": metrics.passed,
                }
            )

    summary = summarize_metrics(results)
    report = {
        "dataset": str(dataset_path),
        "mode": mode,
        "summary": summary,
        "results": results,
    }
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")

    if fail_on_leak and summary["cross_workspace_leaks"]:
        raise SystemExit("Evaluation failed: cross-workspace leakage detected.")
    if fail_under_recall and summary["avg_retrieval_recall_at_k"] < fail_under_recall:
        raise SystemExit(
            "Evaluation failed: average recall "
            f"{summary['avg_retrieval_recall_at_k']:.3f} < {fail_under_recall:.3f}."
        )
    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run NexusRAG evaluation harness")
    parser.add_argument("--dataset", type=Path, default=DEFAULT_DATASET)
    parser.add_argument("--report", type=Path, default=DEFAULT_REPORT)
    parser.add_argument("--mode", choices=("retrieval", "extractive", "rag"), default="retrieval")
    parser.add_argument("--top-k", type=int, default=None)
    parser.add_argument("--fail-under-recall", type=float, default=0.0)
    parser.add_argument("--allow-leaks", action="store_true")
    args = parser.parse_args(argv)

    report = run_evaluation(
        dataset_path=args.dataset,
        report_path=args.report,
        mode=args.mode,
        top_k=args.top_k,
        fail_under_recall=args.fail_under_recall,
        fail_on_leak=not args.allow_leaks,
    )
    print(json.dumps(report["summary"], indent=2))
    print(f"Report saved to {args.report}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
