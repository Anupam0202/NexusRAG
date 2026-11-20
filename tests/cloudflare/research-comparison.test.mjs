import test from "node:test";
import assert from "node:assert/strict";
import { comparisonWork, comparisonResult } from "../../apps/gateway/src/research-comparison.js";

const snapshot=Array.from({length:40},(_,i)=>({document_id:`source-${i}`}));
test("all40documents and9criteria are retained across45comparison batches",()=>{
  const run={source_snapshot:snapshot,questions:Array.from({length:9},(_,i)=>`Criterion${i}`)};
  const covered=[];
  for(let position=0;position<45;position++) {
    const work=comparisonWork({...run,position});
    assert.equal(work.criterion_index,Math.floor(position/5));assert.equal(work.batch_index,position%5);
    assert.equal(work.snapshot.length,8);assert.equal(work.question,run.questions[work.criterion_index]);
    covered.push(...work.snapshot.map(s=>`${work.criterion_index}:${s.document_id}`));
  }
  assert.equal(new Set(covered).size,360);
});
test("a final one-document batch does not drop a ninth source",()=>{
  const work=comparisonWork({source_snapshot:snapshot.slice(0,9),questions:["Criterion"],position:1});
  assert.deepEqual(work.snapshot,[snapshot[8]]);assert.equal(work.total_documents,9);
});
test("missing evidence remains an explicit per-document gap without fabricated answers",()=>{
  const work={criterion_index:0,batch_index:0,batch_count:1,total_documents:2};
  const result=comparisonResult(work,[{id:"a",filename:"A"},{id:"b",filename:"B"}],[],null);
  assert.ok(result.cells.every(c=>c.abstained&&c.gap==="NO_INDEXED_EVIDENCE"&&c.validated_citation_ids.length===0));
});
test("a model citation from a different column cannot establish that cell's evidence",()=>{
  const work={criterion_index:0,batch_index:0,batch_count:1,total_documents:2};
  const result=comparisonResult(work,[{id:"a",filename:"A"},{id:"b",filename:"B"}],
    [{citation_id:"S1",document_id:"a",content:"30 days"},{citation_id:"S2",document_id:"b",content:"60 days"}],
    {answer:JSON.stringify({cells:[{document_id:"a",answer:"30 days [S1]"},{document_id:"b",answer:"30 days [S1]"}]})});
  assert.equal(result.cells[0].claim_state,"REVIEW_REQUIRED");assert.equal(result.cells[1].claim_state,"UNSUPPORTED");
  assert.equal(result.cells[1].gap,"INSUFFICIENT_OR_INVALIDLY_CITED");
});
test("incomplete or misaligned model matrices interrupt rather than become empty success",()=>{
  const work={criterion_index:0,batch_index:0,batch_count:1,total_documents:2};
  for(const answer of ["not JSON",'{"cells":[]}',JSON.stringify({cells:[{document_id:"b",answer:"x"},{document_id:"a",answer:"y"}]})])
    assert.throws(()=>comparisonResult(work,[{id:"a",filename:"A"},{id:"b",filename:"B"}],[],{answer}),{code:"PROVIDER_INVALID_RESPONSE"});
});
