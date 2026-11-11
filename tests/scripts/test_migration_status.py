"""Name-based migration status: the forward chain, hosted-name matching and the replay harness stay in step."""
import io
import json
from pathlib import Path
import re
import tempfile
import unittest
from unittest import mock

from scripts import migration_status as tool

ROOT = Path(__file__).resolve().parents[2]

# Hosted histories as recorded on 2026-11-11 (names only; versions differ from repository file names).
PRODUCTION = [
    "001_core_schema", "002_rls_policies", "012_backfill_existing_auth_profiles",
    "allow_workspace_member_cascade_delete", "014_identity_visibility_policy", "014a_private_conversation_authorizer",
    "022_v6_rights_quota_interfaces", "025_function_execution_hardening", "allow_reindex_original_reuse",
    "metered_operation_admission", "resumable_chunk_staging", "durable_extraction_staging",
    "non_sensitive_gemini_policy_gate", "harden_extraction_storage_privileges", "account_trial_and_user_gemini_keys",
    "explicit_deny_account_trial_tables", "explicit_byok_cost_consent_and_unknown_costs",
]
REHEARSAL_BEFORE = [
    "001_v6_zero_cost_baseline", "027_metered_operation_admission", "028_resumable_chunk_staging",
    "029_durable_extraction_staging", "030_non_sensitive_gemini_policy_gate",
    "031_harden_extraction_storage_privileges", "temporary_hosted_reservation_concurrency_harness",
    "032_account_trial_and_user_gemini_keys", "033_explicit_deny_account_trial_tables",
    "rehearsal_026_reindex_original_reuse_compat", "034_explicit_byok_cost_consent_and_unknown_costs",
    "035_atomic_workspace_management_and_finding_exports", "036_confirmed_auth_member_identity",
    "037_byok_workspace_processing_authority", "038_terms_bound_workspace_processing_policy",
    "canonical_service_role_processing_authority",
]


class ForwardChainTests(unittest.TestCase):
    def test_chain_starts_at_026_and_orders_numbered_before_timestamped(self):
        chain = [file for file, _ in tool.forward_chain()]
        self.assertEqual(chain[0], "026_allow_reindex_original_reuse.sql")
        self.assertEqual(chain, sorted(chain))
        self.assertFalse([file for file in chain if re.match(r"^0(0\d|1\d|2[0-5])", file)], "legacy 001-025 never replay")
        numbered = [index for index, file in enumerate(chain) if not file.startswith("20")]
        self.assertEqual(numbered, list(range(len(numbered))))
        self.assertEqual(len({name for _, name in tool.forward_chain()}), len(chain), "normalized names must be unique")

    def test_replay_harness_and_workflow_list_exactly_the_forward_chain(self):
        harness = (ROOT / "tests/postgres/local-rehearsal.sh").read_text()
        workflow = (ROOT / ".github/workflows/v6-database-rehearsal.yml").read_text()
        chain = [file for file, _ in tool.forward_chain()]
        self.assertEqual(re.findall(r'\$ROOT/supabase/migrations/([^"]+\.sql)', harness), chain)
        self.assertEqual(re.findall(r'cp "\$GITHUB_WORKSPACE/supabase/migrations/([^"]+\.sql)"', workflow), chain)
        self.assertIn('cp "$GITHUB_WORKSPACE/scripts/migration_status.py" "$source_dir/scripts/"', workflow)
        self.assertIn('bash "$TESTS/migration-tool-integration.sh"', harness)
        self.assertIn("grep -F 'MIGRATION_TOOL_REAL_SQL_PASS' \"$log\"", workflow)

    def test_normalize_strips_numeric_and_timestamp_prefixes_only(self):
        self.assertEqual(tool.normalize("039_canonical_service_role_processing_authority"), "canonical_service_role_processing_authority")
        self.assertEqual(tool.normalize("20261011124337_private_history_read"), "private_history_read")
        self.assertEqual(tool.normalize("014a_private_conversation_authorizer"), "private_conversation_authorizer")
        self.assertEqual(tool.normalize("private_history_read"), "private_history_read")
        self.assertEqual(tool.normalize("2026_plan"), "2026_plan")


