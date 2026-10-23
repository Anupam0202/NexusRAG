"""Declared product identity is a planning input, not verified product evidence."""
from dataclasses import asdict
import asyncio
from types import SimpleNamespace
import unittest

from src.domain.research_planner import PassportSubject


class PassportSubjectTests(unittest.TestCase):
    def test_retained_api_preserves_identity_without_claiming_durable_storage_or_execution(self):
        from src.api.evidence_routes import ResearchPlanInput, create_research_plan
        subject = {"product_id": " sample-id ", "product_name": "Synthetic sensor", "product_version": "2.1", "supplier": "Synthetic supplier"}
        payload = ResearchPlanInput(plan_id="sample-plan", mode="PRODUCT_PASSPORT", question="Inspect evidence",
                                    completion_criteria=["Inspect original sources"], passport_subject=subject)
        result = asyncio.run(create_research_plan(payload, SimpleNamespace(workspace_id="sample-workspace")))
        self.assertEqual(result["passport_subject"], subject | {"product_id": "sample-id"})
        self.assertEqual(result["persistence_state"], "NOT_PERSISTED")
        self.assertFalse(result["execution_supported"])

    def test_retained_api_reports_ordinary_invalid_identity_as_input_validation_errors(self):
        from pydantic import ValidationError
        from src.api.evidence_routes import ResearchPlanInput
        subject = {"product_id": "sample-id", "product_name": "Synthetic sensor", "product_version": "2.1", "supplier": "Synthetic supplier"}
        base = {"plan_id": "sample-plan", "mode": "PRODUCT_PASSPORT", "question": "Inspect evidence", "completion_criteria": ["Inspect original sources"]}
        for value in (None, {}, subject | {"supplier": " "}, subject | {"verified": True}, subject | {"product_version": "v\0bad"}):
            with self.subTest(value=value), self.assertRaises(ValidationError):
                ResearchPlanInput(**base, passport_subject=value)
        with self.assertRaises(ValidationError):
            ResearchPlanInput(**(base | {"mode": "QUICK_LOOKUP"}), passport_subject=subject)

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
