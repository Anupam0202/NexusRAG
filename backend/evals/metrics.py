"""Deterministic RAG evaluation metrics."""

from __future__ import annotations

import math
import re
from collections.abc import Iterable
from dataclasses import dataclass, field
from typing import Any

TOKEN_RE = re.compile(r"[a-z0-9]+")
STOPWORDS = {
    "a",
    "an",
    "and",
    "are",
    "as",
    "at",
    "be",
    "by",
    "for",
    "from",
    "in",
    "is",
    "it",
    "of",
    "on",
    "or",
    "the",
    "to",
    "with",
}


@dataclass(frozen=True)
class RetrievedSource:
    filename: str
    content: str = ""
    document_id: str | None = None
    workspace_id: str | None = None
    score: float = 0.0
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class CaseMetrics:
    retrieval_recall_at_k: float
    mrr: float
    ndcg: float
    citation_precision: float
    citation_recall: float
    answer_relevance: float
    answer_support: float
    cross_workspace_leak: bool
    passed: bool

    def as_dict(self) -> dict[str, Any]:
        return {
            "retrieval_recall_at_k": self.retrieval_recall_at_k,
            "mrr": self.mrr,
            "ndcg": self.ndcg,
            "citation_precision": self.citation_precision,
            "citation_recall": self.citation_recall,
            "answer_relevance": self.answer_relevance,
            "answer_support": self.answer_support,
            "cross_workspace_leak": self.cross_workspace_leak,
            "passed": self.passed,
        }


def normalize_source_id(value: str | None) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (value or "").lower()).strip()


def tokenize(value: str) -> list[str]:
    return [token for token in TOKEN_RE.findall(value.lower()) if token not in STOPWORDS]


def token_f1(reference: str, candidate: str) -> float:
    ref_tokens = tokenize(reference)
    cand_tokens = tokenize(candidate)
    if not ref_tokens and not cand_tokens:
        return 1.0
    if not ref_tokens or not cand_tokens:
        return 0.0

    ref_counts: dict[str, int] = {}
    for token in ref_tokens:
        ref_counts[token] = ref_counts.get(token, 0) + 1

    overlap = 0
    for token in cand_tokens:
        if ref_counts.get(token, 0) > 0:
            overlap += 1
            ref_counts[token] -= 1

    if overlap == 0:
        return 0.0
    precision = overlap / len(cand_tokens)
    recall = overlap / len(ref_tokens)
    return round((2 * precision * recall) / (precision + recall), 4)


def source_matches(expected: str, source: RetrievedSource) -> bool:
    expected_norm = normalize_source_id(expected)
    if not expected_norm:
        return False
    candidates = {
        normalize_source_id(source.filename),
        normalize_source_id(source.document_id),
        normalize_source_id(str(source.metadata.get("source") or "")),
    }
    return expected_norm in candidates


def retrieval_recall_at_k(expected_sources: Iterable[str], sources: list[RetrievedSource]) -> float:
    expected = [item for item in expected_sources if item]
    if not expected:
        return 1.0 if sources else 0.5
    hits = sum(1 for item in expected if any(source_matches(item, source) for source in sources))
    return round(hits / len(expected), 4)


def mean_reciprocal_rank(expected_sources: Iterable[str], sources: list[RetrievedSource]) -> float:
    expected = [item for item in expected_sources if item]
    if not expected:
        return 1.0 if sources else 0.0
    for index, source in enumerate(sources, 1):
        if any(source_matches(item, source) for item in expected):
            return round(1 / index, 4)
    return 0.0


def ndcg_at_k(expected_sources: Iterable[str], sources: list[RetrievedSource]) -> float:
    expected = [item for item in expected_sources if item]
    if not expected:
        return 1.0 if sources else 0.0

    def relevance(source: RetrievedSource) -> int:
        return int(any(source_matches(item, source) for item in expected))

    dcg = sum(relevance(source) / math.log2(rank + 1) for rank, source in enumerate(sources, 1))
    ideal_hits = min(len(expected), len(sources))
    ideal_dcg = sum(1 / math.log2(rank + 1) for rank in range(1, ideal_hits + 1))
    return round(dcg / ideal_dcg, 4) if ideal_dcg else 0.0


