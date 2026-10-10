"""Offline row/retry failure isolation; no hosted lease or deletion proof."""
import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from src.tenancy import retention_scheduler as module

MARKER = "synthetic-private-retention-marker"


class PrivateValue:
    def __str__(self):
        raise AssertionError("Private conversion must not run")

    def __bool__(self):
        raise AssertionError("Private truthiness must not run")

    def __int__(self):
        raise AssertionError("Private integer conversion must not run")


class PrivateFailure(RuntimeError):
    def __str__(self):
        raise AssertionError("Private exception text must not run")


def valid(workspace="synthetic-next"):
    return {"workspace_id": workspace, "retention_enabled": True, "retention_days": 30}


def fixture(monkeypatch, rows):
    logger = MagicMock()
    monkeypatch.setattr(module, "logger", logger)
    settings = SimpleNamespace(
        claim_due_retention=AsyncMock(return_value=rows),
        upsert_settings=AsyncMock(return_value={}),
    )
    life = SimpleNamespace(apply_retention=AsyncMock(return_value=SimpleNamespace(
        documents_deleted=2, chat_sessions_deleted=1, failures=[])))
    return module.RetentionScheduler(settings=settings, lifecycle=life), settings, life, logger


def assert_reconciled(summary):
    assert summary.claimed == summary.completed + summary.failed + summary.skipped + summary.invalid
    assert summary.retry_schedule_failed <= summary.failed


@pytest.mark.asyncio
@pytest.mark.parametrize("bad", [
    None, MARKER, {},
    {**valid(), "workspace_id": PrivateValue()},
    {**valid(), "workspace_id": "   "},
    {**valid(), "workspace_id": 12},
    {**valid(), "workspace_id": None},
    {**valid(), "retention_enabled": "false"},
    {**valid(), "retention_enabled": 1},
    {**valid(), "retention_enabled": PrivateValue()},
    {**valid(), "retention_days": "30"},
    {**valid(), "retention_days": True},
    {**valid(), "retention_days": 30.5},
    {**valid(), "retention_days": 0},
    {**valid(), "retention_days": -2},
    {**valid(), "retention_days": None},
    {**valid(), "retention_days": PrivateValue()},
])
async def test_invalid_record_never_cleans_or_schedules_and_later_valid_row_runs(monkeypatch, bad):
    scheduler, settings, life, logger = fixture(monkeypatch, [bad, valid()])
    result = await scheduler.run_due(worker_id="synthetic-worker")
    assert result.invalid == 1 and result.completed == 1 and result.failed == 0
    assert result.documents_deleted == 2 and result.chat_sessions_deleted == 1
    life.apply_retention.assert_awaited_once_with(workspace_id="synthetic-next", retention_days=30)
    settings.upsert_settings.assert_awaited_once()
    logger.warning.assert_called_once_with("retention_record_invalid", code="INVALID_RETENTION_RECORD")
    assert MARKER not in str(logger.mock_calls)
    assert_reconciled(result)


@pytest.mark.asyncio
async def test_disabled_record_does_not_coerce_days_or_execute_cleanup(monkeypatch):
    scheduler, settings, life, logger = fixture(monkeypatch, [
        {**valid(), "retention_enabled": False, "retention_days": PrivateValue()}])
    result = await scheduler.run_due(worker_id="synthetic-worker")
    assert result.skipped == 1 and result.invalid == 0
    life.apply_retention.assert_not_awaited()
    settings.upsert_settings.assert_not_awaited()
    logger.warning.assert_not_called()
    assert_reconciled(result)


@pytest.mark.asyncio
@pytest.mark.parametrize("stage", ["cleanup", "completion_write"])
async def test_failed_retry_write_does_not_abort_later_workspace_or_claim_retry_success(monkeypatch, stage):
    scheduler, settings, life, logger = fixture(monkeypatch, [valid("synthetic-first"), valid()])
    success = SimpleNamespace(documents_deleted=2, chat_sessions_deleted=1, failures=[])
    if stage == "cleanup":
        life.apply_retention.side_effect = [PrivateFailure(MARKER), success]
        settings.upsert_settings.side_effect = [PrivateFailure(MARKER), {}]
    else:
        settings.upsert_settings.side_effect = [PrivateFailure(MARKER), PrivateFailure(MARKER), {}]
    result = await scheduler.run_due(worker_id="synthetic-worker")
    assert result.failed == 1 and result.completed == 1 and result.retry_schedule_failed == 1
    assert result.documents_deleted == (2 if stage == "cleanup" else 4)
    assert result.chat_sessions_deleted == (1 if stage == "cleanup" else 2)
    assert life.apply_retention.await_count == 2
    assert settings.upsert_settings.await_args_list[-1].kwargs["workspace_id"] == "synthetic-next"
    retry = settings.upsert_settings.await_args_list[-2].kwargs["values"]
    assert "last_retention_at" not in retry
    assert retry["retention_lease_owner"] is None and retry["retention_lease_expires_at"] is None
    assert [c.args[0] for c in logger.warning.call_args_list] == [
        "retention_retry_schedule_failed", "retention_schedule_failed"]
    assert all(c.kwargs["error_type"] == "PrivateFailure" for c in logger.warning.call_args_list)
    assert MARKER not in str(logger.mock_calls)
    assert_reconciled(result)


