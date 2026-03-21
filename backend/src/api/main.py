"""
Re-export the FastAPI ``app`` so both entry points work:

    uvicorn main:app --reload            # from backend/
    uvicorn src.api.main:app --reload    # also works
"""

from main import app  # noqa: F401

__all__ = ["app"]
