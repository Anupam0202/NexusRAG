"""Dependabot keeps the pinned GitHub Actions current (NX-38); every action stays pinned to a commit."""
from pathlib import Path
import re
import unittest

import yaml

ROOT = Path(__file__).resolve().parents[2]
PINNED = re.compile(r"^[\w.-]+/[\w./-]+@[0-9a-f]{40}$")


class DependabotTests(unittest.TestCase):
    def test_github_actions_are_checked_weekly_in_one_grouped_pull_request(self):
        config = yaml.safe_load((ROOT / ".github/dependabot.yml").read_text())
        self.assertEqual(config["version"], 2)
        (update,) = config["updates"]  # only the ecosystem the owner approved (GOAL.md section 2)
        self.assertEqual((update["package-ecosystem"], update["directory"]), ("github-actions", "/"))
        self.assertEqual(update["schedule"]["interval"], "weekly")
        self.assertEqual(update["groups"]["github-actions"]["patterns"], ["*"])
        self.assertEqual(update["commit-message"]["prefix"], "ci", "Conventional Commits")

    def test_every_action_is_pinned_to_a_commit_with_its_version_noted(self):
        for workflow in sorted((ROOT / ".github/workflows").glob("*.yml")):
            for line in workflow.read_text().splitlines():
                found = re.match(r"\s*(?:-\s+)?uses:\s*(\S+)(.*)$", line)
                if not found or found.group(1).startswith("./"):
                    continue
                self.assertRegex(found.group(1), PINNED, f"{workflow.name}: {line.strip()}")
                self.assertRegex(found.group(2), r"#\s*v\d", f"{workflow.name}: the version comment lets Dependabot update it")


if __name__ == "__main__":
    unittest.main()
