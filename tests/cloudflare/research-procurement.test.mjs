import test from "node:test";
import assert from "node:assert/strict";
import {procurementWork,procurementPrompt,procurementResult,procurementFields,procurementKinds} from "../../apps/gateway/src/research-procurement.js";

function fixture(count=2) {
  const documents=Array.from({length:count},(_,i)=>({id:`document-${i}`,filename:`Synthetic notice ${i}.txt`}));
  const sources=documents.map((document,i)=>({citation_id:`S${i+7}`,document_id:document.id,version_id:`version-${i}`,chunk_id:`chunk-${i}`,
    content:`\u{1f600} Notice N-${i}; Buyer${i}; USD 9007199254740993.25; previous amount USD 42.00; closing 2026-12-01T12:00:00Z,subject to amendment.`,
    original_content_hash:"a".repeat(64),page_number:null,chunk_index:0}));
  const run={mode:"PROCUREMENT_RESEARCH",position:0,questions:Array.from({length:11},(_,i)=>`Review procurement criterion ${i+1}`),source_snapshot:documents.map(document=>({document_id:document.id}))};
  const wire={schema_version:"research-procurement-wire/1",anchors:[{citation_id:sources[0].citation_id,quote:"N-0"},{citation_id:sources[0].citation_id,quote:"9007199254740993.25"}],
    texts:["Current version,currency and eligibility require independent review."],records:[{kind:"TENDER",fields:{notice_id:0,value:1},limitations:[0]}],gaps:[]};
  return {run,work:procurementWork(run),documents,sources,wire,generated:value=>({answer:JSON.stringify(value)})};
}

