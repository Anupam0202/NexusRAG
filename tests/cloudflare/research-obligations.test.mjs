import test from "node:test";
import assert from "node:assert/strict";
import { obligationWork,obligationPrompt,obligationResult } from "../../apps/gateway/src/research-obligations.js";
import {obligationCapacity,obligationWire} from "../fixtures/research-obligation-capacity.mjs";

const documents=Array.from({length:50},(_,i)=>({id:`document-${i}`,filename:`Synthetic duty ${i}.txt`}));
const sources=documents.map((document,i)=>({citation_id:`S${i+1}`,document_id:document.id,version_id:`version-${i}`,chunk_id:`chunk-${i}`,
  content:`\u{1f4ca} Synthetic Board. Operators must retain reports for 30 days, except public summaries. Applies to Region ${i}. Effective 2026-01-01. Replaces section 2.`,
  original_content_hash:String(i).padStart(64,"0"),page_number:i===0?null:i===1?0:2,chunk_index:0,location:{section:"3"}}));
const run={mode:"OBLIGATION_ANALYSIS",source_snapshot:documents.map(d=>({document_id:d.id})),questions:Array(11).fill("Which duties need review?"),position:10};
const work=obligationWork(run);
const quoted=(quote,citation_id="S1")=>({citation_id,quote});
const candidate=()=>({provision:quoted("Operators must retain reports for 30 days, except public summaries."),authority:quoted("Synthetic Board."),
  jurisdiction:quoted("Region 0"),actor:quoted("Operators"),action:quoted("retain reports"),applicability:null,deadline:quoted("30 days"),
  valid_from:quoted("2026-01-01"),valid_to:null,definitions:[],exceptions:[quoted("except public summaries")],amendments:[],supersedes:[quoted("Replaces section 2.")],
  control_candidate:"Proposed report-retention review; confirm exceptions and legal effect.",limitations:["No independent applicability determination."]});
const generated=candidates=>({answer:JSON.stringify({candidates})});

test("compact wire preserves all12 maximum-field candidates,50sources and Unicode literal anchors without expanding the provider budget",()=>{
  const fixture=obligationCapacity(),work=obligationWork(fixture.run),wire=obligationWire(fixture.candidates,fixture.sources);
  const expected=obligationResult(work,fixture.documents,fixture.sources,generated(fixture.candidates));
  const actual=obligationResult(work,fixture.documents,fixture.sources,{answer:JSON.stringify(wire)});
  assert.deepEqual(actual,expected);assert.equal(actual.sources.length,50);assert.equal(actual.analysis.candidates.length,12);
  assert.ok(Buffer.byteLength(JSON.stringify(wire))<16000);
});

test("compact source spans retain the requested repeated occurrence and count astral text as codepoints",()=>{
  const input=[{...sources[0],content:"\u{1f4ca} Operators retain reports. Operators retain reports."},...sources.slice(1)];
  const value=obligationWire([candidate()],sources),quote="Operators retain reports.",start=28;
  value.anchors=[["S1",start,start+Array.from(quote).length]];
  value.candidates=[{provision:0,authority:null,jurisdiction:null,actor:null,action:0,applicability:null,deadline:null,valid_from:null,valid_to:null,
    definitions:[],exceptions:[],amendments:[],supersedes:[],control_candidate:0,limitations:[1]}];
  const row=obligationResult(work,documents,input,{answer:JSON.stringify(value)}).analysis.candidates[0];
  assert.equal(row.provision.quote,quote);assert.equal(row.provision.quote_start,start);assert.equal(row.provision.quote_end,53);
});

