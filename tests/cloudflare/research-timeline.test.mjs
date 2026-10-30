import test from "node:test";
import assert from "node:assert/strict";
import { timelineDate,timelineResult } from "../../apps/gateway/src/research-timeline.js";
import { sourceBatchWork } from "../../apps/gateway/src/research-comparison.js";
const work={criterion_index:0,batch_index:0,batch_count:1,total_documents:1},documents=[{id:"a",filename:"Synthetic.txt"}];
const text="\u{1F4CA} Issued 2024-02. Effective 2024-02-29. Reviewed 03/04/2024. Open period 2024/2025.";
const sources=[{citation_id:"S1",document_id:"a",content:text}];
const result=events=>timelineResult(work,documents,sources,{answer:JSON.stringify({documents:[{document_id:"a",events}]})});
const event=(quote,date_text,date_role="EVENT")=>({citation_id:"S1",quote,date_text,date_role});
test("timeline retains40sources and9criteria through45bounded batches",()=>{
  const source_snapshot=Array.from({length:40},(_,i)=>({document_id:String(i)})),questions=Array(9).fill("Criterion"),seen=[];
  for(let position=0;position<45;position++){const part=sourceBatchWork({source_snapshot,questions,position});seen.push(...part.snapshot.map(s=>`${part.criterion_index}:${s.document_id}`));}
  assert.equal(new Set(seen).size,360);
  assert.equal(sourceBatchWork({source_snapshot:source_snapshot.slice(0,1),questions:["Question"],position:0}).batch_count,1);
});
test("partial dates preserve their precision and leap-day boundaries",()=>{
  assert.deepEqual(timelineDate("2024-02"),{precision:"MONTH",lower:"2024-02-01T00:00:00.000Z",upper:"2024-02-29T23:59:59.999Z"});
  assert.equal(timelineDate("2024").precision,"YEAR");assert.equal(timelineDate("2024-02-29").precision,"DAY");
  for(const text of ["2023-02-29","2024-02-30","2024-13","0000","9999","2024-01-01T24:00:00Z","2024-01-01T00:00:60Z","2024-01-01T00:00:00+14:30"])
    assert.deepEqual(timelineDate(text),{precision:"UNRESOLVED",lower:null,upper:null});
});
test("explicit timezone instants and intervals use deterministic bounds, not local timezone",()=>{
  assert.deepEqual(timelineDate("2024-02-29T09:30:00+05:30"),{precision:"INSTANT",lower:"2024-02-29T04:00:00.000Z",upper:"2024-02-29T04:00:00.000Z"});
  assert.deepEqual(timelineDate("2024/2025"),{precision:"INTERVAL",lower:"2024-01-01T00:00:00.000Z",upper:"2025-12-31T23:59:59.999Z"});
  for(const text of ["03/04/2024","2024-02-29T09:30:00","next week","2025/2024","0001-01-01T00:00:00+14:00",""])assert.equal(timelineDate(text).precision,"UNRESOLVED");
});
test("events retain literal quotes and Unicode codepoints, sorted by earliest possible date",()=>{
  const timeline=result([event("Effective 2024-02-29.","2024-02-29","EFFECTIVE"),event("Issued 2024-02.","2024-02","PUBLISHED")]);
  assert.deepEqual(timeline.events.map(e=>e.date_role),["PUBLISHED","EFFECTIVE"]);
  assert.equal(timeline.events[0].quote_start,2);
  assert.equal(Array.from(text).slice(timeline.events[0].quote_start,timeline.events[0].quote_end).join(""),"Issued 2024-02.");
  assert.equal(timeline.interpretation,"REVIEW_REQUIRED_BOUNDS_NOT_CAUSAL_ORDER");
});
test("ambiguous and undated source events stay inspectable without inferred chronology",()=>{
  const timeline=result([event("Reviewed 03/04/2024.","03/04/2024"),event("Issued 2024-02.","")]);
  assert.ok(timeline.events.every(e=>e.date.lower===null&&e.date.precision==="UNRESOLVED"));
});
test("missing or unconfirmed quotes become explicit gaps and never invented events",()=>{
  const timeline=result([event("Not in the original 2025.","2025"),{...event("Issued 2024-02.","2024-02"),citation_id:"S2"}]);
  assert.equal(timeline.events.length,0);assert.deepEqual(timeline.gaps[0],{document_id:"a",filename:"Synthetic.txt",reason:"INVALID_SOURCE_ANCHOR",rejected_events:2});
  assert.equal(timelineResult(work,documents,[],null).gaps[0].reason,"NO_INDEXED_EVIDENCE");
  assert.equal(result([]).gaps[0].reason,"NO_RELEVANT_EVENT");
});
test("partial date fragments cannot silently change a full date's precision",()=>{
  for(const quote of ["Effective 2024-02-29.","2024"])assert.equal(result([event(quote,"2024")]).events.length,0);
});
test("incomplete provider objects interrupt instead of becoming successful empty timelines",()=>{
  for(const answer of ["not JSON",'{"documents":[]}',JSON.stringify({documents:[{document_id:"different",events:[]}]})])
    assert.throws(()=>timelineResult(work,documents,sources,{answer}),{code:"PROVIDER_INVALID_RESPONSE"});
  assert.throws(()=>result(Array(3).fill(event("Issued 2024-02.","2024-02"))),{code:"PROVIDER_INVALID_RESPONSE"});
});
