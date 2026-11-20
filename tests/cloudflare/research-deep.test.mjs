import test from "node:test";
import assert from "node:assert/strict";
import { deepWork,deepSources,deepPrompt,deepResult } from "../../apps/gateway/src/research-deep.js";

const document=index=>`00000041-0000-4000-8000-${String(index).padStart(12,"0")}`;
const snapshot=Array.from({length:60},(_,index)=>({document_id:document(index),version_id:document(index+100),index_generation:"synthetic",lifecycle_epoch:1}));
const questions=[...Array.from({length:12},(_,index)=>`Subquestion ${index+1}`),"Synthesize all findings"];
const run={mode:"DEEP_RESEARCH",source_snapshot:snapshot,questions,position:0,results:[]};
const source=index=>({citation_id:"S1",document_id:snapshot[index%60].document_id,version_id:snapshot[index%60].version_id,
  chunk_id:document(index+1000),original_content_hash:"a".repeat(64),content:`Original source ${index}.`,filename:`Synthetic ${index%60}`,chunk_index:index,page_number:1});
const documents=snapshot.map((item,index)=>({id:item.document_id,filename:`Synthetic ${index}`}));
const generated=answer=>({answer:JSON.stringify({answer,limitations:["Independent review is required."],gaps:[]})});
const prior=Array.from({length:12},(_,index)=>({question:questions[index],answer:`Finding ${index} [S1].`,
  sources:[source(index)],claim_state:"REVIEW_REQUIRED",abstained:false,deep:{limitations:["Bounded evidence."],gaps:[]}}));

test("Deep Research retains all60sources/12subquestions plus a distinct final synthesis",()=>{
  const first=deepWork(run);assert.equal(first.snapshot.length,60);assert.equal(first.phase,"SUBQUESTION");assert.equal(first.question_count,13);
  const last=deepWork({...run,position:12,results:prior});assert.equal(last.phase,"SYNTHESIS");assert.equal(last.question,questions[12]);
  assert.equal(last.prior_results.length,12);
  const single=deepWork({...run,questions:[questions[12]]});assert.equal(single.phase,"SYNTHESIS");
});

test("unconfirmed progress or widened scope is not a completed Deep Research step",()=>{
  for(const change of [{mode:"EVIDENCE_ANSWER"},{source_snapshot:[]},{source_snapshot:[...snapshot,snapshot[0]]},
    {position:13},{position:-1},{position:1},{questions:[...questions,"extra"]},{questions:[""]},{results:prior}])
    assert.throws(()=>deepWork({...run,...change}),{code:"INVALID_SCOPE"});
});

test("synthesis preserves up156original contexts and deduplicates unchanged originals",()=>{
  const current=Array.from({length:12},(_,index)=>source(index+144)),previous=Array.from({length:144},(_,index)=>source(index));
  const all=deepSources(current,previous);assert.equal(all.length,156);assert.equal(all.at(-1).citation_id,"S156");
  assert.equal(deepSources([source(0)],[source(0)]).length,1);
  assert.throws(()=>deepSources(current,[...previous,source(144)]),{code:"INVALID_SCOPE"});
  assert.throws(()=>deepSources([source(0)],[{...source(0),original_content_hash:"b".repeat(64)}]),{code:"SOURCE_UNAVAILABLE"});
  assert.throws(()=>deepSources([{...source(0),content:""}]),{code:"SOURCE_UNAVAILABLE"});
});

test("final synthesis remaps every previous citation to actual rehydrated originals rather than citing generated notes",()=>{
  const work=deepWork({...run,position:12,results:prior}),sources=deepSources([],prior.map(result=>result.sources[0]));
  const prompt=deepPrompt(work,sources);
  assert.match(prompt,/DEEP_RESEARCH_SYNTHESIS/);assert.match(prompt,/PREVIOUS_ANALYSES_NOT_EVIDENCE/);
  const notes=JSON.parse(prompt.split("PREVIOUS_ANALYSES_NOT_EVIDENCE:\n")[1].split("\nEVIDENCE:\n")[0]);
  assert.equal(notes.length,12);assert.equal(notes[11].answer,"Finding 11 [S12].");
  assert.throws(()=>deepPrompt(work,sources.slice(0,11)),{code:"SOURCE_UNAVAILABLE"});
  const questionPrompt=deepPrompt(deepWork(run),sources.slice(0,12));
  assert.equal(JSON.parse(questionPrompt.split("PREVIOUS_ANALYSES_NOT_EVIDENCE:\n")[1].split("\nEVIDENCE:\n")[0]).length,0);
});

test("all60documents retain explicit bounded candidate/context/citation/empty coverage without invented support",()=>{
  const work=deepWork(run),sources=deepSources([source(0),source(1)]),consulted=[source(0),source(1),source(2),source(2)];
  const {analysis,checked}=deepResult(work,documents,sources,consulted,generated("The first source says this [S1]."));
  assert.equal(analysis.documents.length,60);assert.equal(checked.claim_state,"REVIEW_REQUIRED");
  assert.deepEqual(analysis.documents.slice(0,4).map(document=>document.evidence_state),["CITED","IN_CONTEXT","CANDIDATES_ONLY","NO_INDEXED_EVIDENCE"]);
  assert.equal(analysis.documents[2].consulted_sources.length,1);
  assert.equal(analysis.interpretation,"REVIEW_REQUIRED_CITATIONS_NOT_ENTAILMENT");assert.deepEqual(analysis.prior_results,[]);
});

test("uncited or nonexistent citations abstain; a missing original does not become generated evidence",()=>{
  const work=deepWork(run),sources=deepSources([source(0)]);
  for(const answer of ["An uncited assertion.","An invented source [S99]."]) {
    const result=deepResult(work,documents,sources,sources,generated(answer));
    assert.equal(result.checked.abstained,true);assert.equal(result.analysis.documents[0].evidence_state,"IN_CONTEXT");
    assert.deepEqual(result.analysis.gaps,["NO_CITABLE_ANSWER"]);
  }
  const empty=deepResult(work,documents,[],[],null);assert.equal(empty.checked.abstained,true);
  assert.equal(empty.analysis.documents.every(document=>document.evidence_state==="NO_INDEXED_EVIDENCE"),true);
});

test("incomplete or excessive provider report fields fail without fabricated completion",()=>{
  const work=deepWork(run),sources=deepSources([source(0)]);
  for(const answer of ["not json","null",JSON.stringify({answer:"Cited [S1].",limitations:[],gaps:null}),
    JSON.stringify({answer:"Cited [S1].",limitations:Array(9).fill("Too many"),gaps:[]}),
    JSON.stringify({answer:"Cited [S1].",limitations:["x".repeat(501)],gaps:[]})])
    assert.throws(()=>deepResult(work,documents,sources,sources,{answer}),{code:"PROVIDER_INVALID_RESPONSE"});
});

test("a final synthesis preserves all12prior outcomes, including unsupported subquestions",()=>{
  const earlier=prior.map((result,index)=>index===11?{...result,answer:"Evidence gap",sources:[],claim_state:"UNSUPPORTED",abstained:true}:result);
  const work=deepWork({...run,position:12,results:earlier}),sources=deepSources([],earlier.flatMap(result=>result.sources));
  const result=deepResult(work,documents,sources,sources,generated("Evidence for the main question [S1]."));
  assert.equal(result.analysis.prior_results.length,12);assert.equal(result.analysis.prior_results[11].abstained,true);
  assert.equal(result.analysis.prior_results[11].claim_state,"UNSUPPORTED");
  assert.equal(result.analysis.phase,"SYNTHESIS");
});