test("compact quoted-anchor fallback preserves literal qualifiers and rejects a whole candidate with an unanchored exception",()=>{
  const wire=obligationWire([candidate()],sources);
  wire.anchors=wire.anchors.map(([citation_id,start,end])=>({citation_id,quote:Array.from(sources.find(source=>source.citation_id===citation_id).content).slice(start,end).join("")}));
  assert.deepEqual(obligationResult(work,documents,sources,{answer:JSON.stringify(wire)}),obligationResult(work,documents,sources,generated([candidate()])));
  wire.anchors[wire.candidates[0].exceptions[0]].quote="not present in this evidence";
  const result=obligationResult(work,documents,sources,{answer:JSON.stringify(wire)});
  assert.equal(result.analysis.candidates.length,0);assert.deepEqual(result.analysis.rejections,[{candidate_index:0,reason:"INVALID_SOURCE_ANCHOR"}]);
});

test("incomplete compact dictionaries or references cannot become empty successful analysis",()=>{
  const changes=[wire=>wire.schema_version="unknown",wire=>delete wire.anchors,wire=>wire.anchors=Array(301).fill(["S1",0,1]),
    wire=>wire.texts=Array(61).fill("a"),wire=>wire.texts=["a".repeat(241)],wire=>wire.anchors[0]=["S1",0,1201],
    wire=>wire.anchors[0]=["S1",0,301],wire=>wire.anchors[0]=["S1",-1,2],wire=>wire.anchors[0]=["S1",1,1],
    wire=>wire.anchors[0]=["S1",0.5,2],wire=>wire.anchors[0]=["missing",0,2],wire=>wire.anchors[0]=["S1",0,1,2],
    wire=>wire.candidates[0].provision=300,wire=>wire.candidates[0].action=null,wire=>wire.candidates[0].control_candidate=-1,
    wire=>wire.candidates[0].limitations=[true],wire=>delete wire.candidates[0].actor,wire=>wire.candidates[0].exceptions=[0,0,0,0,0]];
  for(const change of changes){const wire=obligationWire([candidate()],sources);change(wire);
    assert.throws(()=>obligationResult(work,documents,sources,{answer:JSON.stringify(wire)}),{code:"PROVIDER_INVALID_RESPONSE"});}
  assert.equal(obligationResult(work,documents,sources,{answer:JSON.stringify({schema_version:"research-obligation-wire/1",anchors:[],texts:[],candidates:[]})}).checked.abstained,true);
});

