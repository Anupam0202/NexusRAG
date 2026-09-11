from __future__ import annotations

from pathlib import Path
import re
import unittest


MIGRATION = (
    Path(__file__).resolve().parents[3]
    / "supabase"
    / "migrations"
    / "023_private_storage_authorization.sql"
)


class StorageSqlContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.sql = MIGRATION.read_text(encoding="utf-8").lower()

    def test_bucket_is_private_and_bounded(self):
        self.assertIn("'documents','documents',false,25000000", self.sql)
        self.assertIn("allowed_mime_types=excluded.allowed_mime_types", self.sql)

    def test_object_write_requires_exact_allocated_key(self):
        function = self.sql.split(
            "create or replace function nexusrag_private.can_write_document_object", 1
        )[1].split("revoke execute", 1)[0]
        self.assertIn("u.original_key=p_name", function)
        self.assertIn("u.actor_id=(select auth.uid())", function)
        self.assertIn("u.state='receiving'", function)
        self.assertIn("u.write_token is not null", function)
        self.assertIn("u.expires_at>clock_timestamp()", function)

    def test_client_delete_policy_is_absent_after_legacy_drop(self):
        self.assertIn(
            'drop policy if exists "storage_documents_delete_editors"', self.sql
        )
        create_policies = re.findall(
            r'create policy\s+"[^"]+"\s+on storage\.objects for (\w+)', self.sql
        )
        self.assertEqual(create_policies, ["select", "insert", "update"])

    def test_private_helpers_are_fixed_path_security_definer(self):
        self.assertGreaterEqual(self.sql.count("security definer"), 2)
        self.assertGreaterEqual(
            self.sql.count("set search_path=public,storage,pg_temp"), 2
        )
        self.assertIn(
            "revoke execute on function nexusrag_private.can_write_document_object(text) from public,anon",
            self.sql,
        )

    def test_cleanup_claim_is_service_only_bounded_and_skip_locked(self):
        self.assertIn("p_limit not between 1 and 500", self.sql)
        self.assertIn("for update skip locked", self.sql)
        self.assertIn(
            "revoke execute on function public.claim_expired_document_uploads(integer) from public,anon,authenticated",
            self.sql,
        )
        self.assertIn("cleanup_state='pending'", self.sql)


if __name__ == "__main__":
    unittest.main()
