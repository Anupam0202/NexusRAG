import test from "node:test";
import assert from "node:assert/strict";
import { contradictionWork,contradictionPrompt,contradictionResult } from "../../apps/gateway/src/research-contradiction.js";

const documents=Array.from({length:50},(_,i)=>({id:`document-${i}`,filename:`Synthetic ${i}.txt`}));
const sources=documents.map((document,i)=>({citation_id:`S${i+1}`,document_id:document.id,version_id:`version-${i}`,chunk_id:`chunk-${i}`,
  content:`\u{1F4CA} Observed 30 days in period ${i}. Later reported 45 days.`,original_content_hash:String(i).padStart(64,"0"),page_number:2,chunk_index:0,location:{page:2}}));
const work={criterion_index:0,total_documents:50,question:"Which reported periods may conflict?"};
const pair=(left="S1",right="S50")=>({left:{citation_id:left,quote:"Observed 30 days in period 0."},
  right:{citation_id:right,quote:"Later reported 45 days."},relationship:"POTENTIAL_CONFLICT",explanation:"Period and entity equivalence still require review."});
const generate=pairs=>({answer:JSON.stringify({pairs})});
test("contradiction scope retains50sources and main question plus10subquestions",()=>{
  const run={source_snapshot:documents.map(d=>({document_id:d.id})),questions:Array(11).fill("Question"),position:10};
  const result=contradictionWork(run);assert.equal(result.snapshot.length,50);assert.equal(result.criterion_index,10);
  for(const invalid of [{...run,source_snapshot:[...run.source_snapshot,{document_id:"51"}]},{...run,questions:Array(12).fill("Question")},{...run,position:11}])
    assert.throws(()=>contradictionWork(invalid),{code:"INVALID_SCOPE"});
  const prompt=contradictionPrompt(work,documents,sources);assert.ok(prompt.includes("document-49"));assert.ok(prompt.includes("requires independent review")||prompt.includes("require independent review"));
});
test("cross-scope pairs retain exact Unicode anchors and stable remapped citations",()=>{
  const result=contradictionResult(work,documents,sources,generate([pair()]));
  assert.equal(result.analysis.documents.length,50);assert.equal(result.analysis.pairs.length,1);
  assert.deepEqual(result.sources.map(s=>s.document_id),["document-0","document-49"]);
  assert.equal(result.analysis.pairs[0].left.quote_start,2);
  assert.equal(result.analysis.pairs[0].right.citation_id,"S2");
  assert.equal(result.analysis.documents[1].evidence_state,"NO_PAIR_PROPOSED");
  assert.equal(result.analysis.documents[49].consulted_sources[0].original_content_hash,sources[49].original_content_hash);
  assert.equal(result.checked.claim_state,"REVIEW_REQUIRED");assert.deepEqual(result.checked.citations,[1,2]);
});
test("same-source nonoverlapping statements remain possible without manufacturing a conflict verdict",()=>{
  const result=contradictionResult(work,documents,sources,generate([{...pair("S1","S1"),relationship:"TEMPORAL_CHANGE"}]));
  assert.equal(result.analysis.pairs.length,1);assert.equal(result.sources.length,1);
  assert.equal(result.analysis.pairs[0].relationship,"TEMPORAL_CHANGE");
  assert.equal(result.analysis.interpretation,"REVIEW_REQUIRED_NO_AUTOMATIC_CONFLICT_VERDICT");
});
test("paraphrased, unknown, overlapping and duplicate anchors remain explicit rejected candidates",()=>{
  const good=pair(),bad={...pair(),left:{citation_id:"S1",quote:"Invented source wording"}};
  const overlap={...pair("S1","S1"),right:{citation_id:"S1",quote:"30 days"}};
  const result=contradictionResult(work,documents,sources,generate([good,bad,overlap,{...pair(),left:good.right,right:good.left}]));
  assert.equal(result.analysis.pairs.length,1);assert.equal(result.analysis.rejected_pairs,3);
});
test("no candidate is honest abstention, not proof that sources agree",()=>{
  const result=contradictionResult(work,documents,[],null);
  assert.equal(result.checked.abstained,true);assert.equal(result.checked.claim_state,"UNSUPPORTED");
  assert.ok(result.checked.answer.includes("does not establish consistency"));
  assert.ok(result.analysis.documents.every(d=>d.evidence_state==="NO_INDEXED_EVIDENCE"));
  assert.deepEqual(result.sources,[]);assert.deepEqual(result.checked.citations,[]);
});
test("incomplete JSON, excess pairs and unbounded interpretations are failures, not empty successful analysis",()=>{
  for(const generated of [{answer:"not JSON"},generate(Array(7).fill(pair())),generate([{...pair(),relationship:"PROVEN_CONTRADICTION"}]),generate([{...pair(),explanation:"x".repeat(241)}])])
    assert.throws(()=>contradictionResult(work,documents,sources,generated),{code:"PROVIDER_INVALID_RESPONSE"});
});
