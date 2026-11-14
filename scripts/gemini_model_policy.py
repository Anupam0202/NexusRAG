"""Gemini model policy for repository scripts (D24 in docs/completion/MASTER_PROMPT.md).

The gateway module ``apps/gateway/src/gemini-models.js`` is the single source of truth: this module reads its
defaults so the scripts always check and probe the models production actually uses.
"""
from __future__ import annotations

from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
GATEWAY_POLICY = ROOT / "apps/gateway/src/gemini-models.js"
MODEL_ID = re.compile(r"^[a-z0-9][a-z0-9.-]{2,80}$")


def _gateway_source() -> str:
    # Drop line comments so quoted words in them are never read as model names.
    return re.sub(r"//[^\n]*", "", GATEWAY_POLICY.read_text(encoding="utf-8"))


def default_generation_models() -> tuple[str, ...]:
    block = re.search(r"DEFAULT_GENERATION_MODELS\s*=\s*Object\.freeze\(\[(.*?)\]\)", _gateway_source(), re.S)
    models = tuple(re.findall(r'"([^"]+)"', block.group(1))) if block else ()
    if not models or not all(MODEL_ID.match(model) for model in models):
        raise RuntimeError("The gateway model policy has no valid DEFAULT_GENERATION_MODELS list.")
    return models


def default_embedding_model() -> str:
    match = re.search(r'DEFAULT_EMBEDDING_MODEL\s*=\s*"([^"]+)"', _gateway_source())
    if not match or not MODEL_ID.match(match.group(1)):
        raise RuntimeError("The gateway model policy has no valid DEFAULT_EMBEDDING_MODEL.")
    return match.group(1)


def generation_models(configured: str | None = None) -> tuple[str, ...]:
    """Ordered candidates: ``GEMINI_MODEL`` may hold one model or a comma-separated list."""
    values = [value.strip() for value in (configured or "").split(",")]
    valid = tuple(dict.fromkeys(value for value in values if MODEL_ID.match(value)))
    return valid or default_generation_models()


def embedding_model(configured: str | None = None) -> str:
    value = (configured or "").strip()
    return value if MODEL_ID.match(value) else default_embedding_model()


def thinking_config(model: str) -> dict | None:
    """Mirror of ``thinkingConfigFor`` in the gateway: the thinking setting each model family documents."""
    if re.match(r"^gemini-2\.5-", model):
        return {"thinkingBudget": 0}
    if model.endswith("-latest") or "flash-lite" in model:
        return None
    if re.match(r"^gemini-(?:[3-9]|\d{2,})(?:\.\d+)?-", model):
        return {"thinkingLevel": "low"}
    return None
