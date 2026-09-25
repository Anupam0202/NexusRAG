from pathlib import Path
import unittest

MIGRATION = (
    Path(__file__).resolve().parents[3]
    / "supabase"
    / "migrations"
    / "025_function_execution_hardening.sql"
)


class FunctionExecutionHardeningTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.sql = MIGRATION.read_text(encoding="utf-8").casefold()

    def test_anonymous_execution_is_revoked(self) -> None:
        for signature in (
            "public.match_document_chunks(extensions.vector, uuid, integer, jsonb)",
            "public.set_updated_at()",
            "public.uuid_or_null(text)",
        ):
            self.assertIn(f"revoke execute on function {signature}", self.sql)
        self.assertNotIn(
            "grant execute on function public.match_document_chunks(extensions.vector, uuid, integer, jsonb)\n  to anon",
            self.sql,
        )

    def test_required_execution_is_preserved(self) -> None:
        self.assertIn("to authenticated, service_role", self.sql)
        self.assertIn("has_function_privilege('anon'", self.sql)
        self.assertIn("has_function_privilege('authenticated'", self.sql)


if __name__ == "__main__":
    unittest.main()
