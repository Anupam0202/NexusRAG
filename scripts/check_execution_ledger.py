"""Validate completion evidence; never turn partial source work into release clearance."""

from __future__ import annotations

import argparse
from collections import Counter
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
DEFAULT = ROOT / "docs/implementation/execution-ledger.json"
STATES = {"VERIFIED", "BLOCKED_EXTERNAL", "OPEN_ENGINEERING", "IN_PROGRESS", "FAILED"}
FAMILIES = ("R", "CF", "A", "S", "G", "P", "Z")


def normative_requirements(root: Path = ROOT) -> dict[str, tuple[str, str]]:
    result = {}
    for relative in (
        "docs/implementation/LEGACY_REPLACEMENT_BASELINE.md",
        "docs/implementation/REQUIREMENT_TRACEABILITY.md",
    ):
        for line in (root / relative).read_text().splitlines():
            match = re.match(r"\| ((?:CF|R|A|S|G|P|Z)\d{2}) \| ([^|]+) \|", line)
            if match:
                identifier, title = match.groups()
                if identifier in result:
                    raise ValueError(f"Duplicate normative requirement: {identifier}")
                result[identifier] = (title.strip(), relative)
    expected = {
        f"{family}{number:02}" for family in FAMILIES for number in range(1, 33)
    }
    if set(result) != expected:
        raise ValueError("Normative register must contain exactly all 224 accepted IDs")
    return result


def validate(ledger: dict, root: Path = ROOT) -> dict:
    if (
        ledger.get("schema_version") != 1
        or ledger.get("profile") != "ZERO_COST_LOW_TRAFFIC"
    ):
        raise ValueError("Unknown ledger schema or operating profile")
    normative = normative_requirements(root)
    entries = ledger.get("entries")
    if not isinstance(entries, list) or not entries:
        raise ValueError("Execution ledger is missing entries")
    seen = set()
    for entry in entries:
        if not isinstance(entry, dict):
            raise ValueError("Execution entry must be an object")
        identifier = entry.get("id")
        if not isinstance(identifier, str) or not identifier or identifier in seen:
            raise ValueError("Missing or duplicate execution entry ID")
        seen.add(identifier)
        if entry.get("status") not in STATES:
            raise ValueError(f"Invalid execution state: {identifier}")
        if (
            not entry.get("requirement")
            or not entry.get("environment")
            or not entry.get("next_action")
        ):
            raise ValueError(
                f"Missing outcome, environment or concrete next action: {identifier}"
            )
        if identifier in normative:
            title, source = normative[identifier]
            if (
                entry.get("requirement") != title
                or entry.get("normative_source") != source
            ):
                raise ValueError(f"Normative wording/source drift: {identifier}")
        evidence = entry.get("acceptance_evidence", [])
        if not isinstance(evidence, list):
            raise ValueError(f"Invalid acceptance evidence: {identifier}")
        if entry["status"] == "VERIFIED":
            if not evidence or not entry.get("verified_scope"):
                raise ValueError(f"Verified entry lacks scope/evidence: {identifier}")
            for receipt in evidence:
                if not isinstance(receipt, dict):
                    raise ValueError(
                        f"Verified entry receipt must be an object: {identifier}"
                    )
                if not all(
                    receipt.get(key)
                    for key in (
                        "environment",
                        "observed_at",
                        "source_identity",
                        "command_or_url",
                        "result",
                    )
                ):
                    raise ValueError(
                        f"Verified entry has incomplete receipt: {identifier}"
                    )
                if receipt["result"] != "PASS":
                    raise ValueError(
                        f"Verified entry contains nonpassing receipt: {identifier}"
                    )
        if entry["status"] == "BLOCKED_EXTERNAL":
            blocker = entry.get("external_prerequisite", {})
            if not isinstance(blocker, dict):
                raise ValueError(
                    f"External prerequisite must be an object: {identifier}"
                )
            if not all(
                blocker.get(key)
                for key in ("owner", "decision_or_access", "affected_operation")
            ):
                raise ValueError(
                    f"External blocker lacks exact prerequisite: {identifier}"
                )
    if not set(normative).issubset(seen):
        raise ValueError("Execution ledger omits accepted requirements")
    if {f"PRODUCT-{number:02}" for number in range(1, 11)} - seen:
        raise ValueError("Execution ledger omits complete-product acceptance scenarios")
    counts = dict(sorted(Counter(entry["status"] for entry in entries).items()))
    unresolved = [entry["id"] for entry in entries if entry["status"] != "VERIFIED"]
    return {
        "entries": len(entries),
        "status_counts": counts,
        "closure_passed": not unresolved,
        "unresolved_ids": unresolved,
        "production_verified": False,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ledger", type=Path, default=DEFAULT)
    parser.add_argument("--require-closure", action="store_true")
    args = parser.parse_args()
    try:
        result = validate(json.loads(args.ledger.read_text()))
    except (OSError, ValueError, TypeError, KeyError) as exc:
        print(json.dumps({"closure_passed": False, "error": str(exc)}))
        return 2
    print(json.dumps(result, sort_keys=True))
    return 1 if args.require_closure and not result["closure_passed"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
