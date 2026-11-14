import {fireEvent,render,screen} from "@testing-library/react";
import {expect,it} from "vitest";
import {DiligenceObservations} from "./DiligenceObservations";
import type {ResearchDiligence} from "@/lib/research-diligence";

function fixture():ResearchDiligence {
  return {schema_version:"research-diligence/1",criterion_index:0,total_documents:1,requested_targets:["Example Components"],observations:[{
    topic:"IDENTITY",summary:"The filing contains a name and unresolved identifier.",limitations:["The filing alone does not establish a verified identity."],
    evidence:[{document_id:"synthetic",citation_id:"S1",quote:"Example Components (EX-17), not verified as current.",quote_start:0,quote_end:52}],
    claim_state:"REVIEW_REQUIRED",identity_state:"NOT_RESOLVED",decision_state:"NO_AUTOMATIC_ADVERSE_DECISION"}],
    gaps:[{document_id:"synthetic",description:"A later amendment has not been established.",state:"FOLLOW_UP_REQUIRED_NOT_ABSENCE_PROOF"}],
    documents:[{document_id:"synthetic",filename:"Synthetic filing.txt",evidence_state:"OBSERVATION",consulted_sources:[]}],rejections:[],
    interpretation:"INDEPENDENT_REVIEW_NO_VERIFIED_IDENTITY_OR_ADVERSE_DECISION",coverage:"BOUNDED_SOURCE_REVIEW_NOT_COMPLETE_DUE_DILIGENCE"};
}
it("renders exact qualified source wording,review limitations,gaps and ordinary source navigation",()=>{
  render(<DiligenceObservations analysis={fixture()} sourcePrefix="run-result"/>);
  expect(screen.getByText("Example Components (EX-17), not verified as current.")).toBeVisible();
  expect(screen.getByRole("link",{name:"[S1]"})).toHaveAttribute("href","#run-result-S1");
  expect(screen.getByText("The filing alone does not establish a verified identity.")).toBeVisible();
  expect(screen.getByText("A later amendment has not been established.")).toBeVisible();
  expect(screen.getByText(/no automatic adverse decision/)).toBeVisible();
  fireEvent.click(screen.getByText("Requested subjects (1)"));expect(screen.getByText("Example Components")).toBeVisible();
});
it("an empty proposal does not claim complete coverage or a clean bill of health",()=>{
  const analysis=fixture();analysis.observations=[];analysis.gaps=[];
  render(<DiligenceObservations analysis={analysis}/>);
  expect(screen.getByText(/0 observations/)).toBeVisible();
  expect(screen.getByText(/does not establish complete coverage/)).toBeVisible();
  expect(screen.getByText(/not complete due diligence, verified identity or proof of no issues/)).toBeVisible();
});
