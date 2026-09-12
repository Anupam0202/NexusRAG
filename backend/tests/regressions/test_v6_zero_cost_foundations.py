from datetime import datetime,timedelta,timezone
from decimal import Decimal
import unittest
class ZeroCostFoundations(unittest.TestCase):
 def test_Z01_Z04_unknown_and_over_limit_fail_closed(self):
  from src.domain.zero_cost import CapacityState,ResourceBudget,admit
  unknown=admit(ResourceBudget("gemini",None),1);self.assertFalse(unknown.allowed);self.assertEqual(unknown.state,CapacityState.REVIEW_REQUIRED)
  exhausted=admit(ResourceBudget("qdrant",100,used=100),1);self.assertFalse(exhausted.allowed);self.assertEqual(exhausted.state,CapacityState.QUOTA_EXHAUSTED)
 def test_Z05_Z13_nonessential_work_degrades_before_hard_limit(self):
  from src.domain.zero_cost import CapacityState,Priority,ResourceBudget,admit
  decision=admit(ResourceBudget("browser_minutes",100,used=84),2,priority=Priority.BACKGROUND);self.assertFalse(decision.allowed);self.assertEqual(decision.state,CapacityState.DEGRADED)
  essential=admit(ResourceBudget("export_bytes",100,used=94),5,priority=Priority.ESSENTIAL);self.assertTrue(essential.allowed);self.assertEqual(essential.state,CapacityState.QUOTA_NEAR_LIMIT)
 def test_Z23_reset_is_explicit(self):
  from src.domain.zero_cost import CapacityState,ResourceBudget,admit
  reset=datetime.now(timezone.utc)+timedelta(hours=1);decision=admit(ResourceBudget("api",10,used=10,reset_at=reset),1);self.assertEqual(decision.state,CapacityState.TRY_AFTER_RESET)
 def test_rights_fail_closed_and_attribution_survives(self):
  from src.domain.provider_rights import ProviderRights,RightsAction,RightsDecision,decide,require_allowed
  self.assertEqual(decide(ProviderRights("unknown"),RightsAction.FETCH).decision,RightsDecision.REVIEW_REQUIRED)
  policy=ProviderRights("official",frozenset({RightsAction.FETCH,RightsAction.DISPLAY}),attribution=("Credit publisher",),terms_hash="a"*64,terms_checked_at="2026-09-11",status="APPROVED_WITH_DUTIES")
  self.assertEqual(require_allowed(policy,RightsAction.FETCH,RightsAction.DISPLAY),("Credit publisher",))
 def test_uncertain_identity_cannot_drive_automated_join(self):
  from src.domain.temporal_graph import EntityLink,EvidenceRef,ResolutionStatus,TemporalInterval
  evidence=(EvidenceRef("v1","citation-1","a"*64),);inferred=EntityLink("a","b","OWNS",Decimal("0.99"),ResolutionStatus.INFERRED,TemporalInterval(),evidence);self.assertFalse(inferred.may_drive_automated_join)
 def test_terms_radar_is_review_safe(self):
  from src.application.provider_radar import ChangeMateriality,Snapshot,classify_change
  before=Snapshot.from_text("p","https://official.example/terms","Use is allowed.");after=Snapshot.from_text("p","https://official.example/terms","Commercial use now requires a licence.")
  self.assertEqual(classify_change(before,after).materiality,ChangeMateriality.RIGHTS_REVIEW)
if __name__=="__main__":unittest.main()
