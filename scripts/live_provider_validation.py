"""Bounded disposable Qdrant and Gemini verification for protected CI.

This script never prints credentials, never reads customer data, uses one small
synthetic Gemini request, and deletes its temporary Qdrant collection.
"""
from __future__ import annotations

from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import sys
from urllib import error, parse, request


def _required(name: str, *aliases: str) -> str:
    for candidate in (name, *aliases):
        value = os.environ.get(candidate, "").strip()
        if value:
            return value
    raise RuntimeError(f"BLOCKED: missing protected secret {name}")


def _json_request(
    method: str,
    url: str,
    *,
    headers: dict[str, str] | None = None,
    body: dict | None = None,
    timeout: int = 30,
) -> tuple[int, dict]:
    payload = None if body is None else json.dumps(body).encode()
    safe_headers = {"Content-Type": "application/json", **(headers or {})}
    req = request.Request(url, data=payload, method=method, headers=safe_headers)
    try:
        with request.urlopen(req, timeout=timeout) as response:
            raw = response.read()
            return response.status, json.loads(raw or b"{}")
    except error.HTTPError as exc:
        # Do not include response bodies: providers may echo request metadata.
        raise RuntimeError(f"provider request failed with HTTP {exc.code}") from None
    except error.URLError as exc:
        raise RuntimeError(f"provider connection failed: {type(exc.reason).__name__}") from None


def validate_qdrant() -> dict:
    base = _required("QDRANT_URL").rstrip("/")
    api_key = _required("QDRANT_API_KEY")
    run_id = re.sub(r"[^a-z0-9_]", "_", os.environ.get("GITHUB_RUN_ID", "local").lower())
    attempt = re.sub(r"[^a-z0-9_]", "_", os.environ.get("GITHUB_RUN_ATTEMPT", "1").lower())
    prefix = re.sub(
        r"[^a-z0-9_-]",
        "-",
        os.environ.get("QDRANT_COLLECTION_PREFIX", "nexusrag-ci").lower(),
    )
    collection = f"{prefix}-{run_id}-{attempt}"[:180]
    endpoint = f"{base}/collections/{parse.quote(collection, safe='-_')}"
    headers = {"api-key": api_key}
    created = False
    try:
        _json_request(
            "PUT",
            endpoint,
            headers=headers,
            body={"vectors": {"size": 4, "distance": "Cosine"}},
        )
        created = True
        for field_name in ("workspace_id", "version_id", "index_generation"):
            _json_request(
                "PUT",
                f"{endpoint}/index?wait=true",
                headers=headers,
                body={"field_name": field_name, "field_schema": "keyword"},
            )
        _json_request(
            "PUT",
            f"{endpoint}/points?wait=true",
            headers=headers,
            body={
                "points": [
                    {
                        "id": 1,
                        "vector": [1.0, 0.0, 0.0, 0.0],
                        "payload": {
                            "workspace_id": "ci-workspace-a",
                            "version_id": "v1",
                            "index_generation": "g1",
                        },
                    },
                    {
                        "id": 2,
                        "vector": [1.0, 0.0, 0.0, 0.0],
                        "payload": {
                            "workspace_id": "ci-workspace-b",
                            "version_id": "v2",
                            "index_generation": "g1",
                        },
                    },
                ]
            },
        )
        _, result = _json_request(
            "POST",
            f"{endpoint}/points/query",
            headers=headers,
            body={
                "query": [1.0, 0.0, 0.0, 0.0],
                "limit": 10,
                "with_payload": True,
                "filter": {
                    "must": [
                        {"key": "workspace_id", "match": {"value": "ci-workspace-a"}},
                        {"key": "version_id", "match": {"value": "v1"}},
                    ]
                },
            },
        )
        points = (result.get("result") or {}).get("points", [])
        if len(points) != 1 or points[0].get("payload", {}).get("workspace_id") != "ci-workspace-a":
            raise RuntimeError("Qdrant tenant/version isolation probe failed")
        return {
            "state": "READY",
            "synthetic_points": 2,
            "isolated_results": 1,
            "temporary_collection_deleted": True,
        }
    except Exception as exc:
        raise RuntimeError(f"QDRANT_VALIDATION_FAILED:{exc}") from None
    finally:
        if created:
            _json_request("DELETE", endpoint, headers=headers)


def validate_gemini() -> dict:
    api_key = _required("GEMINI_API_KEY", "GOOGLE_API_KEY")
    model = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash").strip()
    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/"
        f"{parse.quote(model, safe='.-_')}:generateContent?key={parse.quote(api_key, safe='')}"
    )
    try:
        _, result = _json_request(
            "POST",
            url,
            body={
                "contents": [
                    {
                        "role": "user",
                        "parts": [
                            {
                                "text": (
                                    "Synthetic CI probe; contains no customer data. "
                                    "Return exactly NEXUSRAG_GEMINI_OK."
                                )
                            }
                        ],
                    }
                ],
                "generationConfig": {
                    "temperature": 0,
                    "maxOutputTokens": 32,
                    "candidateCount": 1,
                },
            },
        )
    except Exception as exc:
        raise RuntimeError(f"GEMINI_VALIDATION_FAILED:{exc}") from None
    text = "".join(
        part.get("text", "")
        for candidate in result.get("candidates", [])
        for part in candidate.get("content", {}).get("parts", [])
    )
    if "NEXUSRAG_GEMINI_OK" not in text:
        raise RuntimeError("Gemini synthetic response marker was not observed")
    usage = result.get("usageMetadata", {})
    return {
        "state": "READY",
        "model": model,
        "prompt_tokens": usage.get("promptTokenCount"),
        "response_tokens": usage.get("candidatesTokenCount"),
        "customer_data_sent": False,
        "paid_fallback": False,
    }


def main() -> int:
    if os.environ.get("LIVE_EXTERNAL_VALIDATION") != "true":
        raise RuntimeError("BLOCKED: LIVE_EXTERNAL_VALIDATION=true is required")
    report = {
        "profile": "ZERO_COST_LOW_TRAFFIC",
        "validated_at": datetime.now(timezone.utc).isoformat(),
        "qdrant": validate_qdrant(),
        "gemini": validate_gemini(),
    }
    output = Path(os.environ.get("VALIDATION_REPORT", "artifacts/live-provider-validation.json"))
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
    print("qdrant=READY gemini=READY customer_data_sent=false paid_fallback=false")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        safe_error = str(exc).replace("\r", " ").replace("\n", " ")[:300]
        failure_output = Path(
            os.environ.get("VALIDATION_REPORT", "artifacts/live-provider-validation.json")
        )
        failure_output.parent.mkdir(parents=True, exist_ok=True)
        failure_output.write_text(
            json.dumps(
                {
                    "profile": "ZERO_COST_LOW_TRAFFIC",
                    "validated_at": datetime.now(timezone.utc).isoformat(),
                    "state": "BLOCKED",
                    "reason": safe_error,
                },
                indent=2,
                sort_keys=True,
            )
            + "\n"
        )
        print(f"::error title=Live provider validation::{safe_error}", file=sys.stderr)
        raise SystemExit(1)