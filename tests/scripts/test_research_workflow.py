"""Keep the ordinary draft persistence workflow in source and required CI."""
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]

class ResearchWorkflowTests(unittest.TestCase):
    def test_calculation_execution_and_retries_are_in_the_real_rehearsal(self):
        rehearsal=(ROOT / "tests/postgres/local-rehearsal.sh").read_text()
        workflow=(ROOT / ".github/workflows/v6-database-rehearsal.yml").read_text()
        for name in ("20261015053618_research_calculation_execution.sql", "research-calculation-assertions.sql", "research-calculation-concurrency.sh"):
            self.assertIn(name,rehearsal)
        self.assertIn("20261015053618_research_calculation_execution.sql",workflow)
        self.assertIn("POSTGRES_RESEARCH_CALCULATION_CONCURRENT_RETRY_PASS",workflow)
        self.assertIn("calculation-parity.py",rehearsal)
        self.assertIn("RESEARCH_CALCULATION_PYTHON_ENGINE_PARITY_PASS cases=196",workflow)
        self.assertIn("research-calculations.spec.ts",(ROOT / ".github/workflows/v6-foundation-ci.yml").read_text())

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

    def test_generated_html_fixture_declares_cold_dependency_entry(self):
        fixture=(ROOT / "frontend/scripts/research-browser-fixture.mjs").read_text()
        self.assertIn('entries: ["scripts/fixtures/research-plans.tsx"]',fixture)
        self.assertIn("force: true, holdUntilCrawlEnd: true",fixture)
        self.assertIn("unexpectedNavigations",(ROOT / "frontend/src/e2e/research-calculations.spec.ts").read_text())

    def test_public_route_and_truthful_draft_only_status_are_exercised(self):
        self.assertIn('path: "/research"', (ROOT / "frontend/src/e2e/public-smoke.spec.ts").read_text())
        page = (ROOT / "frontend/src/app/research/page.tsx").read_text()
        self.assertIn("Saved draft. Execution has not started.", page)
        self.assertIn("not currently available", page)

if __name__ == "__main__":
    unittest.main()
