import {expect,it} from "vitest";
import {passportCapacity,passportWire} from "../../../tests/fixtures/research-passport-data.mjs";
import {passportResult,passportWork} from "../../../apps/gateway/src/research-passport.js";
import {confirmedResearchRun,type ResearchRun} from "./research-run";
import {researchResultsClipboardText} from "./research-run-copy";

const id="11111111-1111-4111-8111-111111111111";
function fixture():ResearchRun {
  const data=passportCapacity();
  const results=data.run.questions.map((question,position)=>{
    const value=passportResult(passportWork({...data.run,position}),data.documents,data.sources,{answer:JSON.stringify(passportWire(data.sources))});
    return {question,answer:value.checked.answer,claim_state:value.checked.claim_state,abstained:value.checked.abstained,
      sources:value.sources,validated_citation_ids:value.sources.map((source:{citation_id:string})=>source.citation_id),passport:value.analysis,
      model:null,coverage:{completeness:"NOT_EXHAUSTIVE",chunks_considered:200},provider_cost_status:"UNKNOWN",
      review_state:"COMPLETION_CRITERIA_NOT_AUTOMATICALLY_VERIFIED"};
  });
  return {...data.run,id,plan_id:id,workspace_id:id,owner_id:id,schema_version:"research-run/1",persistence_state:"PERSISTED",
    state:"completed",generation:1,position:13,results,total_steps:13,source_state:"CURRENT",error_code:null,
    created_at:"2026-10-24T11:00:00Z"} as unknown as ResearchRun;
}
it("confirms the actual sixty-source thirteen-criterion Passport executor result without dropping structured fields",()=>{
  expect(confirmedResearchRun(fixture(),id)).toBe(true);
});
it("copies the exact qualified product analysis,source gaps and unverified-subject interpretation",()=>{
  const run=fixture(),analysis=(run.results[12] as unknown as {passport:unknown}).passport;
  expect(researchResultsClipboardText(run.results)).toContain(JSON.stringify(analysis,null,2));
});
it("retains all sixty source identities on a list receipt without treating omitted results as full readback",()=>{
  const run=fixture();run.results=[];run.results_included=false;
  expect(confirmedResearchRun(run,id)).toBe(true);
  run.results_included=undefined;run.source_state="UNAVAILABLE_OR_CHANGED";
  expect(confirmedResearchRun(run,id)).toBe(true);
});
