import test from "node:test";
import assert from "node:assert/strict";
import {confirmedRun} from "../../apps/gateway/src/research-runs.js";
import {diligenceWork,diligencePrompt,diligenceResult} from "../../apps/gateway/src/research-diligence.js";
import {queryVariantPrompt} from "../../apps/gateway/src/research-query-retrieval.js";
import {validateResearchPlan} from "../../apps/gateway/src/research-plans.js";

const id="11111111-1111-4111-8111-111111111111";
const source_snapshot=Array.from({length:60},(_,i)=>({document_id:`10000000-0000-4000-8000-${String(i+1).padStart(12,"0")}`,
  version_id:`20000000-0000-4000-8000-${String(i+1).padStart(12,"0")}`,index_generation:"generation-1",lifecycle_epoch:1}));
test("a saved Due Diligence receipt preserves its accepted60sources and13criteria",()=>{
  const row={id,plan_id:id,workspace_id:id,owner_id:id,mode:"DUE_DILIGENCE",state:"queued",schema_version:"research-run/1",
    persistence_state:"PERSISTED",generation:1,position:0,questions:Array.from({length:13},(_,i)=>`Criterion ${i+1}`),
    source_snapshot,entity_scope:["Example Components"],total_steps:13,results:[],results_included:false,source_state:"CURRENT"};
  assert.equal(confirmedRun(row,{workspace:id,user:{id}},id),true);
});
test("a valid SQL-sized Unicode question remains plannable and its saved receipt remains readable",()=>{
  const question="\u{1F4CA}".repeat(10000);
  const input={plan_id:id,mode:"DUE_DILIGENCE",question,completion_criteria:["Inspect the supplied source."]};
  assert.equal(validateResearchPlan(input).plan.question,question);
  assert.throws(()=>validateResearchPlan({...input,question:question+"x"}),{code:"INVALID_RESEARCH_PLAN"});
  const row={id,plan_id:id,workspace_id:id,owner_id:id,mode:"DUE_DILIGENCE",state:"queued",schema_version:"research-run/1",
    persistence_state:"PERSISTED",generation:1,position:0,questions:[question],source_snapshot,entity_scope:[],
    total_steps:1,results:[],results_included:false,source_state:"CURRENT"};
  assert.equal(confirmedRun(row,{workspace:id,user:{id}},id),true);
  assert.equal(confirmedRun({...row,questions:[question+"x"]},{workspace:id,user:{id}},id),false);
});

