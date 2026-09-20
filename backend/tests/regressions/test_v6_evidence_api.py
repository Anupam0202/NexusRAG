from pathlib import Path
import unittest


class EvidenceApiContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = (
            Path(__file__).resolve().parents[2] / "src/api/evidence_routes.py"
        ).read_text()

    def test_routes_are_api_key_and_workspace_guarded(self):
        self.assertIn("dependencies=[Depends(verify_api_key)]", self.source)
        for route in (
            '"/capabilities"',
            '"/claims/assess"',
            '"/calculations"',
            '"/obligations/review"',
            '"/passports/export"',
            '"/mcp/operations"',
            '"/standards"',
            '"/setup/checks"',
            '"/research/plans"',
        ):
            self.assertIn(route, self.source)
        self.assertGreaterEqual(self.source.count("Depends(VIEWER)"), 6)
        self.assertGreaterEqual(self.source.count("Depends(EDITOR)"), 3)

    def test_deterministic_engines_are_used(self):
        self.assertIn("result = calculate(", self.source)
        self.assertIn("claim = assess_claim(", self.source)
        self.assertIn("result = review(", self.source)
        self.assertIn("passport.canonical_receipt()", self.source)
        self.assertIn("ResearchPlan(", self.source)
        self.assertIn('"autonomous_destructive_tools": False', self.source)
        self.assertNotIn("ChatGoogleGenerativeAI", self.source)