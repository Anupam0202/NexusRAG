"""Keep the ordinary draft persistence workflow in source and required CI."""
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]

class ResearchWorkflowTests(unittest.TestCase):
    def test_forward_sql_and_ordinary_retries_are_in_the_disposable_rehearsal(self):
        sql = "20261014194036_research_plan_persistence.sql"
        rehearsal = (ROOT / "tests/postgres/local-rehearsal.sh").read_text()
        workflow = (ROOT / ".github/workflows/v6-database-rehearsal.yml").read_text()
        self.assertIn(sql, rehearsal)
        self.assertIn(sql, workflow)
        self.assertIn("research-plan-assertions.sql", rehearsal)
        self.assertIn("research-plan-concurrency.sh", rehearsal)
        self.assertIn("POSTGRES_RESEARCH_PLAN_CONCURRENT_RETRY_PASS", workflow)

    def test_twelve_shared_modes_are_present_in_the_sql_contract(self):
        modes = json.loads((ROOT / "frontend/src/lib/research-modes.json").read_text())
        sql = (ROOT / "supabase/migrations/20261014194036_research_plan_persistence.sql").read_text()
        self.assertEqual(len(modes), 12)
        for name in modes:
            self.assertIn("when '" + name + "'", sql)

    def test_browser_fixture_uses_the_production_page_client_and_gateway(self):
        fixture = (ROOT / "frontend/scripts/research-browser-fixture.mjs").read_text()
        entry = (ROOT / "frontend/scripts/fixtures/research-plans.tsx").read_text()
        self.assertIn("apps/gateway/src/preview-worker.js", fixture)
        self.assertIn("src/app/research/page", entry)
        self.assertIn("E2E_RESEARCH_COMPONENT_FIXTURE", (ROOT / ".github/workflows/v6-foundation-ci.yml").read_text())

    def test_public_route_and_truthful_draft_only_status_are_exercised(self):
        self.assertIn('path: "/research"', (ROOT / "frontend/src/e2e/public-smoke.spec.ts").read_text())
        page = (ROOT / "frontend/src/app/research/page.tsx").read_text()
        self.assertIn("Saved draft. Execution has not started.", page)
        self.assertIn("not currently available", page)

if __name__ == "__main__":
    unittest.main()
