"""Declared product identity is a planning input, not verified product evidence."""
from dataclasses import asdict
import unittest

from src.domain.research_planner import PassportSubject


class PassportSubjectTests(unittest.TestCase):
    def test_identity_preserves_unicode_and_normalizes_surrounding_whitespace(self):
        subject = PassportSubject(" sample-id ", "\U0001f4ca" * 256, " 2.1 ", " Synthetic supplier ")
        self.assertEqual(asdict(subject), {"product_id": "sample-id", "product_name": "\U0001f4ca" * 256,
                                         "product_version": "2.1", "supplier": "Synthetic supplier"})

    def test_incomplete_and_over_limit_subjects_are_not_valid_inputs(self):
        for field, value in (("product_id", "x" * 129), ("product_name", "\U0001f4ca" * 257),
                             ("product_version", " "), ("supplier", "sup\0plier")):
            with self.subTest(field=field), self.assertRaises(ValueError):
                PassportSubject(**({"product_id": "sample-id", "product_name": "Synthetic sensor",
                                    "product_version": "2.1", "supplier": "Synthetic supplier"} | {field: value}))
