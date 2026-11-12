"""Repository-level guards for the rehearsal harness and the Worker routing check in CI.

Release target isolation lives in tests/scripts/test_release.py.
"""
import re
import unittest
from pathlib import Path


class RehearsalAndRoutingGuardTests(unittest.TestCase):
    def test_ci_exercises_document_routes_against_the_worker(self):
        repository = Path(__file__).resolve().parents[2]
        workflow = (repository / ".github/workflows/v6-foundation-ci.yml").read_text()
        self.assertIn("npm run cf:build", workflow)
        self.assertIn("npm exec wrangler -- dev --local --port 3003", workflow)
        self.assertIn("E2E_BASE_URL=http://localhost:3003 npm exec playwright -- test worker-routing.spec.ts", workflow)

    def test_database_required_summary_fails_closed(self):
        repository = Path(__file__).resolve().parents[2]
        workflow = (repository / ".github/workflows/v6-database-rehearsal.yml").read_text()
        self.assertIn("  required-clean-supabase-summary:\n    if: always()", workflow)
        self.assertIn("REHEARSAL_RESULT: ${{ needs.clean-baseline-rehearsal.result }}", workflow)
        self.assertIn('test "$REHEARSAL_RESULT" = success', workflow)
        self.assertEqual(workflow.count("name: Clean Supabase baseline rehearsal"), 1)

    def test_every_rehearsed_forward_migration_is_packaged_for_ci(self):
        repository = Path(__file__).resolve().parents[2]
        harness = (repository / "tests/postgres/local-rehearsal.sh").read_text()
        workflow = (repository / ".github/workflows/v6-database-rehearsal.yml").read_text()
        migrations = re.findall(r'\$ROOT/(supabase/migrations/[^"]+\.sql)', harness)
        self.assertGreaterEqual(len(migrations), 15)
        for migration in migrations:
            with self.subTest(migration=migration):
                self.assertTrue((repository / migration).is_file())
                self.assertIn(
                    f'cp "$GITHUB_WORKSPACE/{migration}" "$source_dir/supabase/migrations/"',
                    workflow,
                )

    def test_research_capacity_appendices_have_disjoint_fixture_ids(self):
        repository = Path(__file__).resolve().parents[2]
        namespaces = []
        for name in ("diligence", "passport"):
            source = (repository / f"tests/postgres/research-{name}-integration.mjs").read_text()
            prefixes = set(re.findall(r'"(ff[0-9a-f]{6}-0000-4000-8100-)"', source))
            self.assertTrue(prefixes, f"Missing {name} appendix fixture namespace")
            namespaces.append(prefixes)
        self.assertFalse(namespaces[0] & namespaces[1], "Shared SQL rehearsal must not reuse tenant/chunk IDs")


if __name__ == "__main__":
    unittest.main()
