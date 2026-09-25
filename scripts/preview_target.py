"""Resolve strictly allow-listed, isolated Cloudflare candidate targets."""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

PREVIEW_TARGETS = {
    "refs/heads/v6-zero-cost-foundations-clean": {
        "GATEWAY_CONFIG": "apps/gateway/wrangler.preview.jsonc",
        "GATEWAY_WORKER": "nexusrag-v6-candidate-gateway",
        "INGESTION_QUEUE": "nexusrag-v6-candidate-ingestion",
        "INGESTION_DLQ": "nexusrag-v6-candidate-ingestion-dlq",
        "FRONTEND_CONFIG": "wrangler.jsonc",
        "FRONTEND_WORKER": "nexusrag-v6-candidate-frontend",
        "QDRANT_COLLECTION": "nexusrag-v6-candidate",
    },
    "refs/heads/critical-gaps/v8-remote-validation": {
        "GATEWAY_CONFIG": "apps/gateway/wrangler.pr3-preview.jsonc",
        "GATEWAY_WORKER": "nexusrag-v6-pr3-gateway",
        "INGESTION_QUEUE": "nexusrag-v6-pr3-ingestion",
        "INGESTION_DLQ": "nexusrag-v6-pr3-ingestion-dlq",
        "FRONTEND_CONFIG": "wrangler.pr3.jsonc",
        "FRONTEND_WORKER": "nexusrag-v6-pr3-frontend",
        "QDRANT_COLLECTION": "nexusrag-v6-pr3",
    },
}


def resolve_target(ref: str) -> dict[str, str]:
    """Return an exact allow-listed target, rejecting every unknown ref."""
    try:
        target = PREVIEW_TARGETS[ref]
    except KeyError as exc:
        raise ValueError("Candidate deployment is not permitted from this ref.") from exc
    return dict(target)


def validate_targets() -> None:
    """Ensure each branch's config agrees with its unique resources."""
    resource_keys = (
        "GATEWAY_WORKER",
        "INGESTION_QUEUE",
        "INGESTION_DLQ",
        "FRONTEND_WORKER",
        "QDRANT_COLLECTION",
    )
    for target in PREVIEW_TARGETS.values():
        gateway_path = ROOT / target["GATEWAY_CONFIG"]
        gateway = json.loads(gateway_path.read_text(encoding="utf-8"))
        if gateway.get("name") != target["GATEWAY_WORKER"]:
            raise ValueError(f"Gateway config name mismatch: {gateway_path}")
        queues = gateway.get("queues", {})
        producers = queues.get("producers", [])
        consumers = queues.get("consumers", [])
        if not producers or producers[0].get("queue") != target["INGESTION_QUEUE"]:
            raise ValueError(f"Queue producer mismatch: {gateway_path}")
        if not consumers or consumers[0].get("queue") != target["INGESTION_QUEUE"]:
            raise ValueError(f"Queue consumer mismatch: {gateway_path}")
        if consumers[0].get("dead_letter_queue") != target["INGESTION_DLQ"]:
            raise ValueError(f"Queue DLQ mismatch: {gateway_path}")

        frontend_path = ROOT / "frontend" / target["FRONTEND_CONFIG"]
        frontend_text = frontend_path.read_text(encoding="utf-8")
        for expected in (
            f'"name": "{target["FRONTEND_WORKER"]}"',
            f'"main": ".open-next/worker.js"',
            f'"service": "{target["FRONTEND_WORKER"]}"',
        ):
            if expected not in frontend_text:
                raise ValueError(f"Frontend config does not bind {expected}: {frontend_path}")

    for key in resource_keys:
        values = [target[key] for target in PREVIEW_TARGETS.values()]
        if len(values) != len(set(values)):
            raise ValueError(f"Preview targets share a supposedly isolated resource: {key}")


def emit_github_env(ref: str) -> None:
    validate_targets()
    for key, value in resolve_target(ref).items():
        print(f"{key}={value}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: preview_target.py <github-ref>")
    try:
        emit_github_env(sys.argv[1])
    except (OSError, ValueError, json.JSONDecodeError) as error:
        print(f"Preview target validation failed: {error}", file=sys.stderr)
        raise SystemExit(1) from error
