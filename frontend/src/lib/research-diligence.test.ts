import {expect,it} from "vitest";
import {confirmedResearchRun,type ResearchRun,type ResearchRunResult} from "./research-run";
import {researchResultsClipboardText} from "./research-run-copy";
import type {ResearchDiligence} from "./research-diligence";

const id="11111111-1111-4111-8111-111111111111";
function fixture():ResearchRun {
  const identity=(prefix:string,i:number)=>`${prefix}0000000-0000-4000-8000-${String(i+1).padStart(12,"0")}`;
  const snapshot=Array.from({length:60},(_,i)=>({document_id:identity("1",i),version_id:identity("2",i),index_generation:"generation-1",lifecycle_epoch:1}));
  const content="\u{1F4CA}".repeat(1200),sources=snapshot.map((source,i)=>({...source,citation_id:`S${i+1}`,chunk_id:identity("3",i),filename:`Synthetic ${i}.txt`,
    content,original_content_hash:"a".repeat(64),location:null,page_number:i?null:0,chunk_index:i,excerpt:true}));
  const questions=Array.from({length:13},(_,i)=>`Criterion ${i+1}`),targets=Array.from({length:100},(_,i)=>`Subject ${i+1}`);
  const result=(index:number):ResearchRunResult=>{
    const observations=Array.from({length:12},(_,i)=>({topic:"IDENTITY" as const,summary:`Observation ${i+1}`,limitations:["Independent identity review is required."],
      evidence:sources.slice(i*4,i*4+4).map(source=>({document_id:source.document_id,citation_id:source.citation_id,quote:Array.from(content).slice(0,300).join(""),quote_start:0,quote_end:300})),
      claim_state:"REVIEW_REQUIRED" as const,identity_state:"NOT_RESOLVED" as const,decision_state:"NO_AUTOMATIC_ADVERSE_DECISION" as const}));
    const diligence:ResearchDiligence={schema_version:"research-diligence/1",criterion_index:index,total_documents:60,requested_targets:targets,observations,
      gaps:[{document_id:null,description:"Later amendments have not been established.",state:"FOLLOW_UP_REQUIRED_NOT_ABSENCE_PROOF"}],
      documents:sources.map((source,i)=>({document_id:source.document_id,filename:source.filename,evidence_state:i<48?"OBSERVATION":"NO_OBSERVATION_PROPOSED",
        consulted_sources:[{version_id:source.version_id,chunk_id:source.chunk_id,original_content_hash:source.original_content_hash,page_number:source.page_number,chunk_index:i}]})),
      rejections:[],interpretation:"INDEPENDENT_REVIEW_NO_VERIFIED_IDENTITY_OR_ADVERSE_DECISION",coverage:"BOUNDED_SOURCE_REVIEW_NOT_COMPLETE_DUE_DILIGENCE"};
    return {question:questions[index],answer:"Provisional observations require review.",claim_state:"REVIEW_REQUIRED",abstained:false,sources:sources.slice(0,48),
      validated_citation_ids:sources.slice(0,48).map(source=>source.citation_id),model:null,coverage:{completeness:"NOT_EXHAUSTIVE",chunks_considered:200},
      provider_cost_status:"NOT_CALLED",review_state:"COMPLETION_CRITERIA_NOT_AUTOMATICALLY_VERIFIED",diligence};
  };
  return {id,plan_id:id,workspace_id:id,owner_id:id,schema_version:"research-run/1",persistence_state:"PERSISTED",mode:"DUE_DILIGENCE",
    state:"completed",generation:1,position:13,questions,results:questions.map((_,i)=>result(i)),total_steps:13,entity_scope:targets,
    source_snapshot:snapshot,source_state:"CURRENT",error_code:null,created_at:"2026-10-22T11:00:00Z"};
}
it("confirms the full60source13criterion100subject saved Due Diligence report without reducing evidence limits",()=>{
  expect(confirmedResearchRun(fixture(),id)).toBe(true);
});
it("reads a persisted question using the SQL Unicode character limit rather than UTF16 units",()=>{
  const run=fixture();run.questions[0]="\u{1F4CA}".repeat(10000);run.results[0].question=run.questions[0];
  expect(confirmedResearchRun(run,id)).toBe(true);
  run.questions[0]+="x";run.results[0].question=run.questions[0];
  expect(confirmedResearchRun(run,id)).toBe(false);
});
it("retains exact quotes,qualifications,gaps,review state and all original hashes when copying a saved assessment",()=>{
  const run=fixture(),copy=researchResultsClipboardText(run.results);
  expect(copy).toContain("Later amendments have not been established.");expect(copy).toContain("Independent identity review is required.");
  expect(copy).toContain("NO_AUTOMATIC_ADVERSE_DECISION");expect(copy).toContain("a".repeat(64));
  expect(copy).toContain(JSON.stringify(run.results[12].diligence,null,2));
});
it("ordinary incomplete or inconsistent saved analysis is not displayed as a confirmed result",()=>{
  const run=fixture();run.results[0].diligence!.observations[0].evidence[0].quote="Different wording";
  expect(confirmedResearchRun(run,id)).toBe(false);
});
it("list receipts and unavailable-source records preserve all60snapshot identities without replaying private result bodies",()=>{
  const run=fixture();run.results=[];run.results_included=false;expect(confirmedResearchRun(run,id)).toBe(true);
  run.results_included=undefined;run.source_state="UNAVAILABLE_OR_CHANGED";expect(confirmedResearchRun(run,id)).toBe(true);
});