def citation_precision(expected_sources: Iterable[str], sources: list[RetrievedSource]) -> float:
    if not sources:
        return 0.0
    expected = [item for item in expected_sources if item]
    if not expected:
        return 1.0
    relevant = sum(
        1 for source in sources if any(source_matches(item, source) for item in expected)
    )
    return round(relevant / len(sources), 4)


def answer_relevance(
    answer: str,
    *,
    expected_answer: str = "",
    expected_terms: Iterable[str] = (),
) -> float:
    terms = [term for term in expected_terms if term]
    term_score = 0.0
    if terms:
        answer_norm = answer.lower()
        term_score = sum(1 for term in terms if term.lower() in answer_norm) / len(terms)

    f1_score = token_f1(expected_answer, answer) if expected_answer else 0.0
    if terms and expected_answer:
        return round((term_score + f1_score) / 2, 4)
    if terms:
        return round(term_score, 4)
    if expected_answer:
        return f1_score
    return 1.0 if answer.strip() else 0.0


def answer_support(answer: str, sources: list[RetrievedSource]) -> float:
    answer_tokens = set(tokenize(answer))
    if not answer_tokens:
        return 0.0
    source_tokens = set(tokenize(" ".join(source.content for source in sources)))
    if not source_tokens:
        return 0.0
    supported = answer_tokens.intersection(source_tokens)
    return round(len(supported) / len(answer_tokens), 4)


def has_cross_workspace_leak(
    sources: list[RetrievedSource],
    *,
    workspace_id: str | None,
    forbidden_sources: Iterable[str] = (),
) -> bool:
    forbidden = [item for item in forbidden_sources if item]
    for source in sources:
        if workspace_id and source.workspace_id and source.workspace_id != workspace_id:
            return True
        if any(source_matches(item, source) for item in forbidden):
            return True
    return False


def evaluate_case(
    *,
    answer: str,
    sources: list[RetrievedSource],
    expected_sources: Iterable[str] = (),
    expected_answer: str = "",
    expected_terms: Iterable[str] = (),
    workspace_id: str | None = None,
    forbidden_sources: Iterable[str] = (),
    min_recall: float = 0.8,
    min_relevance: float = 0.5,
    min_support: float = 0.35,
) -> CaseMetrics:
    recall = retrieval_recall_at_k(expected_sources, sources)
    relevance = answer_relevance(
        answer,
        expected_answer=expected_answer,
        expected_terms=expected_terms,
    )
    support = answer_support(answer, sources)
    leaked = has_cross_workspace_leak(
        sources,
        workspace_id=workspace_id,
        forbidden_sources=forbidden_sources,
    )
    passed = (
        not leaked
        and recall >= min_recall
        and relevance >= min_relevance
        and support >= min_support
    )
    return CaseMetrics(
        retrieval_recall_at_k=recall,
        mrr=mean_reciprocal_rank(expected_sources, sources),
        ndcg=ndcg_at_k(expected_sources, sources),
        citation_precision=citation_precision(expected_sources, sources),
        citation_recall=recall,
        answer_relevance=relevance,
        answer_support=support,
        cross_workspace_leak=leaked,
        passed=passed,
    )


def summarize_metrics(results: list[dict[str, Any]]) -> dict[str, Any]:
    total = len(results)
    passed = sum(1 for item in results if item.get("passed"))
    leaks = sum(1 for item in results if item.get("metrics", {}).get("cross_workspace_leak"))
    summary: dict[str, Any] = {
        "total": total,
        "passed": passed,
        "failed": total - passed,
        "pass_rate": round(passed / total, 4) if total else 0.0,
        "cross_workspace_leaks": leaks,
    }
    metric_names = (
        "retrieval_recall_at_k",
        "mrr",
        "ndcg",
        "citation_precision",
        "citation_recall",
        "answer_relevance",
        "answer_support",
        "latency_ms",
    )
    for metric in metric_names:
        values = [float(item.get("metrics", {}).get(metric, 0.0) or 0.0) for item in results]
        summary[f"avg_{metric}"] = round(sum(values) / total, 4) if total else 0.0
    return summary
