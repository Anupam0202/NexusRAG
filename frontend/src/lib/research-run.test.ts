import { expect,it } from "vitest";
import { confirmedResearchRun } from "./research-run";
const id="11111111-1111-4111-8111-111111111111";
const run={id,plan_id:id,workspace_id:id,owner_id:id,schema_version:"research-run/1",persistence_state:"PERSISTED",state:"queued",generation:1,
  position:0,questions:["Synthetic question?"],results:[],source_state:"CURRENT",error_code:null,created_at:"2026-10-15T00:00:00Z"};
it("confirms only durable run progress without inventing completion",()=>{
  expect(confirmedResearchRun(run,id)).toBe(true);
  for(const row of [{...run,state:"completed"},{...run,position:1},{...run,generation:11},{...run,questions:[]},{...run,source_state:"UNKNOWN"}])
    expect(confirmedResearchRun(row,id)).toBe(false);
});
it("accepts unavailable result redaction without pretending saved answers were erased",()=>{
  expect(confirmedResearchRun({...run,state:"completed",position:1,source_state:"UNAVAILABLE_OR_CHANGED"},id)).toBe(true);
});
it("retains a complete40document9criterion45batch360cell matrix with validated progress",()=>{
  const snapshot=Array.from({length:40},(_,i)=>({document_id:`00000000-0000-4000-8000-${String(i).padStart(12,"0")}`}));
  const questions=Array.from({length:9},(_,i)=>`Criterion${i}`);
  const results=Array.from({length:45},(_,i)=>({question:questions[Math.floor(i/5)],answer:"No evidence.",claim_state:"UNSUPPORTED",abstained:true,sources:[],validated_citation_ids:[],
    coverage:{completeness:"NOT_EXHAUSTIVE",chunks_considered:0},provider_cost_status:"NOT_CALLED",review_state:"COMPLETION_CRITERIA_NOT_AUTOMATICALLY_VERIFIED",
    comparison:{schema_version:"research-comparison/1",criterion_index:Math.floor(i/5),batch_index:i%5,batch_count:5,total_documents:40,
      interpretation:"REVIEW_REQUIRED_NO_AUTOMATIC_EQUIVALENCE_OR_RANKING",cells:snapshot.slice((i%5)*8,(i%5)*8+8).map(s=>({document_id:s.document_id,filename:"Synthetic",
        answer:"No evidence.",claim_state:"UNSUPPORTED",abstained:true,validated_citation_ids:[],gap:"NO_INDEXED_EVIDENCE"}))}}));
  const complete={...run,mode:"COMPARE",source_snapshot:snapshot,questions,results,total_steps:45,position:45,state:"completed"};
  expect(confirmedResearchRun(complete,id)).toBe(true);expect(confirmedResearchRun({...complete,total_steps:44},id)).toBe(false);
  expect(confirmedResearchRun({...complete,position:44},id)).toBe(false);
  expect(confirmedResearchRun({...complete,results_included:false,results:[]},id)).toBe(true);
  expect(confirmedResearchRun({...complete,results:[]},id)).toBe(false);
});
it("rejects mismatched questions, unknown citations and unsupported answer states",()=>{
  const source={citation_id:"S1",document_id:id,version_id:id,chunk_id:id,filename:"synthetic.txt",content:"Mass 1.005 kg",original_content_hash:"a".repeat(64)};
  const result={question:run.questions[0],answer:"Mass is 1.005 kg [S1].",claim_state:"REVIEW_REQUIRED",abstained:false,sources:[source],validated_citation_ids:["S1"],
    coverage:{completeness:"NOT_EXHAUSTIVE",chunks_considered:1},provider_cost_status:"UNKNOWN",review_state:"COMPLETION_CRITERIA_NOT_AUTOMATICALLY_VERIFIED"};
  expect(confirmedResearchRun({...run,state:"completed",position:1,results:[result]},id)).toBe(true);
  for(const bad of [{...result,question:"different"},{...result,claim_state:"SUPPORTED"},{...result,validated_citation_ids:["S99"]},{...result,coverage:null}])
    expect(confirmedResearchRun({...run,state:"completed",position:1,results:[bad]},id)).toBe(false);
});
