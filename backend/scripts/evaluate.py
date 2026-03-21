#!/usr/bin/env python3
"""
RAG Evaluation Framework
=========================

Evaluates the RAG pipeline against a test set of question–answer pairs.
Measures:
  • **Retrieval Recall** — are the right chunks retrieved?
  • **Answer Faithfulness** — is the answer grounded in retrieved context?
  • **Answer Relevance** — does the answer address the question?
  • **Latency** — end-to-end response time.

Usage::

    python scripts/evaluate.py --test-file tests/eval_set.json
    python scripts/evaluate.py --auto            # auto-generate test questions

Test set JSON format::

    [
      {
        "question": "What was Q1 revenue?",
        "expected_answer": "$10M",
        "expected_sources": ["report.pdf"]
      }
    ]
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from config.settings import get_settings
from src.generation.chain import RAGChain
from src.generation.llm import get_llm_provider
from src.retrieval.vector_store import VectorStoreManager
from src.utils.logger import get_logger

logger = get_logger("evaluate")


# ── Data structures ──────────────────────────────────────────────────────


@dataclass
class TestCase:
    question: str
    expected_answer: str = ""
    expected_sources: List[str] = field(default_factory=list)


@dataclass
class EvalResult:
    question: str
    answer: str
    sources_returned: List[str]
    retrieval_recall: float
    faithfulness: float
    relevance: float
    latency_seconds: float
    passed: bool


@dataclass
class EvalSummary:
    total: int = 0
    passed: int = 0
    avg_retrieval_recall: float = 0.0
    avg_faithfulness: float = 0.0
    avg_relevance: float = 0.0
    avg_latency: float = 0.0
    results: List[EvalResult] = field(default_factory=list)


# ── Evaluation logic ─────────────────────────────────────────────────────


class RAGEvaluator:
    """Evaluate RAG pipeline quality."""

    def __init__(self) -> None:
        settings = get_settings()
        self._vs = VectorStoreManager(settings=settings)
        self._chain = RAGChain(vector_store=self._vs, settings=settings)
        self._llm = get_llm_provider()

    def evaluate(self, test_cases: List[TestCase]) -> EvalSummary:
        """Run evaluation on a list of test cases."""
        summary = EvalSummary(total=len(test_cases))
        total_recall = 0.0
        total_faith = 0.0
        total_rel = 0.0
        total_lat = 0.0

        for i, tc in enumerate(test_cases, 1):
            print(f"\n[{i}/{len(test_cases)}] Q: {tc.question}")

            t0 = time.perf_counter()
            result = self._chain.query(tc.question, session_id=f"eval-{i}")
            latency = time.perf_counter() - t0

            answer = result["answer"]
            sources_returned = [
                s.get("filename", "") for s in result.get("sources", [])
            ]

            # Retrieval recall
            recall = self._compute_retrieval_recall(
                tc.expected_sources, sources_returned
            )

            # Faithfulness (LLM-judged)
            faithfulness = self._judge_faithfulness(
                tc.question, answer, result.get("sources", [])
            )

            # Relevance (LLM-judged)
            relevance = self._judge_relevance(tc.question, answer, tc.expected_answer)

            passed = recall >= 0.5 and faithfulness >= 0.5 and relevance >= 0.5

            er = EvalResult(
                question=tc.question,
                answer=str(answer)[:200],  # type: ignore
                sources_returned=sources_returned,
                retrieval_recall=recall,
                faithfulness=faithfulness,
                relevance=relevance,
                latency_seconds=round(latency, 3),  # type: ignore
                passed=passed,
            )
            summary.results.append(er)
            if passed:
                summary.passed += 1

            total_recall += recall
            total_faith += faithfulness
            total_rel += relevance
            total_lat += latency

            status = "✅" if passed else "❌"
            print(f"   {status}  Recall={recall:.2f}  Faith={faithfulness:.2f}  "
                  f"Rel={relevance:.2f}  Lat={latency:.1f}s")

        n = max(len(test_cases), 1)
        summary.avg_retrieval_recall = round(total_recall / n, 3)  # type: ignore
        summary.avg_faithfulness = round(total_faith / n, 3)  # type: ignore
        summary.avg_relevance = round(total_rel / n, 3)  # type: ignore
        summary.avg_latency = round(total_lat / n, 3)  # type: ignore

        return summary

    # ── Metrics ───────────────────────────────────────────────────────

    @staticmethod
    def _compute_retrieval_recall(
        expected: List[str], returned: List[str]
    ) -> float:
        if not expected:
            return 1.0 if returned else 0.5
        expected_set = {e.lower() for e in expected}
        returned_set = {r.lower() for r in returned}
        hits = expected_set & returned_set
        return len(hits) / len(expected_set) if expected_set else 1.0

    def _judge_faithfulness(
        self, question: str, answer: str, sources: List[Dict[str, Any]]
    ) -> float:
        """Use LLM to judge whether the answer is grounded in sources."""
        context_text = "\n".join(
            str(s.get("content", ""))[:300] for s in sources[:5]  # type: ignore
        )
        if not context_text.strip():
            return 0.0

        prompt = (
            f"Question: {question}\n\n"
            f"Context (source documents):\n{context_text}\n\n"
            f"Answer: {str(answer)[:500]}\n\n"  # type: ignore
            "On a scale of 0.0 to 1.0, rate how faithfully the answer is "
            "grounded in the provided context. A faithful answer only contains "
            "information present in the context. "
            "Output ONLY a single decimal number, nothing else."
        )
        return self._llm_score(prompt)

    def _judge_relevance(
        self, question: str, answer: str, expected: str
    ) -> float:
        """Use LLM to judge answer relevance to the question."""
        prompt = (
            f"Question: {question}\n\n"
            f"Answer: {str(answer)[:500]}\n\n"  # type: ignore
        )
        if expected:
            prompt += f"Expected answer contains: {str(expected)[:200]}\n\n"  # type: ignore
        prompt += (
            "On a scale of 0.0 to 1.0, rate how relevant and helpful "
            "the answer is for the question. "
            "Output ONLY a single decimal number, nothing else."
        )
        return self._llm_score(prompt)

    def _llm_score(self, prompt: str) -> float:
        """Call LLM and parse a float score."""
        try:
            resp = self._llm.invoke(prompt)
            import re
            match = re.search(r"(\d+\.?\d*)", resp)
            if match:
                score = float(match.group(1))
                return min(max(score, 0.0), 1.0)
        except Exception as exc:
            logger.warning("llm_judge_failed", error=str(exc))
        return 0.5

    # ── Auto-generate test questions ──────────────────────────────────

    def auto_generate(self, num_questions: int = 5) -> List[TestCase]:
        """Generate test questions from indexed documents."""
        docs = self._vs.list_documents()
        if not docs:
            print("No documents indexed. Ingest documents first.")
            return []

        filenames = [d["filename"] for d in docs[:3]]
        prompt = (
            f"I have these documents indexed: {', '.join(filenames)}.\n"
            f"Generate {num_questions} diverse test questions that could be "
            f"answered using these documents. For each, provide the expected "
            f"source filename.\n\n"
            f"Return valid JSON array:\n"
            f'[{{"question":"...","expected_sources":["filename.ext"]}}]'
        )
        try:
            resp = self._llm.invoke(prompt)
            import re
            match = re.search(r"\[.*\]", resp, re.DOTALL)
            if match:
                data = json.loads(match.group())
                return [
                    TestCase(
                        question=item["question"],
                        expected_sources=item.get("expected_sources", []),
                    )
                    for item in data
                ]
        except Exception as exc:
            logger.warning("auto_generate_failed", error=str(exc))

        return [TestCase(question="Summarize the documents")]


# ── CLI ───────────────────────────────────────────────────────────────────


def main() -> None:
    parser = argparse.ArgumentParser(description="Evaluate RAG pipeline")
    parser.add_argument("--test-file", type=str, help="Path to test set JSON")
    parser.add_argument("--auto", action="store_true", help="Auto-generate test questions")
    parser.add_argument("--num-questions", type=int, default=5)
    args = parser.parse_args()

    evaluator = RAGEvaluator()

    if args.test_file:
        with open(args.test_file) as f:
            raw = json.load(f)
        test_cases = [
            TestCase(
                question=tc["question"],
                expected_answer=tc.get("expected_answer", ""),
                expected_sources=tc.get("expected_sources", []),
            )
            for tc in raw
        ]
    elif args.auto:
        test_cases = evaluator.auto_generate(args.num_questions)
        if not test_cases:
            sys.exit(1)
    else:
        parser.print_help()
        sys.exit(1)

    print(f"\n{'='*60}")
    print(f"  RAG Evaluation — {len(test_cases)} test cases")
    print(f"{'='*60}")

    summary = evaluator.evaluate(test_cases)

    print(f"\n{'='*60}")
    print(f"  RESULTS")
    print(f"{'='*60}")
    print(f"  Total:              {summary.total}")
    print(f"  Passed:             {summary.passed}/{summary.total}")
    print(f"  Pass Rate:          {summary.passed/max(summary.total,1)*100:.0f}%")
    print(f"  Avg Retrieval Recall: {summary.avg_retrieval_recall:.3f}")
    print(f"  Avg Faithfulness:     {summary.avg_faithfulness:.3f}")
    print(f"  Avg Relevance:        {summary.avg_relevance:.3f}")
    print(f"  Avg Latency:          {summary.avg_latency:.1f}s")
    print(f"{'='*60}\n")

    # Write report
    report_path = Path("data/eval_report.json")
    report_path.parent.mkdir(parents=True, exist_ok=True)
    with open(report_path, "w") as f:
        json.dump(
            {
                "summary": {
                    "total": summary.total,
                    "passed": summary.passed,
                    "avg_retrieval_recall": summary.avg_retrieval_recall,
                    "avg_faithfulness": summary.avg_faithfulness,
                    "avg_relevance": summary.avg_relevance,
                    "avg_latency": summary.avg_latency,
                },
                "results": [
                    {
                        "question": r.question,
                        "answer": r.answer,
                        "sources": r.sources_returned,
                        "retrieval_recall": r.retrieval_recall,
                        "faithfulness": r.faithfulness,
                        "relevance": r.relevance,
                        "latency": r.latency_seconds,
                        "passed": r.passed,
                    }
                    for r in summary.results
                ],
            },
            f,
            indent=2,
        )
    print(f"📄 Report saved to {report_path}")


if __name__ == "__main__":
    main()
