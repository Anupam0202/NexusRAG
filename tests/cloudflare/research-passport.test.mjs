import test from "node:test";
import assert from "node:assert/strict";
import {passportWork,passportPrompt,passportResult,passportKinds,passportStatuses} from "../../apps/gateway/src/research-passport.js";

function fixture(count=2) {
  const documents=Array.from({length:count},(_,i)=>({id:`doc-${i}`,filename:`Synthetic certificate ${i}.txt`}));
  const subject={product_id:"P-42",product_name:"Example sensor",product_version:"2.1",supplier:"Example Components"};
  const sources=documents.map((document,i)=>({citation_id:`S${i+7}`,document_id:document.id,version_id:`version-${i}`,chunk_id:`chunk-${i}`,
    filename:document.filename,content:"\u{1F4CA} Example sensor P-42 version 2.1; certificate C-17 is supplier asserted, not independently certified.",
    original_content_hash:"a".repeat(64),page_number:i?null:0,chunk_index:i}));
  const run={mode:"PRODUCT_PASSPORT",questions:Array.from({length:13},(_,i)=>`Criterion ${i}`),position:12,
    source_snapshot:documents.map(document=>({document_id:document.id})),passport_subject:subject};
  const work=passportWork(run),wire={schema_version:"research-passport-wire/1",anchors:[["S7",2,16]],
    texts:["Certificate reference","C-17","Supplier assertion does not establish certification.","Current independent test report remains unresolved."],
    claims:[{kind:"CERTIFICATE",property:0,value:1,status:"ASSERTED_BY_SUPPLIER",evidence:[0],qualifications:[2]}],
    gaps:[{document_id:null,description:3}]};
  return {documents,sources,run,work,wire,generated:value=>({answer:JSON.stringify(value)})};
}

test("Passport work retains all60sources and13criteria with an independent exact product version",()=>{
  const {run}=fixture(60),work=passportWork(run);
  assert.equal(work.total_documents,60);assert.equal(work.criterion_index,12);
  work.subject.product_version="3.0";assert.equal(run.passport_subject.product_version,"2.1");
  for(const changed of [{passport_subject:undefined},{passport_subject:{...run.passport_subject,product_version:""}},
    {passport_subject:{...run.passport_subject,verified:true}},{questions:[...run.questions,"extra"]},
    {source_snapshot:[...run.source_snapshot,{document_id:"extra"}]},{position:13}])
    assert.throws(()=>passportWork({...run,...changed}),{code:"INVALID_SCOPE"});
});

test("claims retain exact Unicode anchors, declared version, explicit qualifications and original null/zero pages",()=>{
  const {work,documents,sources,wire,generated}=fixture(),result=passportResult(work,documents,sources,generated(wire));
  assert.equal(result.analysis.subject.product_version,"2.1");
  assert.equal(result.analysis.claims[0].evidence[0].quote,"Example sensor");
  assert.equal(result.analysis.claims[0].evidence[0].quote_start,2);
  assert.equal(result.analysis.claims[0].status_state,"PROPOSED_NOT_VERIFIED");
  assert.equal(result.analysis.claims[0].subject_match,"NOT_VERIFIED");
  assert.equal(result.checked.claim_state,"REVIEW_REQUIRED");assert.match(result.checked.answer,/not verified/);
  assert.equal(result.analysis.documents[1].consulted_sources[0].page_number,null);
  assert.equal(result.sources[0].page_number,0);assert.equal(result.sources[0].original_content_hash,"a".repeat(64));
});

test("reused compact anchors are copied and consistently renumbered across different claims",()=>{
  const {work,documents,sources,wire,generated}=fixture();
  wire.claims.push({...wire.claims[0],kind:"DECLARATION"});
  const result=passportResult(work,documents,sources,generated(wire));
  assert.deepEqual(result.analysis.claims.map(row=>row.evidence[0].citation_id),["S1","S1"]);
  assert.notEqual(result.analysis.claims[0].evidence[0],result.analysis.claims[1].evidence[0]);
  assert.equal(result.sources.length,1);assert.equal(sources[0].citation_id,"S7");
});

test("proposed contradictions require two distinct nonoverlapping anchors, not duplicate citation labels",()=>{
  const {work,documents,sources,wire,generated}=fixture();wire.claims[0].status="CONTRADICTED";
  assert.throws(()=>passportResult(work,documents,sources,generated(wire)),{code:"PROVIDER_INVALID_RESPONSE"});
  wire.anchors.push(["S7",3,17]);wire.claims[0].evidence.push(1);
  assert.throws(()=>passportResult(work,documents,sources,generated(wire)),{code:"PROVIDER_INVALID_RESPONSE"});
  wire.anchors[1]=["S8",2,16];
  const result=passportResult(work,documents,sources,generated(wire));
  assert.equal(result.sources.length,2);assert.equal(result.analysis.claims[0].claim_state,"REVIEW_REQUIRED");
});

