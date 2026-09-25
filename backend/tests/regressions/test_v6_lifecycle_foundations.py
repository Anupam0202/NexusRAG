from datetime import datetime,timezone
import unittest
class V6LifecycleFoundations(unittest.TestCase):
 def ledger(self):
  from src.domain.resource_accounting import ReservationLedger
  from src.domain.zero_cost import ResourceBudget
  ledger=ReservationLedger();ledger.set_budget("global","gemini",ResourceBudget("requests",100,used=10));ledger.set_budget("workspace:w1","gemini",ResourceBudget("requests",20,used=2));return ledger
 def test_global_workspace_reservation_and_settlement(self):
  from src.domain.resource_accounting import ReservationState
  ledger=self.ledger();reservation,decisions=ledger.reserve(workspace_id="w1",provider="gemini",resource="requests",amount=3,idempotency_key="k1");self.assertTrue(all(d.allowed for d in decisions.values()));self.assertEqual(ledger.budget("global","gemini","requests").reserved,3)
  settled=ledger.settle(reservation.id,2);self.assertEqual(settled.state,ReservationState.SETTLED);self.assertEqual(ledger.budget("global","gemini","requests").used,12)
 def test_ambiguous_usage_requires_reconciliation(self):
  from src.domain.resource_accounting import ReservationState
  ledger=self.ledger();reservation,_=ledger.reserve(workspace_id="w1",provider="gemini",resource="requests",amount=1,idempotency_key="k1");self.assertEqual(ledger.settle(reservation.id,None).state,ReservationState.RECONCILIATION_REQUIRED)
 def test_storage_classes_protect_irreplaceable(self):
  from src.domain.storage_policy import DataClass,default_policy,deletion_allowed,expires_at
  policy=default_policy(DataClass.IRREPLACEABLE);self.assertIsNone(expires_at(datetime.now(timezone.utc),policy));self.assertFalse(deletion_allowed(policy,workspace_authorized=True,exported=False,receipt_destination_available=True))
 def test_cache_changes_across_security_fence(self):
  from dataclasses import replace
  from src.domain.cache_fence import CacheFence,reusable
  h="a"*64;base=CacheFence("w1",1,h,h,(h,),"extract","p1","m1");self.assertFalse(reusable(base,replace(base,rights_hash="b"*64)))
 def test_browser_last_and_unchanged_avoids_ai(self):
  from src.application.monitoring_policy import RetrievalMethod,choose_method,should_invoke_ai
  self.assertEqual(choose_method({RetrievalMethod.STATIC_HTML,RetrievalMethod.BROWSER},static_sufficient=True),RetrievalMethod.STATIC_HTML);self.assertFalse(should_invoke_ai(content_changed=False,rights_allow_ai=True,material_change=True))
if __name__=="__main__":unittest.main()
