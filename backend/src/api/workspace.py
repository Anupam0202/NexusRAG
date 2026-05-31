"""Workspace router facade.

Workspace membership resolution lives in ``src.api.auth`` for now because the
same dependencies are shared by REST and WebSocket entry points. This module
keeps the public API package layout aligned with the enterprise migration plan.
"""

from src.api.auth import workspace_router as router

__all__ = ["router"]
