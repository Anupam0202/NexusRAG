#!/usr/bin/env python3
# ruff: noqa: E402, I001
"""Compatibility wrapper for the NexusRAG evaluation harness."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from evals.run_eval import main  # noqa: E402


if __name__ == "__main__":
    raise SystemExit(main())