function fixture(count=2) {
  const documents=Array.from({length:count},(_,i)=>({id:`doc-${i}`,filename:`Synthetic filing ${i}.txt`}));
  const sources=documents.map((document,i)=>({citation_id:`S${i+7}`,document_id:document.id,version_id:`version-${i}`,chunk_id:`chunk-${i}`,
    filename:document.filename,content:"\u{1F4CA} Example Components reports EX-17, not a verified identity or complete current ownership record.",
    original_content_hash:"a".repeat(64),page_number:i?null:0,chunk_index:i}));
  const run={mode:"DUE_DILIGENCE",questions:Array.from({length:13},(_,i)=>`Criterion ${i}`),position:12,
    source_snapshot:documents.map(document=>({document_id:document.id})),entity_scope:["Example Components"]};
  const work=diligenceWork(run),wire={schema_version:"research-diligence-wire/1",anchors:[["S7",2,20]],
    texts:["The source identifies a subject for follow-up.","The name alone does not verify identity.","Current ownership remains unresolved."],
    observations:[{topic:"IDENTITY",summary:0,evidence:[0],limitations:[1]}],gaps:[{document_id:null,description:2}]};
  const generated=value=>({answer:JSON.stringify(value)});
  return {documents,sources,run,work,wire,generated};
}
test("Due Diligence retains60sources,13criteria and all100requested subjects",()=>{
  const {run}=fixture(60),work=diligenceWork({...run,entity_scope:Array.from({length:100},(_,i)=>`Subject ${i}`)});
  assert.equal(work.total_documents,60);assert.equal(work.criterion_index,12);assert.equal(work.targets.length,100);
  assert.throws(()=>diligenceWork({...run,source_snapshot:[...run.source_snapshot,{document_id:"extra"}]}),{code:"INVALID_SCOPE"});
  assert.throws(()=>diligenceWork({...run,questions:[...run.questions,"extra"]}),{code:"INVALID_SCOPE"});
});
test("Unicode exact evidence, explicit qualifications, gaps and null page metadata remain independently reviewable",()=>{
  const {work,documents,sources,wire,generated}=fixture(),result=diligenceResult(work,documents,sources,generated(wire));
  assert.equal(result.analysis.observations[0].evidence[0].quote,"Example Components");
  assert.equal(result.analysis.observations[0].evidence[0].quote_start,2);
  assert.equal(result.analysis.observations[0].evidence[0].citation_id,"S1");assert.equal(result.checked.claim_state,"REVIEW_REQUIRED");
  assert.equal(result.analysis.observations[0].identity_state,"NOT_RESOLVED");
  assert.equal(result.analysis.observations[0].decision_state,"NO_AUTOMATIC_ADVERSE_DECISION");
  assert.equal(result.analysis.gaps[0].state,"FOLLOW_UP_REQUIRED_NOT_ABSENCE_PROOF");
  assert.equal(result.analysis.documents[1].consulted_sources[0].page_number,null);assert.equal(result.sources[0].page_number,0);
});
test("shared compact anchors are renumbered once across observations rather than corrupted on reuse",()=>{
  const {work,documents,sources,wire,generated}=fixture();
  wire.observations.push({...wire.observations[0],topic:"FILINGS"});
  const result=diligenceResult(work,documents,sources,generated(wire));
  assert.equal(result.analysis.observations.length,2);
  assert.deepEqual(result.analysis.observations.map(row=>row.evidence[0].citation_id),["S1","S1"]);
  assert.equal(result.sources.length,1);
});
test("potential discrepancies require two distinct source anchors and do not become verified conflicts",()=>{
  const {work,documents,sources,wire,generated}=fixture();wire.observations[0].topic="SOURCE_DISCREPANCY";
  assert.throws(()=>diligenceResult(work,documents,sources,generated(wire)),{code:"PROVIDER_INVALID_RESPONSE"});
  wire.anchors.push(["S8",2,20]);wire.observations[0].evidence.push(1);
  const result=diligenceResult(work,documents,sources,generated(wire));
  assert.equal(result.analysis.observations[0].claim_state,"REVIEW_REQUIRED");assert.equal(result.sources.length,2);
});
test("ordinary unmatched quotes and repeated observations remain explicit omissions rather than invented evidence",()=>{
  const {work,documents,sources,wire,generated}=fixture();wire.anchors=[{citation_id:"S7",quote:"Absent subject"}];
  let result=diligenceResult(work,documents,sources,generated(wire));
  assert.equal(result.analysis.rejections[0].reason,"UNCONFIRMED_SOURCE_ANCHOR");assert.equal(result.checked.abstained,true);
  wire.anchors=[["S7",2,20]];wire.observations.push({...wire.observations[0]});
  result=diligenceResult(work,documents,sources,generated(wire));assert.equal(result.analysis.observations.length,1);
  assert.equal(result.analysis.rejections[0].reason,"REPEATED_OBSERVATION");
});
test("empty output is honest bounded abstention and every selected source retains a consultation receipt",()=>{
  const {work,documents,sources,wire,generated}=fixture(60);wire.observations=[];
  const result=diligenceResult(work,documents,sources,generated(wire));
  assert.equal(result.analysis.documents.length,60);assert.equal(result.checked.abstained,true);
  assert.match(result.checked.answer,/not a complete background check/);assert.equal(result.sources.length,0);
  assert.equal(result.analysis.documents[59].consulted_sources.length,1);
});
test("malformed provider output and missing qualifications fail without a misleading finished report",()=>{
  const {work,documents,sources,wire,generated}=fixture();
  assert.throws(()=>diligenceResult(work,documents,sources,{answer:'{"observations":['}),{code:"PROVIDER_INVALID_RESPONSE"});
  wire.observations[0].limitations=[];
  assert.throws(()=>diligenceResult(work,documents,sources,generated(wire)),{code:"PROVIDER_INVALID_RESPONSE"});
});
test("the review prompt keeps actual full source/subject scope and explicit identity and adverse-decision limitations",()=>{
  const {work,documents,sources}=fixture(60),prompt=diligencePrompt(work,documents,sources);
  assert.match(prompt,/NOT_VERIFIED_IDENTITIES/);assert.match(prompt,/Do not drop qualifiers/);
  assert.equal(JSON.parse(prompt.split("\nEVIDENCE:\n")[1]).length,60);
  assert.ok(prompt.includes(JSON.stringify(work.targets)));assert.match(prompt,/risk scores/);
});
test("Due Diligence query expansion retains all saved subjects as unverified retrieval context",()=>{
  const targets=Array.from({length:100},(_,i)=>`Subject ${i+1}`),prompt=queryVariantPrompt("Review the synthetic records.","DUE_DILIGENCE",targets);
  assert.ok(prompt.includes(JSON.stringify(targets)));assert.match(prompt,/NOT_VERIFIED_IDENTITIES/);
});
