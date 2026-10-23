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

    def test_node_and_styling_match_the_locked_frontend(self):
        minimum = self.lock["packages"]["node_modules/next"]["engines"]["node"]
        major = self.lock["packages"]["node_modules/tailwindcss"]["version"].split(".")[0]
        self.assertIn(f"Next.js requires Node `{minimum}`", self.readme)
        self.assertIn(f"TailwindCSS {major},", self.readme)
        self.assertNotIn("Node.js 18+", self.readme)

    def test_frontend_setup_uses_the_real_lock(self):
        setup = self.readme.split("### 2. Setup Frontend\n", 1)[1].split("### 3.", 1)[0]
        self.assertIn("\nnpm ci\n", setup)
        self.assertNotIn("\nnpm install\n", setup)

    def test_deployment_is_not_described_as_automatic(self):
        section = self.readme.split("## Deployment\n", 1)[1].split("## Project Structure", 1)[0]
        self.assertIn("opt-in", section)
        self.assertIn("main-only", section)
        self.assertIn("NexusRAG-Candidate-Preview", section)
        self.assertIn("not production acceptance", section)

    def test_oauth_provider_configuration_is_a_table_row(self):
        section = self.readme.split("### Frontend Environment", 1)[1].split("## API Reference", 1)[0]
        rows = section.split("\n\n", 1)[1].split("\n\n", 1)[0]
        self.assertIn("| `NEXT_PUBLIC_OAUTH_PROVIDERS` |", rows)
        self.assertIn("OAuth callbacks", rows)

    def test_provider_setup_does_not_promise_a_bundled_key_or_free_quota(self):
        section = self.readme.split("## Rate Limit & API Key Handling\n", 1)[1].split("## RAG Pipeline", 1)[0]
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
