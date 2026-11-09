"""Check that Google still serves every configured Gemini model (D24).

Lists models with the platform key and exits non-zero when a configured generation model or the pinned
embedding model is missing, so a retirement is noticed before users see failures. It sends no content and
uses no generation quota. Usage: ``GOOGLE_API_KEY=... python3 scripts/check_gemini_models.py``
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import sys
from urllib import error, parse, request

if __package__:
    from .gemini_model_policy import embedding_model, generation_models
else:
    from gemini_model_policy import embedding_model, generation_models

MODELS_URL = "https://generativelanguage.googleapis.com/v1beta/models"
MAX_PAGES = 5
MAX_RESPONSE_BYTES = 4 * 1024 * 1024


def list_models(api_key: str) -> set[str]:
    names: set[str] = set()
    token = ""
    for _ in range(MAX_PAGES):
        query = {"pageSize": "1000", **({"pageToken": token} if token else {})}
        call = request.Request(f"{MODELS_URL}?{parse.urlencode(query)}", headers={"x-goog-api-key": api_key})
        with request.urlopen(call, timeout=20) as response:
            raw = response.read(MAX_RESPONSE_BYTES + 1)
        if len(raw) > MAX_RESPONSE_BYTES:
            raise RuntimeError("The model list exceeded the response size limit.")
        body = json.loads(raw)
        if not isinstance(body, dict):
            raise RuntimeError("The model list was not a JSON object.")
        for item in body.get("models") or []:
            if isinstance(item, dict) and isinstance(item.get("name"), str):
                names.add(item["name"].removeprefix("models/"))
        token = body.get("nextPageToken") or ""
        if not token:
            break
    return names


def availability(listed: set[str], configured_generation: str | None, configured_embedding: str | None) -> dict:
    generation = [{"model": model, "available": model in listed} for model in generation_models(configured_generation)]
    embedding = embedding_model(configured_embedding)
    return {
        "generation": generation,
        "active_generation": next((item["model"] for item in generation if item["available"]), None),
        "embedding": {"model": embedding, "available": embedding in listed},
    }


def summary(report: dict) -> str:
    rows = [f"| Generation ({index + 1}) | `{item['model']}` | {'served' if item['available'] else '**missing**'} |"
            for index, item in enumerate(report["generation"])]
    embedding = report["embedding"]
    rows.append(f"| Embedding (pinned) | `{embedding['model']}` | {'served' if embedding['available'] else '**missing**'} |")
    active = report["active_generation"] or "none"
    return "\n".join(["## Gemini models", "", "| Role | Model | Status |", "|---|---|---|", *rows, "",
                      f"Answers and extraction currently use `{active}`.", ""])


def main() -> int:
    api_key = os.environ.get("GOOGLE_API_KEY", "").strip()
    if not api_key:
        print("::error::GOOGLE_API_KEY is missing, so the configured Gemini models cannot be checked.")
        return 1
    try:
        listed = list_models(api_key)
    except error.HTTPError as exc:
        print(f"::error::Listing Gemini models returned HTTP {exc.code}.")
        return 1
    except (error.URLError, TimeoutError, OSError, ValueError, RuntimeError) as exc:
        print(f"::error::Listing Gemini models failed: {type(exc).__name__}.")
        return 1
    report = availability(listed, os.environ.get("GEMINI_MODEL"), os.environ.get("GEMINI_EMBEDDING_MODEL"))
    text = summary(report)
    print(text)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with Path(os.environ["GITHUB_STEP_SUMMARY"]).open("a", encoding="utf-8") as handle:
            handle.write(text + "\n")
    missing = [item["model"] for item in report["generation"] if not item["available"]]
    if not report["embedding"]["available"]:
        missing.append(report["embedding"]["model"])
    for model in missing:
        print(f"::error::Google no longer lists `{model}`. Follow the model policy (D24) in docs/completion/MASTER_PROMPT.md.")
    return 1 if missing else 0


if __name__ == "__main__":
    sys.exit(main())