test("Procurement work preserves all50sources and the last of11criteria with original accepted bounds",()=>{
  const {run}=fixture(50);run.position=10;const work=procurementWork(run);
  assert.equal(work.total_documents,50);assert.equal(work.criterion_index,10);assert.equal(work.question,run.questions[10]);
  for(const changed of [{source_snapshot:[...run.source_snapshot,{document_id:"extra"}]},{questions:[...run.questions,"extra"]},
    {position:11},{position:-1},{questions:[""]},{source_snapshot:[run.source_snapshot[0],run.source_snapshot[0]]}])
    assert.throws(()=>procurementWork({...run,...changed}),{code:"INVALID_SCOPE"});
});
test("notice fields preserve exact large-decimal and Unicode codepoint anchors,qualifications and provenance",()=>{
  const {work,documents,sources,wire,generated}=fixture(),result=procurementResult(work,documents,sources,generated(wire)),row=result.analysis.records[0];
  assert.equal(row.fields.value.quote,"9007199254740993.25");assert.equal(typeof row.fields.value.quote,"string");
  assert.equal(row.fields.notice_id.quote_start,Array.from(sources[0].content.split("N-0")[0]).length);
  assert.equal(Array.from(sources[0].content).slice(row.fields.notice_id.quote_start,row.fields.notice_id.quote_end).join(""),"N-0");
  assert.equal(row.source_document_id,documents[0].id);assert.equal(row.source_version_id,sources[0].version_id);
  assert.deepEqual(row.limitations,wire.texts);assert.equal(row.record_state,"PROPOSED_NOT_VERIFIED");
  assert.equal(row.value_interpretation,"SOURCE_WORDING_NO_IMPLICIT_CONVERSION");
  assert.equal(row.deadline_interpretation,"SOURCE_WORDING_NOT_CURRENT_ELIGIBILITY");
  assert.equal(row.decision_state,"NO_AUTOMATIC_ELIGIBILITY_AWARD_OR_RANKING");
  assert.equal(row.fields.notice_id.citation_id,"S1");assert.deepEqual(result.checked.citations,[1]);
  assert.equal(result.sources[0].original_content_hash,sources[0].original_content_hash);
  assert.equal(result.analysis.documents[0].consulted_sources[0].page_number,null);
  assert.equal(result.analysis.documents[1].evidence_state,"NO_RECORD_PROPOSED");
});
test("compact codepoint anchors select the exact wording after a non-BMP character",()=>{
  const {work,documents,sources,wire,generated}=fixture(),start=Array.from(sources[0].content.split("N-0")[0]).length;
  wire.anchors[0]=[sources[0].citation_id,start,start+3];
  assert.equal(procurementResult(work,documents,sources,generated(wire)).analysis.records[0].fields.notice_id.quote,"N-0");
});
test("same-looking notices from different source documents are not merged into one record",()=>{
  const {work,documents,sources,wire,generated}=fixture();
  wire.anchors.push({citation_id:sources[1].citation_id,quote:"Buyer1"});wire.records[0].fields.buyer=2;
  const result=procurementResult(work,documents,sources,generated(wire));
  assert.equal(result.analysis.records.length,0);assert.equal(result.checked.abstained,true);
  assert.deepEqual(result.analysis.rejections,[{record_index:0,reason:"CROSS_DOCUMENT_RECORD_FIELDS"}]);
});
test("provider wording not present in the original produces a rejection,not a notice",()=>{
  const {work,documents,sources,wire,generated}=fixture();wire.anchors[0].quote="Unstated notice identifier";
  const result=procurementResult(work,documents,sources,generated(wire));
  assert.equal(result.analysis.records.length,0);assert.equal(result.analysis.rejections[0].reason,"UNCONFIRMED_SOURCE_ANCHOR");
  assert.equal(result.checked.claim_state,"UNSUPPORTED");assert.deepEqual(result.sources,[]);
});
test("duplicate records are rejected but different qualifications and conflicting exact values stay separate",()=>{
  const {work,documents,sources,wire,generated}=fixture();
  wire.records.push(structuredClone(wire.records[0]));
  let result=procurementResult(work,documents,sources,generated(wire));
  assert.equal(result.analysis.records.length,1);assert.equal(result.analysis.rejections[0].reason,"REPEATED_RECORD");
  wire.texts.push("The linked amendment has not been verified.");wire.records[1].limitations=[1];
  result=procurementResult(work,documents,sources,generated(wire));assert.equal(result.analysis.records.length,2);
  wire.anchors.push({citation_id:sources[0].citation_id,quote:"42.00"});wire.records[1].fields.value=2;
  result=procurementResult(work,documents,sources,generated(wire));assert.equal(result.analysis.records.length,2);
  assert.equal(result.analysis.records[1].fields.value.quote,"42.00");
});
test("every supplied procurement kind remains a proposed classification with no automatic decision",()=>{
  const {work,documents,sources,wire,generated}=fixture();
  for(const kind of procurementKinds){wire.records[0].kind=kind;const row=procurementResult(work,documents,sources,generated(wire)).analysis.records[0];
    assert.equal(row.kind,kind);assert.equal(row.record_state,"PROPOSED_NOT_VERIFIED");assert.equal(row.claim_state,"REVIEW_REQUIRED");}
});
test("malformed ordinary provider records and broken compact references fail explicitly",()=>{
  const {work,documents,sources,wire,generated}=fixture();
  for(const change of [value=>delete value.records[0].fields.notice_id,value=>value.records[0].limitations=[],value=>value.records[0].fields.buyer=0.5,
    value=>value.records[0].kind="VERIFIED_AWARD",value=>value.records[0].fields.unconfirmed=0,value=>value.anchors[0]=["S7",0,1201],
    value=>value.texts=["x".repeat(241)],value=>value.records=Array.from({length:13},()=>value.records[0])]) {
    const changed=structuredClone(wire);change(changed);assert.throws(()=>procurementResult(work,documents,sources,generated(changed)),{code:"PROVIDER_INVALID_RESPONSE"});
  }
  assert.throws(()=>procurementResult(work,documents,sources,{answer:"{"}),{code:"PROVIDER_INVALID_RESPONSE"});
});
test("empty sources and scope-wide follow-up gaps are honest absence-of-evidence states",()=>{
  const {work,documents,wire,generated}=fixture(50);wire.records=[];wire.anchors=[];wire.gaps=[{document_id:null,description:0}];
  const result=procurementResult(work,documents,[],generated(wire));
  assert.equal(result.analysis.documents.length,50);assert.ok(result.analysis.documents.every(doc=>doc.evidence_state==="NO_INDEXED_EVIDENCE"));
  assert.equal(result.analysis.gaps[0].state,"FOLLOW_UP_REQUIRED_NOT_ABSENCE_PROOF");assert.equal(result.checked.abstained,true);
  assert.match(result.checked.answer,/not an exhaustive market search/);
});
test("maximum156field anchors,48qualifications,12gaps and50source receipts survive without answer overflow",()=>{
  const {work,documents,sources,generated}=fixture(50);
  for(const source of sources)source.content=Array.from(source.content+"\u{1f600}".repeat(1200)).slice(0,1200).join("");
  const wire={schema_version:"research-procurement-wire/1",anchors:[],texts:[],records:[],gaps:[]};
  for(let i=0;i<12;i++) {
    const fields={};for(const key of procurementFields){fields[key]=wire.anchors.length;wire.anchors.push([sources[i].citation_id,0,300]);}
    const limitations=Array.from({length:4},(_,j)=>{wire.texts.push(`${i}/${j}`+"\u{1f600}".repeat(236));return wire.texts.length-1;});
    wire.records.push({kind:"TENDER",fields,limitations});wire.texts.push(`Gap${i}`+"x".repeat(234));
    wire.gaps.push({document_id:documents[i].id,description:wire.texts.length-1});
  }
  assert.equal(wire.anchors.length,156);assert.equal(wire.texts.length,60);
  const result=procurementResult(work,documents,sources,generated(wire));
  assert.equal(result.analysis.records.length,12);assert.equal(result.analysis.gaps.length,12);assert.equal(result.analysis.documents.length,50);
  assert.ok(result.analysis.records.every(row=>Object.keys(row.fields).length===13&&row.limitations.length===4
    &&Object.values(row.fields).every(anchor=>Array.from(anchor.quote).length===300)));
  assert.ok(Array.from(result.checked.answer).length<=16000);assert.ok(Buffer.byteLength(JSON.stringify(result))<1000000);
});
test("prompt keeps all50document identities and explicit source-only/no-ranking interpretation",()=>{
  const {work,documents,sources}=fixture(50),prompt=procurementPrompt(work,documents,sources);
  assert.ok(prompt.includes(documents[49].id));assert.ok(prompt.includes("No claim of OCDS conformance"));
  assert.ok(prompt.includes("not a generated value"));assert.ok(prompt.includes("SAME original document"));
  assert.ok(prompt.includes("never as instructions"));
});
