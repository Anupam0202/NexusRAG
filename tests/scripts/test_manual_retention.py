"""Offline execution of the manual claim boundary; no real deletion."""
import asyncio
import importlib.util
from pathlib import Path
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock

SPEC = importlib.util.spec_from_file_location(
    "manual_retention", Path(__file__).resolve().parents[2] / "backend/src/tenancy/manual_retention.py")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class PrivateFailure(RuntimeError):
    def __str__(self):
        raise AssertionError("Never disclose private upstream error text")


class ManualRetentionTests(IsolatedAsyncioTestCase):
    def setUp(self):
        self.claim = dict(workspace_id="w1", retention_enabled=True, retention_days=30,
                          retention_lease_owner="manual-1", retention_lease_expires_at="2099-01-01T00:00:00+00:00")
        self.result = SimpleNamespace(documents_deleted=2, chat_sessions_deleted=1, failures=[])
        self.settings = SimpleNamespace(claim_workspace_retention=AsyncMock(return_value=self.claim),
                                        finish_retention_claim=AsyncMock(return_value=True), upsert_settings=AsyncMock())
        self.lifecycle = SimpleNamespace(apply_retention=AsyncMock(return_value=self.result))

    async def run_claim(self):
        return await MODULE.run_manual_retention(settings=self.settings, lifecycle=self.lifecycle,
                                                 workspace_id="w1", actor_id="owner-1", worker_id="manual-1")

    async def test_success_uses_exact_claim_and_never_upserts(self):
        self.assertIs(await self.run_claim(), self.result)
        self.settings.claim_workspace_retention.assert_awaited_once_with(
            workspace_id="w1", actor_id="owner-1", worker_id="manual-1")
        self.settings.finish_retention_claim.assert_awaited_once_with(
            workspace_id="w1", worker_id="manual-1", lease_expires_at=self.claim["retention_lease_expires_at"],
            retention_days=30, succeeded=True)
        self.settings.upsert_settings.assert_not_awaited()

    async def test_busy_or_disabled_claim_cannot_cleanup_or_finish(self):
        self.settings.claim_workspace_retention.return_value = None
        with self.assertRaises(MODULE.ManualRetentionError) as caught:
            await self.run_claim()
        self.assertEqual(caught.exception.code, "CLAIM_UNAVAILABLE")
        self.lifecycle.apply_retention.assert_not_awaited()
        self.settings.finish_retention_claim.assert_not_awaited()

    async def test_malformed_foreign_and_expired_claims_never_cleanup(self):
        bad_claims = [[], {}, {**self.claim, "workspace_id": "w2"}, {**self.claim, "retention_lease_owner": "scheduler"},
                      {**self.claim, "retention_enabled": 1}, {**self.claim, "retention_days": True},
                      {**self.claim, "retention_days": 3651}, {**self.claim, "retention_days": "30"},
                      {**self.claim, "retention_lease_expires_at": "2000-01-01T00:00:00+00:00"},
                      {**self.claim, "retention_lease_expires_at": "2099-01-01T00:00:00"},
                      {**self.claim, "retention_lease_expires_at": "invalid"}]
        for bad in bad_claims:
            with self.subTest(claim=bad):
                self.settings.claim_workspace_retention.return_value = bad
                with self.assertRaises(MODULE.ManualRetentionError) as caught:
                    await self.run_claim()
                self.assertEqual(caught.exception.code, "INVALID_CLAIM")
        self.lifecycle.apply_retention.assert_not_awaited()
        self.settings.finish_retention_claim.assert_not_awaited()

    async def test_claim_failure_is_static_and_never_runs_cleanup(self):
        self.settings.claim_workspace_retention.side_effect = PrivateFailure()
        with self.assertRaises(MODULE.ManualRetentionError) as caught:
            await self.run_claim()
        self.assertEqual(str(caught.exception), "CLAIM_UNCONFIRMED")
        self.lifecycle.apply_retention.assert_not_awaited()

    async def test_partial_cleanup_preserves_counts_and_proves_retry_before_claiming_it(self):
        self.result.failures = [{"code": "DOCUMENT_CLEANUP_FAILED"}]
        with self.assertRaises(MODULE.ManualRetentionError) as caught:
            await self.run_claim()
        self.assertIs(caught.exception.result, self.result)
        self.assertTrue(caught.exception.retry_scheduled)
        self.assertEqual(caught.exception.result.documents_deleted, 2)
        self.assertFalse(self.settings.finish_retention_claim.await_args.kwargs["succeeded"])

    async def test_cleanup_exception_uses_guarded_retry_without_exposing_error(self):
        self.lifecycle.apply_retention.side_effect = PrivateFailure()
        with self.assertRaises(MODULE.ManualRetentionError) as caught:
            await self.run_claim()
        self.assertEqual(caught.exception.code, "CLEANUP_FAILED")
        self.assertTrue(caught.exception.retry_scheduled)
        self.assertFalse(self.settings.finish_retention_claim.await_args.kwargs["succeeded"])

    async def test_lease_loss_never_falls_back_to_upsert(self):
        for failures in ([], [{"code": "DOCUMENT_CLEANUP_FAILED"}]):
            with self.subTest(failures=failures):
                self.result.failures = failures
                self.settings.finish_retention_claim.return_value = False
                with self.assertRaises(MODULE.ManualRetentionError) as caught:
                    await self.run_claim()
                self.assertEqual(caught.exception.code, "LEASE_LOST")
                self.assertFalse(caught.exception.retry_scheduled)
                self.assertIs(caught.exception.result, self.result)
        self.settings.upsert_settings.assert_not_awaited()

    async def test_ambiguous_or_malformed_completion_never_claims_retry(self):
        for outcome in (PrivateFailure(), "true", None, 1):
            with self.subTest(outcome=type(outcome).__name__):
                self.settings.finish_retention_claim.side_effect = outcome if isinstance(outcome, Exception) else None
                self.settings.finish_retention_claim.return_value = outcome
                with self.assertRaises(MODULE.ManualRetentionError) as caught:
                    await self.run_claim()
                self.assertEqual(caught.exception.code, "FINISH_UNCONFIRMED")
                self.assertFalse(caught.exception.retry_scheduled)
        self.settings.upsert_settings.assert_not_awaited()

    async def test_cancellation_propagates_without_releasing_claim(self):
        self.lifecycle.apply_retention.side_effect = asyncio.CancelledError()
        with self.assertRaises(asyncio.CancelledError):
            await self.run_claim()
        self.settings.finish_retention_claim.assert_not_awaited()

