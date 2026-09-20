"""Build deterministic, non-provider-backed V6 evaluation inventories.

These fixtures establish labeled-case coverage and split integrity. They do not
claim retrieval, model, accessibility, or end-to-end quality-gate passage.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

DOMAINS = (
    "evidence_workbench",
    "api_terms_radar",
    "obligation_compiler",
    "procurement_graph",
    "counterparty_graph",
    "product_passport",
    "scientific_evidence",
    "open_source_assurance",
    "public_risk_monitoring",
    "evidence_api_mcp",
)
TASKS = (
    "retrieval",
    "citation",
    "claim_support",
    "abstention",
    "contradiction",
    "calculation",
    "extraction",
    "entity_resolution",
    "change_detection",
    "obligation_extraction",
    "applicability",
    "procurement_normalization",
    "product_passport_completeness",
    "tenant_isolation",
    "prompt_injection",
    "retrieval_poisoning",
    "provider_failure",
    "quota_exhaustion",
    "accessibility",
)
WORKSPACES = (
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
)


def _case(domain: str, split: str, ordinal: int, global_index: int) -> dict[str, Any]:
    task = TASKS[(ordinal + DOMAINS.index(domain)) % len(TASKS)]
    workspace = WORKSPACES[global_index % len(WORKSPACES)]
    other_workspace = WORKSPACES[(global_index + 1) % len(WORKSPACES)]
    marker = f"{domain}-{split}-{ordinal:03d}"
    source = f"{marker}.txt"
    return {
        "id": marker,
        "split": split,
        "domain": domain,
        "task": task,
        "workspace_id": workspace,
        "question": f"Return the reviewable {task.replace('_', ' ')} evidence for {marker}.",
        "expected_answer": f"The supported marker is {marker}.",
        "expected_terms": [marker, "supported"],
        "expected_sources": [source],
        "forbidden_sources": [f"{other_workspace}-{marker}.txt"],
        "claim_state": "SUPPORTED",
        "requires_human_review": task in {"entity_resolution", "contradiction"},
        "expected_abstention": task in {
            "abstention", "provider_failure", "quota_exhaustion",
            "prompt_injection", "retrieval_poisoning",
        },
        "expected_entity_auto_link": task == "entity_resolution" and ordinal % 5 != 0,
        "expected_change_alert": task == "change_detection" and ordinal % 4 != 0,
        "expected_obligation_approved": task == "obligation_extraction" and ordinal % 3 != 0,
        "rights_decision": "ALLOW",
        "synthetic": True,
    }


def build_cases() -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    labeled: list[dict[str, Any]] = []
    heldout: list[dict[str, Any]] = []
    index = 0
    for domain in DOMAINS:
        for ordinal in range(1, 41):
            labeled.append(_case(domain, "labeled", ordinal, index))
            index += 1
        for ordinal in range(1, 13):
            heldout.append(_case(domain, "heldout", ordinal, index))
            index += 1
    for ordinal in range(13, 18):
        heldout.append(_case(DOMAINS[ordinal - 13], "heldout", ordinal, index))
        index += 1
    return labeled, heldout


def validate(labeled: list[dict[str, Any]], heldout: list[dict[str, Any]]) -> dict[str, Any]:
    assert len(labeled) >= 400
    assert len(heldout) >= 125
    all_cases = labeled + heldout
    ids = [case["id"] for case in all_cases]
    assert len(ids) == len(set(ids))
    assert not set(case["id"] for case in labeled).intersection(case["id"] for case in heldout)
    assert set(case["domain"] for case in all_cases) == set(DOMAINS)
    assert set(case["task"] for case in all_cases) == set(TASKS)
    required = {
        "id", "split", "domain", "task", "workspace_id", "question",
        "expected_answer", "expected_terms", "expected_sources", "forbidden_sources",
        "claim_state", "requires_human_review", "rights_decision", "synthetic",
        "expected_abstention", "expected_entity_auto_link",
        "expected_change_alert", "expected_obligation_approved",
    }
    assert all(required.issubset(case) for case in all_cases)
    digest = hashlib.sha256(
        json.dumps(all_cases, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    return {
        "status": "FIXTURE_INVENTORY_ONLY",
        "labeled_cases": len(labeled),
        "heldout_cases": len(heldout),
        "domains": list(DOMAINS),
        "tasks": list(TASKS),
        "sha256": digest,
        "limitations": [
            "Synthetic fixtures do not establish production quality.",
            "Provider-backed, accessibility, visual, security, and end-to-end gates remain required.",
            "Thresholds must not be lowered after a failed evaluation.",
        ],
    }


def write_jsonl(path: Path, cases: list[dict[str, Any]]) -> None:
    path.write_text("".join(json.dumps(case, sort_keys=True) + "\n" for case in cases), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    labeled, heldout = build_cases()
    report = validate(labeled, heldout)
    args.output_dir.mkdir(parents=True, exist_ok=True)
    write_jsonl(args.output_dir / "v6-labeled.jsonl", labeled)
    write_jsonl(args.output_dir / "v6-heldout.jsonl", heldout)
    (args.output_dir / "v6-inventory.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
