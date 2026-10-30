"""Ordinary supplied-snapshot materiality, independent of provider acquisition."""
import json
from pathlib import Path
import unittest

from src.application.provider_radar import ChangeMateriality, Snapshot, classify_change, normalize_text

ROOT = Path(__file__).resolve().parents[3]


class RadarMaterialityTests(unittest.TestCase):
    def test_contextual_material_changes_and_editorial_counterexamples(self):
        cases = json.loads((ROOT / "tests/fixtures/radar-materiality.json").read_text())
        for case in cases:
            with self.subTest(case["name"]):
                before = Snapshot.from_text("synthetic", "https://example.invalid/quota", case["before"])
                after = Snapshot.from_text("synthetic", "https://example.invalid/quota", case["after"])
                actual = classify_change(before, after)
                self.assertEqual(actual.materiality, case["materiality"])
                self.assertEqual(list(actual.matched_signals), case["signals"])
                self.assertEqual(actual.changed, before.content_hash != after.content_hash)

    def test_cross_source_or_provider_is_not_a_version_comparison(self):
        before = Snapshot.from_text("one", "https://example.invalid/quota", "Quota: 100.")
        for provider, source in [("two", before.source_url), ("one", "https://example.invalid/pricing")]:
            with self.subTest(provider=provider, source=source):
                with self.assertRaises(ValueError):
                    classify_change(before, Snapshot.from_text(provider, source, "Quota: 10."))

    def test_repeated_large_editorial_input_does_not_change_unchanged_operational_context(self):
        # No whole-document alignment is needed to distinguish unrelated numbers.
        prefix = "Quota: 100 requests per day. " * 5000
        before = Snapshot.from_text("one", "https://example.invalid/quota", prefix + "Page count: 12.")
        after = Snapshot.from_text("one", "https://example.invalid/quota", prefix + "Page count: 13.")
        self.assertEqual(classify_change(before, after).materiality, ChangeMateriality.EDITORIAL)

    def test_normalization_preserves_bom_and_matches_all_existing_whitespace(self):
        whitespace = list(range(9, 14)) + list(range(28, 33)) + [133, 160, 5760] + list(range(8192, 8203)) + [8232, 8233, 8239, 8287, 12288]
        for codepoint in whitespace:
            with self.subTest(codepoint=codepoint):
                self.assertEqual(normalize_text(chr(codepoint) + "Quota" + chr(codepoint) + "100" + chr(codepoint)), "Quota 100")
        self.assertEqual(normalize_text("\ufeffQuota 100\ufeff"), "\ufeffQuota 100\ufeff")

    def test_exact_large_decimal_within_complete_comparison_projection(self):
        # 65,000 digits stay below the Gateway's 65,536-codepoint projection;
        # exact comparison must not convert this accepted text to float/int.
        prefix = "Quota: " + "9" * 65000
        before = Snapshot.from_text("one", "https://example.invalid/quota", prefix + "1.")
        after = Snapshot.from_text("one", "https://example.invalid/quota", prefix + "2.")
        self.assertEqual(classify_change(before, after).materiality, ChangeMateriality.OPERATIONAL)


if __name__ == "__main__":
    unittest.main()