test("obligation work retains all50sources,11questions and8variant420second adopted bounds",()=>{
  assert.equal(work.snapshot.length,50);assert.equal(work.criterion_index,10);
  for(const value of [{...run,mode:"COMPARE"},{...run,source_snapshot:[...run.source_snapshot,{document_id:"51"}]},
    {...run,questions:Array(12).fill("q")},{...run,position:11},{...run,source_snapshot:[run.source_snapshot[0],run.source_snapshot[0]]}])
    assert.throws(()=>obligationWork(value),{code:"INVALID_SCOPE"});
  const prompt=obligationPrompt(work,documents,sources);
  assert.ok(prompt.includes('"document_id":"document-49"'));assert.ok(prompt.includes("Do not decide applicability, compliance, certification or legal effect"));
});
test("candidate retains exact Unicode provisions, exceptions, deadline and temporal wording without legal conclusions",()=>{
  const result=obligationResult(work,documents,sources,generated([candidate()])),row=result.analysis.candidates[0];
  assert.equal(row.provision.quote_start,19);assert.equal(row.provision.quote_end,19+Array.from(row.provision.quote).length);
  assert.equal(row.actor.quote,"Operators");assert.equal(row.deadline.quote,"30 days");assert.equal(row.valid_from.quote,"2026-01-01");
  assert.equal(row.exceptions[0].quote,"except public summaries");assert.equal(row.supersedes[0].quote,"Replaces section 2.");
  assert.equal(row.claim_state,"REVIEW_REQUIRED");assert.equal(row.applicability_state,"NOT_DETERMINED");assert.equal(row.control_state,"PROPOSED_NOT_IMPLEMENTED");
  assert.equal(result.analysis.documents.length,50);assert.equal(result.analysis.documents[1].evidence_state,"NO_CANDIDATE_PROPOSED");
  assert.equal(result.sources[0].page_number,null);assert.equal(result.analysis.documents[1].consulted_sources[0].page_number,0);
  assert.deepEqual(result.checked.citations,[1]);
});
test("cross-document definitions keep the original source, hash and remapped citation rather than fabricated corroboration",()=>{
  const row=candidate();row.definitions=[quoted("Synthetic Board.","S50")];
  const result=obligationResult(work,documents,sources,generated([row]));
  assert.equal(result.analysis.candidates[0].definitions[0].citation_id,"S2");
  assert.equal(result.analysis.candidates[0].definitions[0].document_id,"document-49");
  assert.equal(result.sources[1].original_content_hash,sources[49].original_content_hash);assert.deepEqual(result.checked.citations,[1,2]);
});
test("missing actors and jurisdiction stay explicitly unknown, not inferred from a filename or workspace",()=>{
  const row={...candidate(),authority:null,actor:null,jurisdiction:null,deadline:null,valid_from:null,supersedes:[],exceptions:[]};
  const result=obligationResult(work,documents,sources,generated([row]));
  assert.equal(result.analysis.candidates[0].actor,null);assert.equal(result.analysis.candidates[0].jurisdiction,null);
  assert.equal(result.analysis.candidates[0].applicability_state,"NOT_DETERMINED");
});
test("unanchored qualifying fields reject the whole candidate rather than silently dropping exceptions",()=>{
  const bad={...candidate(),exceptions:[quoted("An invented exemption")]};
  const result=obligationResult(work,documents,sources,generated([bad,candidate(),candidate()]));
  assert.equal(result.analysis.candidates.length,1);
  assert.deepEqual(result.analysis.rejections,[{candidate_index:0,reason:"INVALID_SOURCE_ANCHOR"},{candidate_index:2,reason:"DUPLICATE_PROVISION"}]);
});
test("empty evidence is an honest gap, not a complete or compliant register",()=>{
  const result=obligationResult(work,documents,[],null);
  assert.equal(result.checked.abstained,true);assert.equal(result.checked.claim_state,"UNSUPPORTED");
  assert.ok(result.checked.answer.includes("does not establish"));assert.equal(result.analysis.documents.length,50);
  assert.ok(result.analysis.documents.every(row=>row.evidence_state==="NO_INDEXED_EVIDENCE"));
});
test("incomplete JSON, missing required fields and excess candidates are failures, not empty successful analysis",()=>{
  const missing=candidate();delete missing.applicability;
  for(const value of [{answer:"incomplete JSON"},generated(Array.from({length:13},candidate)),generated([missing]),
    generated([{...candidate(),control_candidate:"x".repeat(241)}]),generated([{...candidate(),definitions:Array(5).fill(quoted("Operators"))}])])
    assert.throws(()=>obligationResult(work,documents,sources,value),{code:"PROVIDER_INVALID_RESPONSE"});
});
test("provider-supplied automatic labels never promote candidate applicability or control state",()=>{
  const proposed={...candidate(),claim_state:"APPROVED",applicability_state:"APPLIES",control_state:"CERTIFIED"};
  const row=obligationResult(work,documents,sources,generated([proposed])).analysis.candidates[0];
  assert.equal(row.claim_state,"REVIEW_REQUIRED");assert.equal(row.applicability_state,"NOT_DETERMINED");assert.equal(row.control_state,"PROPOSED_NOT_IMPLEMENTED");
});
test("foreign or duplicate retrieved scope cannot be presented as the saved50-source review",()=>{
  assert.throws(()=>obligationResult(work,documents.slice(1),sources,null),{code:"INVALID_SCOPE"});
  assert.throws(()=>obligationResult(work,documents,[...sources,sources[0]],null),{code:"INVALID_SCOPE"});
  assert.throws(()=>obligationResult(work,[documents[1],documents[0],...documents.slice(2)],sources,null),{code:"INVALID_SCOPE"});
});
