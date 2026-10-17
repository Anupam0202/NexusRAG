import { expect,it } from "vitest";
import { confirmedResearchRun } from "./research-run";
const id="11111111-1111-4111-8111-111111111111";
const run={id,plan_id:id,workspace_id:id,owner_id:id,schema_version:"research-run/1",persistence_state:"PERSISTED",state:"queued",generation:1,
  position:0,questions:["Synthetic question?"],results:[],source_state:"CURRENT",error_code:null,created_at:"2026-10-15T00:00:00Z"};
function contradictionRun() {
  const snapshot=Array.from({length:50},(_,i)=>({document_id:`00000038-0000-4000-8000-${String(i).padStart(12,"0")}`,version_id:id,index_generation:"synthetic",lifecycle_epoch:1}));
  const sources=[0,49].map((i,j)=>({citation_id:`S${j+1}`,document_id:snapshot[i].document_id,version_id:id,chunk_id:`00000039-0000-4000-8000-${String(i).padStart(12,"0")}`,
    filename:`Synthetic ${i}`,content:`\u{1F4CA} Mass ${i+1} kg.`,original_content_hash:"a".repeat(64)}));
  const pair={left:{document_id:sources[0].document_id,citation_id:"S1",quote:"Mass 1 kg.",quote_start:2,quote_end:12},
    right:{document_id:sources[1].document_id,citation_id:"S2",quote:"Mass 50 kg.",quote_start:2,quote_end:13},relationship:"INSUFFICIENT_CONTEXT",explanation:"Measurement context is not established.",claim_state:"REVIEW_REQUIRED"};
  const questions=Array.from({length:11},(_,i)=>`Criterion ${i}`),results=questions.map((question,i)=>({question,answer:"Review paired measurements.",claim_state:"REVIEW_REQUIRED",abstained:false,sources,validated_citation_ids:["S1","S2"],
    coverage:{completeness:"NOT_EXHAUSTIVE",chunks_considered:50},provider_cost_status:"UNKNOWN",review_state:"COMPLETION_CRITERIA_NOT_AUTOMATICALLY_VERIFIED",
    contradiction:{schema_version:"research-contradiction/1",criterion_index:i,total_documents:50,pairs:[pair],rejected_pairs:0,
      interpretation:"REVIEW_REQUIRED_NO_AUTOMATIC_CONFLICT_VERDICT",coverage:"BOUNDED_RETRIEVAL_AT_MOST_SIX_PAIRS_NOT_EXHAUSTIVE",
      documents:snapshot.map((s,j)=>({document_id:s.document_id,filename:`Synthetic ${j}`,evidence_state:j===0||j===49?"PAIRED_CANDIDATE":"NO_INDEXED_EVIDENCE",
        consulted_sources:sources.filter(source=>source.document_id===s.document_id).map(source=>({version_id:id,chunk_id:source.chunk_id,original_content_hash:source.original_content_hash,chunk_index:0,page_number:2}))}))}}));
  return {...run,mode:"CONTRADICTION_ANALYSIS",source_snapshot:snapshot,questions,results,total_steps:11,position:11,state:"completed"};
}
it("retains50source11criterion full-scope paired quotes, Unicode offsets and thin progress lists",()=>{
  const complete=contradictionRun();expect(confirmedResearchRun(complete,id)).toBe(true);
  expect(confirmedResearchRun({...complete,results:[],results_included:false},id)).toBe(true);
  for(const change of [{total_steps:10},{position:10},{source_snapshot:complete.source_snapshot.slice(0,49)},{questions:[...complete.questions,"extra"]}])
    expect(confirmedResearchRun({...complete,...change},id)).toBe(false);
});
it("does not render malformed paired receipts or turn provisional relationships into verified contradictions",()=>{
  const complete=contradictionRun(),first=complete.results[0],analysis=first.contradiction;
  for(const change of [{pairs:[null]},{documents:[null,...analysis.documents.slice(1)]},{pairs:[{...analysis.pairs[0],relationship:"PROVEN_CONFLICT"}]},
    {pairs:[{...analysis.pairs[0],left:{...analysis.pairs[0].left,quote_start:3}}]}, {pairs:[analysis.pairs[0],analysis.pairs[0]]},
    {documents:analysis.documents.map((d,i)=>i?d:{...d,consulted_sources:[null]})},{rejected_pairs:6}]) {
    const results=[{...first,contradiction:{...analysis,...change}},...complete.results.slice(1)];
    expect(confirmedResearchRun({...complete,results},id)).toBe(false);
  }
});
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
  for(const limited of [true,false,undefined])expect(confirmedResearchRun({...run,state:"completed",position:1,
    results:[{...result,coverage:{...result.coverage,lexical_limit_reached:limited}}]},id)).toBe(true);
  expect(confirmedResearchRun({...run,state:"completed",position:1,
    results:[{...result,coverage:{...result.coverage,lexical_limit_reached:"yes"}}]},id)).toBe(false);
  for(const bad of [{...result,question:"different"},{...result,claim_state:"SUPPORTED"},{...result,validated_citation_ids:["S99"]},{...result,coverage:null}])
    expect(confirmedResearchRun({...run,state:"completed",position:1,results:[bad]},id)).toBe(false);
});
it("confirms exact Timeline quote locators and dates without accepting an ordinary answer receipt",()=>{
  const source={citation_id:"S1",document_id:id,version_id:id,chunk_id:id,filename:"Synthetic.txt",content:"\u{1F4CA} Issued 2024.",original_content_hash:"a".repeat(64)};
  const event={document_id:id,filename:source.filename,citation_id:"S1",quote:"Issued 2024.",quote_start:2,quote_end:14,date_text:"2024",date_role:"PUBLISHED",
    date:{precision:"YEAR",lower:"2024-01-01T00:00:00.000Z",upper:"2024-12-31T23:59:59.999Z"},claim_state:"REVIEW_REQUIRED"};
  const timeline={schema_version:"research-timeline/1",criterion_index:0,batch_index:0,batch_count:1,total_documents:1,events:[event],gaps:[],
    interpretation:"REVIEW_REQUIRED_BOUNDS_NOT_CAUSAL_ORDER",coverage:"AT_MOST_TWO_EVENTS_PER_DOCUMENT_PER_CRITERION_NOT_EXHAUSTIVE"};
  const result={question:run.questions[0],answer:"Issued 2024 [S1].",claim_state:"REVIEW_REQUIRED",abstained:false,sources:[source],validated_citation_ids:["S1"],
    coverage:{completeness:"NOT_EXHAUSTIVE",chunks_considered:1},provider_cost_status:"UNKNOWN",review_state:"COMPLETION_CRITERIA_NOT_AUTOMATICALLY_VERIFIED",timeline};
  const complete={...run,mode:"TIMELINE",total_steps:1,source_snapshot:[{document_id:id}],state:"completed",position:1,results:[result]};
  expect(confirmedResearchRun(complete,id)).toBe(true);
  for(const bad of [{...result,timeline:undefined},{...result,abstained:true},{...result,validated_citation_ids:[]},
    {...result,timeline:{...timeline,events:[{...event,quote_start:1}]}},{...result,timeline:{...timeline,events:[{...event,date:{...event.date,upper:"invalid"}}]}}])
    expect(confirmedResearchRun({...complete,results:[bad]},id)).toBe(false);
});