@pytest.mark.asyncio
@pytest.mark.parametrize("stage", ["partial_cleanup", "completion_write"])
async def test_reported_partial_counts_survive_failure_without_completed_status(monkeypatch, stage):
    scheduler, settings, life, logger = fixture(monkeypatch, [valid()])
    if stage == "partial_cleanup":
        life.apply_retention.return_value = SimpleNamespace(
            documents_deleted=2, chat_sessions_deleted=1,
            failures=[{"code": "DOCUMENT_CLEANUP_FAILED"}])
    else:
        settings.upsert_settings.side_effect = [PrivateFailure(MARKER), {}]
    result = await scheduler.run_due(worker_id="synthetic-worker")
    assert result.completed == 0 and result.failed == 1 and result.retry_schedule_failed == 0
    assert result.documents_deleted == 2 and result.chat_sessions_deleted == 1
    assert "last_retention_at" not in settings.upsert_settings.await_args.kwargs["values"]
    assert MARKER not in str(logger.mock_calls)
    assert_reconciled(result)


@pytest.mark.asyncio
async def test_success_preserves_completion_schedule_and_counts_once(monkeypatch):
    scheduler, settings, life, logger = fixture(monkeypatch, [valid()])
    result = await scheduler.run_due(worker_id="synthetic-worker", limit=10, lease_seconds=600)
    settings.claim_due_retention.assert_awaited_once_with(
        worker_id="synthetic-worker", limit=10, lease_seconds=600)
    values = settings.upsert_settings.await_args.kwargs["values"]
    assert values["last_retention_at"] and values["next_retention_at"]
    assert values["retention_lease_owner"] is None and values["retention_lease_expires_at"] is None
    assert result.completed == 1 and result.failed == result.invalid == result.retry_schedule_failed == 0
    assert result.documents_deleted == 2 and result.chat_sessions_deleted == 1
    logger.warning.assert_not_called()
    assert_reconciled(result)


@pytest.mark.asyncio
async def test_claim_failure_is_not_disguised_as_an_empty_success(monkeypatch):
    scheduler, settings, life, logger = fixture(monkeypatch, [])
    settings.claim_due_retention.side_effect = PrivateFailure(MARKER)
    with pytest.raises(PrivateFailure):
        await scheduler.run_due(worker_id="synthetic-worker")
    life.apply_retention.assert_not_awaited()
    settings.upsert_settings.assert_not_awaited()


@pytest.mark.asyncio
async def test_cancellation_propagates_without_retry_or_later_processing(monkeypatch):
    scheduler, settings, life, logger = fixture(monkeypatch, [valid("synthetic-first"), valid()])
    life.apply_retention.side_effect = asyncio.CancelledError()
    with pytest.raises(asyncio.CancelledError):
        await scheduler.run_due(worker_id="synthetic-worker")
    life.apply_retention.assert_awaited_once()
    settings.upsert_settings.assert_not_awaited()
    logger.warning.assert_not_called()


def script_fixture(monkeypatch, summary):
    import importlib.util
    from pathlib import Path
    import sys
    spec = importlib.util.spec_from_file_location(
        "retention_cli_fixture", Path(__file__).resolve().parents[1] / "scripts/process_retention.py")
    cli = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(cli)
    logger = MagicMock()
    monkeypatch.setattr(cli, "logger", logger)
    monkeypatch.setattr(sys, "argv", ["process_retention.py", "--worker-id", "synthetic-worker", "--limit", "10"])
    monkeypatch.setattr(cli, "get_settings", lambda: SimpleNamespace(qdrant_configured=False))
    monkeypatch.setattr(cli, "get_vector_store", lambda: object())
    monkeypatch.setattr(cli, "WorkspaceLifecycleService", lambda **kwargs: object())
    run = AsyncMock(return_value=summary)
    monkeypatch.setattr(cli, "RetentionScheduler", lambda **kwargs: SimpleNamespace(run_due=run))
    return cli, run, logger


@pytest.mark.asyncio
@pytest.mark.parametrize("values", [
    {"failed": 1}, {"invalid": 1}, {"failed": 1, "retry_schedule_failed": 1},
])
async def test_real_cli_marks_partial_or_invalid_run_nonzero(monkeypatch, values):
    summary = module.RetentionSchedulerSummary(**values)
    cli, run, logger = script_fixture(monkeypatch, summary)
    with pytest.raises(SystemExit) as error:
        await cli.main()
    assert error.value.code == 1
    run.assert_awaited_once_with(worker_id="synthetic-worker", limit=10)
    logger.info.assert_called_once_with("retention_scheduler_finished", **summary.__dict__)
    logger.error.assert_not_called()


@pytest.mark.asyncio
async def test_real_cli_success_keeps_normal_exit_and_emits_measured_summary(monkeypatch):
    summary = module.RetentionSchedulerSummary(claimed=1, completed=1, documents_deleted=2)
    cli, run, logger = script_fixture(monkeypatch, summary)
    assert await cli.main() is None
    logger.info.assert_called_once_with("retention_scheduler_finished", **summary.__dict__)
    logger.error.assert_not_called()


@pytest.mark.asyncio
@pytest.mark.parametrize("stage", ["settings", "vectors", "claim"])
async def test_real_cli_claim_or_initialization_failure_is_private_and_nonzero(monkeypatch, stage):
    cli, run, logger = script_fixture(monkeypatch, module.RetentionSchedulerSummary())
    def fail():
        raise PrivateFailure(MARKER)
    if stage == "settings":
        monkeypatch.setattr(cli, "get_settings", fail)
    elif stage == "vectors":
        monkeypatch.setattr(cli, "get_vector_store", fail)
    else:
        run.side_effect = PrivateFailure(MARKER)
    with pytest.raises(SystemExit) as error:
        await cli.main()
    assert error.value.code == 1
    assert error.value.__suppress_context__ is True
    logger.error.assert_called_once_with("retention_scheduler_aborted", error_type="PrivateFailure")
    logger.info.assert_not_called()
    assert MARKER not in str(logger.mock_calls)
