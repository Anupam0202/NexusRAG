from __future__ import annotations

import json

from evals.metrics import RetrievedSource, evaluate_case, summarize_metrics, token_f1
from evals.run_eval import DEFAULT_DATASET, run_evaluation


def test_token_f1_scores_overlap() -> None:
    assert token_f1("Q1 revenue was 10 million USD", "Revenue in Q1 was 10 million USD") > 0.7
    assert token_f1("alpha revenue", "unrelated launch code") == 0.0


def test_case_metrics_detect_cross_workspace_leak() -> None:
    sources = [
        RetrievedSource(
            filename="beta_confidential_plan.txt",
            workspace_id="workspace-beta",
            content="Beta amber launch code.",
        )
    ]

    metrics = evaluate_case(
        answer="Beta amber launch code.",
        sources=sources,
        expected_sources=["beta_confidential_plan.txt"],
        expected_terms=["amber"],
        workspace_id="workspace-alpha",
    )

    assert metrics.cross_workspace_leak is True
    assert metrics.passed is False


def test_sample_eval_runs_without_llm_and_writes_report(tmp_path) -> None:
    report_path = tmp_path / "report.json"

    report = run_evaluation(
        dataset_path=DEFAULT_DATASET,
        report_path=report_path,
        mode="retrieval",
        fail_under_recall=0.8,
    )

    saved = json.loads(report_path.read_text(encoding="utf-8"))
    assert saved["summary"]["total"] == 3
    assert report["summary"]["cross_workspace_leaks"] == 0
    assert report["summary"]["avg_retrieval_recall_at_k"] >= 0.8
    assert all(item["passed"] for item in report["results"])


def test_summary_reports_percentiles_fallback_quota_and_cost() -> None:
    results = [
        {
            "passed": True,
            "metrics": {
                "latency_ms": 100,
                "generation_fallback": False,
                "quota_failure": False,
                "estimated_cost_usd": 0.01,
            },
        },
        {
            "passed": False,
            "metrics": {
                "latency_ms": 400,
                "generation_fallback": True,
                "quota_failure": True,
                "estimated_cost_usd": 0.03,
            },
        },
    ]

    summary = summarize_metrics(results)

    assert summary["latency_p50_ms"] == 250.0
    assert summary["latency_p95_ms"] == 385.0
    assert summary["fallback_rate"] == 0.5
    assert summary["quota_failure_rate"] == 0.5
    assert summary["avg_estimated_cost_usd"] == 0.02
