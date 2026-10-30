import json
from pathlib import Path

from src.domain.research_planner import MODE_LIMITS


def test_worker_browser_mode_contract_matches_accepted_python_modes():
    shared = json.loads((Path(__file__).resolve().parents[2] / "frontend/src/lib/research-modes.json").read_text())
    assert set(shared) == {mode.value for mode in MODE_LIMITS}
    for mode, limits in MODE_LIMITS.items():
        assert shared[mode.value] == {
            "max_subquestions": limits.max_subquestions,
            "max_sources": limits.max_sources,
            "max_query_variants": limits.max_variants,
            "max_runtime_seconds": limits.max_runtime_seconds,
            "requires_review": limits.requires_review,
        }
