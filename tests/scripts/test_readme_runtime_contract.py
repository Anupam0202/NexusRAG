"""Keep setup instructions consistent with the saved runtime contracts."""

import json
from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[2]


class ReadmeRuntimeContractTests(unittest.TestCase):
    def setUp(self):
        self.readme = (ROOT / "README.md").read_text(encoding="utf-8")
        self.lock = json.loads((ROOT / "frontend/package-lock.json").read_text())

    def section(self, heading):
        """The text under a `## ` heading, up to the next one."""
        return self.readme.split(f"\n## {heading}\n", 1)[1].split("\n## ", 1)[0]

    def test_node_and_styling_match_the_locked_frontend(self):
        minimum = self.lock["packages"]["node_modules/next"]["engines"]["node"]
        major = self.lock["packages"]["node_modules/tailwindcss"]["version"].split(".")[0]
        self.assertIn(f"Next.js requires Node `{minimum}`", self.readme)
        self.assertIn(f"TailwindCSS {major},", self.readme)
        self.assertNotIn("Node.js 18+", self.readme)

    def test_frontend_setup_uses_the_real_lock(self):
        setup = self.section("Running it locally")
        self.assertIn("\nnpm ci --ignore-scripts\n", setup)
        self.assertNotIn("npm install", setup)

    def test_deployment_is_not_described_as_automatic(self):
        section = self.section("Deployment")
        self.assertIn("Nothing deploys automatically", section)
        self.assertIn("opt-in", section)
        self.assertIn("NexusRAG-Candidate-Preview", section)
        self.assertIn("not production acceptance", section)
        self.assertIn("rolls back automatically on failure", section)

    def test_oauth_provider_configuration_is_a_table_row(self):
        rows = [line for line in self.section("Configuration").splitlines() if line.startswith("| `NEXT_PUBLIC_OAUTH_PROVIDERS` |")]
        self.assertEqual(len(rows), 1)
        self.assertIn("OAuth callbacks", rows[0])

    def test_provider_setup_does_not_promise_a_bundled_key_or_free_quota(self):
        section = self.section("What it does")
        self.assertIn("ships no usable provider key", section)
        self.assertNotIn("ships with a default API key", section)
        self.assertNotIn("free `list_models()` call", section)
        self.assertIn("rights and budget", section)

    def test_readme_local_document_links_resolve(self):
        for target in re.findall(r"\[[^\]]+\]\(([^)]+)\)", self.readme):
            if "://" in target or target.startswith("#"):
                continue
            with self.subTest(target=target):
                self.assertTrue((ROOT / target.split("#", 1)[0]).is_file())


if __name__ == "__main__":
    unittest.main()
