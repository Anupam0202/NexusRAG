import {expect,it} from "vitest";
import {procurementCapacity,procurementWire} from "../../../tests/fixtures/research-procurement-data.mjs";
import {procurementResult,procurementWork} from "../../../apps/gateway/src/research-procurement.js";
import {confirmedResearchRun,type ResearchRun} from "./research-run";
import {researchResultsClipboardText} from "./research-run-copy";

const id="11111111-1111-4111-8111-111111111111";
function procurementRunFixture():ResearchRun {
  const data=procurementCapacity();
  const results=data.run.questions.map((question,position)=>{
    const value=procurementResult(procurementWork({...data.run,position}),data.documents,data.sources,{answer:JSON.stringify(procurementWire(data.sources))});
    return {question,answer:value.checked.answer,claim_state:value.checked.claim_state,abstained:value.checked.abstained,
      sources:value.sources,validated_citation_ids:value.sources.map((source:{citation_id:string})=>source.citation_id),procurement:value.analysis,
      model:null,coverage:{completeness:"NOT_EXHAUSTIVE",chunks_considered:200},provider_cost_status:"UNKNOWN",
      review_state:"COMPLETION_CRITERIA_NOT_AUTOMATICALLY_VERIFIED"};
  });
  return {...data.run,id,plan_id:id,workspace_id:id,owner_id:id,schema_version:"research-run/1",persistence_state:"PERSISTED",
    state:"completed",generation:1,position:11,results,total_steps:11,source_state:"CURRENT",error_code:null,
    created_at:"2026-10-25T00:00:00Z"} as unknown as ResearchRun;
}
it("confirms the actual fifty-source eleven-criterion Procurement executor result",()=>{
  expect(confirmedResearchRun(procurementRunFixture(),id)).toBe(true);
});
it.each(["quote","version","page","limitation","value interpretation"])("does not confirm incomplete %s readback as a durable Procurement result",field=>{
  const run=procurementRunFixture(),result=run.results[0],analysis=result.procurement!;
  if(field==="quote")analysis.records[0].fields.notice_id.quote="Different source wording";
  if(field==="version")analysis.records[0].source_version_id=id;
  if(field==="page")analysis.documents[0].consulted_sources[0].page_number=0;
  if(field==="limitation")analysis.records[0].limitations=[];
  if(field==="value interpretation")(analysis.records[0] as unknown as {value_interpretation:string}).value_interpretation="CONVERTED_VALUE";
  expect(confirmedResearchRun(run,id)).toBe(false);
});
it("copies the entire source-worded analysis with all thirteen fields,qualifications,gaps and unverified decisions",()=>{
  const run=procurementRunFixture(),analysis=(run.results[10] as unknown as {procurement:unknown}).procurement;
  expect(researchResultsClipboardText(run.results)).toContain(JSON.stringify(analysis,null,2));
});
it("keeps all fifty source identities when list results are omitted or original evidence is unavailable",()=>{
  const run=procurementRunFixture();run.results=[];run.results_included=false;
  expect(confirmedResearchRun(run,id)).toBe(true);
  run.results_included=undefined;run.source_state="UNAVAILABLE_OR_CHANGED";
  expect(confirmedResearchRun(run,id)).toBe(true);
});
