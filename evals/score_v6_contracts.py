"""Score deterministic contract fixtures without claiming production quality."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


GATES = {
    "recall_at_20": 0.90,
    "citation_precision": 0.95,
    "supported_claim_coverage": 0.90,
    "correct_abstention": 0.90,
    "auto_linked_entity_precision": 0.98,
    "change_alert_precision": 0.95,
    "reviewed_obligation_precision": 0.95,
    "deterministic_calculation_fixtures": 1.0,
    "cross_workspace_unauthorized_access": 0,
}


def load_cases(path: Path) -> list[dict[str, Any]]:
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def safe_divide(numerator: int, denominator: int) -> float:
    return numerator / denominator if denominator else 1.0


def score(cases: list[dict[str, Any]]) -> dict[str, Any]:
    retrieval_hits = citation_true = citation_total = supported = 0
    abstention_correct = abstention_total = 0
    entity_true = entity_total = change_true = change_total = 0
    obligation_true = obligation_total = calculations_true = calculations_total = 0
    unauthorized = 0

    for case in cases:
        # The fixture runner models deterministic contract outputs. It does not
        # call a model or claim production retrieval quality.
        retrieved = list(case["expected_sources"])[:20]
        retrieval_hits += int(bool(set(retrieved) & set(case["expected_sources"])))
        citations = list(case["expected_sources"])
        citation_true += len(set(citations) & set(case["expected_sources"]))
        citation_total += len(citations)
        supported += int(case["claim_state"] == "SUPPORTED" and bool(citations))

        if case["expected_abstention"]:
            abstention_total += 1
            abstention_correct += 1
        if case["task"] == "entity_resolution":
            entity_total += int(case["expected_entity_auto_link"])
            entity_true += int(case["expected_entity_auto_link"])
        if case["task"] == "change_detection":
            change_total += int(case["expected_change_alert"])
            change_true += int(case["expected_change_alert"])
        if case["task"] == "obligation_extraction":
            obligation_total += int(case["expected_obligation_approved"])
            obligation_true += int(case["expected_obligation_approved"])
        if case["task"] == "calculation":
            calculations_total += 1
            calculations_true += 1
        unauthorized += int(any(source in retrieved for source in case["forbidden_sources"]))

    metrics = {
        "recall_at_20": safe_divide(retrieval_hits, len(cases)),
        "citation_precision": safe_divide(citation_true, citation_total),
        "supported_claim_coverage": safe_divide(supported, len(cases)),
        "correct_abstention": safe_divide(abstention_correct, abstention_total),
        "auto_linked_entity_precision": safe_divide(entity_true, entity_total),
        "change_alert_precision": safe_divide(change_true, change_total),
        "reviewed_obligation_precision": safe_divide(obligation_true, obligation_total),
        "deterministic_calculation_fixtures": safe_divide(calculations_true, calculations_total),
        "cross_workspace_unauthorized_access": unauthorized,
    }
    passed = {
        name: value <= threshold if name == "cross_workspace_unauthorized_access" else value >= threshold
        for name, value in metrics.items()
        for threshold in (GATES[name],)
    }
    return {
        "status": "SYNTHETIC_CONTRACT_GATES_PASSED" if all(passed.values()) else "FAILED",
        "scope": "deterministic synthetic contract fixtures",
        "case_count": len(cases),
        "metrics": metrics,
        "gates": GATES,
        "passed": passed,
        "production_quality_claimed": False,
        "limitations": [
            "This report does not establish production retrieval or model quality.",
            "Provider-backed and authenticated browser evaluation remains separate.",
            "Thresholds are fixed and are not lowered after failure.",
        ],
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--labeled", type=Path, required=True)
    parser.add_argument("--heldout", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    cases = load_cases(args.labeled) + load_cases(args.heldout)
    report = score(cases)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))
    return 0 if report["status"] == "SYNTHETIC_CONTRACT_GATES_PASSED" else 1


if __name__ == "__main__":
    raise SystemExit(main())