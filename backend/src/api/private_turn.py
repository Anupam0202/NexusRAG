"""Shared private authority and durable completion for REST and WebSocket."""

from uuid import UUID, uuid4

import httpx
from fastapi import HTTPException

from config.settings import Settings
from src.api.auth import WorkspaceContext
from src.repositories.messages import (
    ConversationConflictError, ConversationUnavailableError, MessageRepository, PrivateTurnContext,
)
from src.utils.logger import get_logger

logger = get_logger(__name__)


def _failure(exc: Exception, stage: str) -> HTTPException:
    logger.warning("private_turn_unconfirmed", stage=stage, error_type=type(exc).__name__)
    if isinstance(exc, ConversationUnavailableError):
        return HTTPException(403, "Conversation is not available to this account.")
    if isinstance(exc, ConversationConflictError):
        return HTTPException(409, "Conversation changed. Reload before continuing.")
    if isinstance(exc, httpx.HTTPStatusError):
        if exc.response.status_code in {401, 403}:
            return HTTPException(exc.response.status_code, "Conversation authority is unavailable.")
    return HTTPException(503, "Conversation persistence could not be confirmed.")


async def prepare_private_turn(*, workspace: WorkspaceContext | None, settings: Settings,
                               session_id: str | None, repository: MessageRepository) -> PrivateTurnContext | None:
    if workspace is None or workspace.user.is_demo:
        return None
    if not settings.supabase_configured:
        raise HTTPException(503, "Conversation authority is unavailable.")
    if not workspace.user.access_token:
        raise HTTPException(401, "Sign in before continuing this conversation.")
    try:
        canonical = str(UUID(session_id)) if session_id else str(uuid4())
    except (ValueError, TypeError, AttributeError) as exc:
        raise HTTPException(422, "A valid conversation ID is required.") from exc
    try:
        return await repository.read_turn_context(workspace_id=workspace.workspace_id,
            session_id=canonical, user_id=workspace.user.id, access_token=workspace.user.access_token)
    except Exception as exc:
        raise _failure(exc, "context") from exc


async def persist_private_turn(*, context: PrivateTurnContext | None, repository: MessageRepository,
                               question: str, answer: str, sources: list[dict], metadata: dict) -> None:
    if context is None:
        return
    try:
        receipt = await repository.commit_turn(context, question=question, answer=answer,
                                               sources=sources, metadata=metadata)
    except Exception as exc:
        raise _failure(exc, "commit") from exc
    metadata.update(session_id=context.session_id, session_revision=receipt["revision"])


async def revalidate_private_turn(*, context: PrivateTurnContext | None, repository: MessageRepository) -> None:
    if context is None:
        return
    try:
        await repository.revalidate_turn_context(context)
    except Exception as exc:
        raise _failure(exc, "before_generation") from exc