test("missing exact quotes and repeated claims are explicit omissions, never invented assurance",()=>{
  const {work,documents,sources,wire,generated}=fixture();
  wire.anchors=[{citation_id:"S7",quote:"Absent product name"}];
  let result=passportResult(work,documents,sources,generated(wire));
  assert.equal(result.analysis.rejections[0].reason,"UNCONFIRMED_SOURCE_ANCHOR");assert.equal(result.checked.abstained,true);
  wire.anchors=[["S7",2,16]];wire.claims.push({...wire.claims[0]});
  result=passportResult(work,documents,sources,generated(wire));assert.equal(result.analysis.claims.length,1);
  assert.equal(result.analysis.rejections[0].reason,"REPEATED_CLAIM");
});

test("all accepted source-evidence kinds and proposed statuses keep independent-review semantics",()=>{
  const {work,documents,sources,wire,generated}=fixture();
  for(const kind of passportKinds)for(const status of passportStatuses.filter(status=>status!=="CONTRADICTED")){
    wire.claims[0]={...wire.claims[0],kind,status};
    const result=passportResult(work,documents,sources,generated(wire));
    assert.equal(result.analysis.claims[0].kind,kind);assert.equal(result.analysis.claims[0].status,status);
    assert.equal(result.analysis.claims[0].claim_state,"REVIEW_REQUIRED");
  }
  wire.claims[0].status="VERIFIED";
  assert.throws(()=>passportResult(work,documents,sources,generated(wire)),{code:"PROVIDER_INVALID_RESPONSE"});
});

test("a full compact report preserves all12claims,48anchors,84texts and12gaps at accepted bounds",()=>{
  const {work,documents,sources,wire,generated}=fixture(60);
  const quote="Q".repeat(300),content=quote.repeat(4);
  for(const source of sources)source.content=content;
  wire.anchors=Array.from({length:48},(_,i)=>[`S${7+Math.floor(i/4)}`,i%4*300,(i%4+1)*300]);
  wire.texts=Array.from({length:84},(_,i)=>i<12?`Property ${i} `.padEnd(128,"x"):"\u{1F4CA}".repeat(240));
  wire.claims=Array.from({length:12},(_,i)=>({kind:"TEST",property:i,value:12+i,status:"PUBLIC_SOURCE",
    evidence:[i*4,i*4+1,i*4+2,i*4+3],qualifications:[24+i*4,25+i*4,26+i*4,27+i*4]}));
  wire.gaps=Array.from({length:12},(_,i)=>({document_id:documents[i].id,description:72+i}));
  const result=passportResult(work,documents,sources,generated(wire));
  assert.equal(result.analysis.claims.length,12);assert.equal(result.analysis.documents.length,60);
  assert.equal(result.analysis.gaps.length,12);assert.equal(result.sources.length,12);
  assert.ok(Array.from(result.checked.answer).length<=16000);
  assert.equal(result.analysis.claims[11].qualifications.length,4);
  assert.ok(result.analysis.claims.every(claim=>claim.qualifications.every(value=>Array.from(value).length===240)));
  assert.match(result.checked.answer,/Qualifications are retained/);
  assert.equal(result.analysis.claims[11].evidence[3].quote_end,1200);
});

test("empty evidence honestly abstains, preserving consultation and version scope for all60documents",()=>{
  const {work,documents}=fixture(60),result=passportResult(work,documents,[],null);
  assert.equal(result.checked.abstained,true);assert.match(result.checked.answer,/not certification/);
  assert.equal(result.analysis.documents.length,60);
  assert.ok(result.analysis.documents.every(doc=>doc.evidence_state==="NO_INDEXED_EVIDENCE"));
  assert.equal(result.sources.length,0);
});

test("malformed wire, missing qualifications and over-limit properties never become a completed report",()=>{
  const {work,documents,sources,wire,generated}=fixture();
  for(const malformed of [{...wire,schema_version:"wrong"},{...wire,claims:[{...wire.claims[0],qualifications:[]}]},
    {...wire,texts:["x".repeat(129),...wire.texts.slice(1)]},{...wire,anchors:[["S7",0,301]]}])
    assert.throws(()=>passportResult(work,documents,sources,generated(malformed)),{code:"PROVIDER_INVALID_RESPONSE"});
  assert.throws(()=>passportResult(work,documents,sources,{answer:"{"}),{code:"PROVIDER_INVALID_RESPONSE"});
});

test("prompt preserves exact declared product, full source scope and no-certification/version limitations",()=>{
  const {work,documents,sources}=fixture(60),prompt=passportPrompt(work,documents,sources);
  assert.ok(prompt.includes(JSON.stringify(work.subject)));assert.equal(JSON.parse(prompt.split("\nEVIDENCE:\n")[1]).length,60);
  assert.match(prompt,/different version/);assert.match(prompt,/NOT certification/);assert.match(prompt,/Never remove qualifications/);
});