class StatusTests(unittest.TestCase):
    def test_production_history_is_a_legacy_base_with_everything_after_034_pending(self):
        report = tool.status(PRODUCTION)
        chain = [file for file, _ in tool.forward_chain()]
        self.assertEqual(report["base"], "legacy")
        self.assertEqual(report["pending"], chain[chain.index("035_atomic_workspace_management_and_finding_exports.sql"):])
        self.assertEqual(report["hosted_only"], ["014_identity_visibility_policy", "022_v6_rights_quota_interfaces"])

    def test_rehearsal_history_matches_aliases_and_unprefixed_names(self):
        report = tool.status(REHEARSAL_BEFORE)
        self.assertEqual(report["base"], "baseline")
        self.assertNotIn("026_allow_reindex_original_reuse.sql", report["pending"], "recorded under a hosted alias")
        self.assertNotIn("039_canonical_service_role_processing_authority.sql", report["pending"])
        self.assertEqual(report["pending"][0], "040_recipient_bound_workspace_invitations.sql")
        self.assertEqual(report["hosted_only"], ["temporary_hosted_reservation_concurrency_harness"])

    def test_fully_applied_history_has_nothing_pending(self):
        applied = ["001_v6_zero_cost_baseline", *[Path(file).stem for file, _ in tool.forward_chain()]]
        self.assertEqual(tool.status(applied)["pending"], [])

    def test_a_database_without_a_base_is_reported(self):
        self.assertIsNone(tool.status(["private_history_read"])["base"])
        with tempfile.TemporaryDirectory() as directory:
            listing = Path(directory) / "applied.json"
            listing.write_text(json.dumps({"migrations": [{"version": "1", "name": "private_history_read"}]}))
            with mock.patch("sys.stdout", io.StringIO()) as out:
                self.assertEqual(tool.main(["status", "--applied", str(listing)]), 1)
            self.assertIn("base: MISSING", out.getvalue())


class CommandLineTests(unittest.TestCase):
    def run_cli(self, *argv, env=None):
        with mock.patch.dict("os.environ", env or {}, clear=True), mock.patch("sys.stdout", io.StringIO()) as out:
            return tool.main(list(argv)), out.getvalue()

    def test_status_reads_a_list_migrations_file_and_can_fail_on_pending(self):
        with tempfile.TemporaryDirectory() as directory:
            listing = Path(directory) / "applied.json"
            listing.write_text(json.dumps({"migrations": [{"version": "1", "name": name} for name in REHEARSAL_BEFORE]}))
            code, printed = self.run_cli("status", "--applied", str(listing))
            self.assertEqual(code, 0)
            self.assertIn("base: baseline", printed)
            self.assertIn("pending 040_recipient_bound_workspace_invitations.sql", printed)
            self.assertEqual(self.run_cli("status", "--applied", str(listing), "--fail-on-pending")[0], 1)
            code, printed = self.run_cli("status", "--applied", str(listing), "--json")
            self.assertEqual(json.loads(printed)["base"], "baseline")

    def test_chain_prints_the_forward_files(self):
        code, printed = self.run_cli("chain")
        self.assertEqual(code, 0)
        self.assertEqual(printed.split(), [file for file, _ in tool.forward_chain()])

    def test_apply_requires_a_database_and_a_snapshot_label(self):
        for argv, env in [
            (["apply"], {}),
            (["apply", "--snapshot-label", "x"], {}),
            (["apply"], {"SUPABASE_DB_URL": "postgresql://example.invalid/db"}),
            (["apply", "--snapshot-label", "x", "--applied", "list.json"], {"SUPABASE_DB_URL": "postgresql://example.invalid/db"}),
            (["status"], {}),
        ]:
            with self.subTest(argv=argv), mock.patch("sys.stderr", io.StringIO()), self.assertRaises(SystemExit):
                self.run_cli(*argv, env=env)

    def test_snapshot_label_is_restricted_and_the_connection_string_is_never_printed(self):
        with self.assertRaises(ValueError):
            tool.snapshot("postgresql://user:secret@example.invalid/db", "bad label; drop")
        failed = mock.Mock(returncode=2, stderr="psql: error: connection to server failed\n", stdout="")
        with mock.patch.object(tool.subprocess, "run", return_value=failed):
            with self.assertRaises(RuntimeError) as raised:
                tool.applied_from_database("postgresql://user:secret@example.invalid/db")
        self.assertNotIn("secret", str(raised.exception))


if __name__ == "__main__":
    unittest.main()
