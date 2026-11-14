import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {entityWork,entityPrompt,entityResult} from "../../apps/gateway/src/research-entities.js";
import {entityCapacity,entityWire} from "../fixtures/research-entity-data.mjs";

function fixture() {
  const documents=[{id:"doc-one",filename:"Synthetic registry.txt"},{id:"doc-two",filename:"Synthetic amendment.txt"}];
  const contents=["\u{1F4CA} Example Works (EX-17), also called WorksCo. Filing 2026-10-01 states Example Works is owned by Example Holdings from 2025-01-01.",
    "Example Works registry EX-18. The names alone do not resolve identity."];
  const sources=documents.map((document,i)=>({citation_id:i?"S9":"S7",document_id:document.id,version_id:`version-${i}`,chunk_id:`chunk-${i}`,
    filename:document.filename,content:contents[i],original_content_hash:createHash("sha256").update(contents[i]).digest("hex"),page_number:i?null:0,chunk_index:i}));
  const run={mode:"ENTITY_INVESTIGATION",questions:["What do the synthetic filings actually state?"],position:0,
    source_snapshot:documents.map(document=>({document_id:document.id})),entity_scope:["Example Works"]};
  const work=entityWork(run);
  const anchor=(quote,index=0,from=0)=>{const source=sources[index],offset=source.content.indexOf(quote,from);assert.ok(offset>=0);
    return {citation_id:source.citation_id,quote,quote_start:Array.from(source.content.slice(0,offset)).length};};
  const statement="Example Works is owned by Example Holdings from 2025-01-01.",start=contents[0].indexOf(statement);
  const candidate={name:anchor("Example Works"),identifiers:[anchor("EX-17")],aliases:[anchor("WorksCo")],filings:[anchor("2026-10-01")],
    jurisdiction:null,valid_from:anchor("2025-01-01"),valid_to:null,
    relationships:[{statement:anchor(statement),subject:anchor("Example Works",0,start),predicate:anchor("is owned by"),
      object:anchor("Example Holdings"),valid_from:anchor("2025-01-01"),valid_to:null}],limitations:["A filing statement is not verified current ownership."]};
  const generated=candidates=>({answer:JSON.stringify({candidates})});
  return {documents,sources,run,work,candidate,anchor,generated};
}

test("Entity Investigation uses its accepted50source11criterion bounds and retains all100 saved targets",()=>{
  const {run}=fixture();
  const full={...run,source_snapshot:Array.from({length:50},(_,i)=>({document_id:`doc-${i}`})),
    questions:Array.from({length:11},(_,i)=>`Question ${i}`),position:10,entity_scope:Array.from({length:100},(_,i)=>`Target ${i}`)};
  const work=entityWork(full);assert.equal(work.total_documents,50);assert.equal(work.criterion_index,10);assert.equal(work.targets.length,100);
  assert.throws(()=>entityWork({...full,position:11}),{code:"INVALID_SCOPE"});
  assert.throws(()=>entityWork({...full,source_snapshot:[...full.source_snapshot,{document_id:"doc-extra"}]}),{code:"INVALID_SCOPE"});
});

test("literal identifiers, aliases, filings, relationship direction and Unicode positions remain reviewable, not verified identities",()=>{
  const {work,documents,sources,candidate,generated}=fixture(),result=entityResult(work,documents,sources,generated([candidate]));
  const saved=result.analysis.candidates[0];assert.equal(saved.name.quote_start,2);assert.equal(saved.name.citation_id,"S1");
  assert.equal(saved.identifiers[0].quote,"EX-17");assert.equal(saved.aliases[0].quote,"WorksCo");assert.equal(saved.filings[0].quote,"2026-10-01");
  assert.equal(saved.relationships[0].subject.quote,"Example Works");assert.equal(saved.relationships[0].object.quote,"Example Holdings");
  assert.equal(saved.relationships[0].predicate.quote,"is owned by");assert.equal(saved.valid_to,null);assert.equal(saved.jurisdiction,null);
  assert.equal(saved.identity_state,"NOT_RESOLVED");assert.equal(saved.confidence_state,"NOT_CALIBRATED");
  assert.equal(saved.decision_state,"NO_AUTOMATIC_ADVERSE_DECISION");assert.equal(result.checked.claim_state,"REVIEW_REQUIRED");
  assert.deepEqual(result.analysis.requested_targets,["Example Works"]);assert.equal(result.sources.length,1);
  assert.equal(result.sources[0].original_content_hash,sources[0].original_content_hash);
  assert.equal(result.sources[0].page_number,0);assert.equal(result.analysis.documents[1].consulted_sources[0].page_number,null);
});

test("different identifiers for a same-named entity stay distinct across source records",()=>{
  const {work,documents,sources,candidate,anchor,generated}=fixture();
  const second={...candidate,name:anchor("Example Works",1),identifiers:[anchor("EX-18",1)],aliases:[],filings:[],valid_from:null,relationships:[]};
  const result=entityResult(work,documents,sources,generated([candidate,second]));assert.equal(result.analysis.candidates.length,2);
  assert.equal(result.sources.length,2);assert.notDeepEqual(result.analysis.candidates[0].identifiers,result.analysis.candidates[1].identifiers);
  assert.ok(result.analysis.candidates.every(item=>item.identity_state==="NOT_RESOLVED"));
});

test("unrelated source fragments cannot be assembled into a literal relationship statement",()=>{
  const {work,documents,sources,candidate,anchor,generated}=fixture();
  const row={...candidate,relationships:[{...candidate.relationships[0],subject:anchor("Example Works")}]};
  const result=entityResult(work,documents,sources,generated([row]));assert.equal(result.analysis.candidates.length,0);
  assert.equal(result.analysis.rejections[0].reason,"INVALID_SOURCE_ANCHOR_OR_RELATIONSHIP_STATEMENT");assert.equal(result.checked.abstained,true);
});

test("an ordinary unmatched provider quote becomes an explicit rejected candidate without invented source text",()=>{
  const {work,documents,sources,candidate,generated}=fixture();
  const row={...candidate,name:{citation_id:"S7",quote:"An absent synthetic company"}};
  const result=entityResult(work,documents,sources,generated([row]));assert.equal(result.analysis.rejections.length,1);
  assert.equal(result.analysis.candidates.length,0);assert.equal(result.checked.claim_state,"UNSUPPORTED");assert.deepEqual(result.sources,[]);
  assert.ok(result.analysis.documents.every(document=>document.evidence_state==="NO_CANDIDATE_PROPOSED"));
});

test("empty candidate output preserves source consultation and honest bounded coverage",()=>{
  const {work,documents,sources,generated}=fixture(),result=entityResult(work,documents,sources,generated([]));
  assert.equal(result.checked.abstained,true);assert.match(result.checked.answer,/does not establish entity absence/);
  assert.equal(result.analysis.coverage,"BOUNDED_RETRIEVAL_NOT_COMPLETE_ENTITY_REGISTER");
  assert.equal(result.analysis.documents.length,2);assert.equal(result.analysis.documents[0].consulted_sources[0].original_content_hash,sources[0].original_content_hash);
});

test("compact wire offsets retain actual Unicode wording and all explicit null/empty fields",()=>{
  const {work,documents,sources}=fixture();
  const wire={schema_version:"research-entity-wire/1",anchors:[["S7",2,15],{citation_id:"S7",quote:"EX-17"}],texts:["Review identity independently."],
    candidates:[{name:0,identifiers:[1],aliases:[],filings:[],jurisdiction:null,valid_from:null,valid_to:null,relationships:[],limitations:[0]}]};
  const result=entityResult(work,documents,sources,{answer:JSON.stringify(wire)});
  assert.equal(result.analysis.candidates[0].name.quote,"Example Works");assert.equal(result.analysis.candidates[0].identifiers[0].quote,"EX-17");
  assert.deepEqual(result.analysis.candidates[0].filings,[]);assert.equal(result.analysis.candidates[0].valid_from,null);
});

test("quote-only relationship anchors resolve inside their statement when a source repeats the entity name",()=>{
  const {work,documents,sources,candidate,generated}=fixture();
  const quoteOnly=value=>value===null?null:{citation_id:value.citation_id,quote:value.quote};
  const row={...candidate,relationships:candidate.relationships.map(value=>Object.fromEntries(Object.entries(value).map(([key,anchor])=>[key,quoteOnly(anchor)])))};
  const result=entityResult(work,documents,sources,generated([row]));
  assert.equal(result.analysis.candidates.length,1);
  const relation=result.analysis.candidates[0].relationships[0];
  assert.equal(relation.subject.quote,"Example Works");assert.ok(relation.subject.quote_start>candidate.name.quote_start);
  assert.ok(relation.subject.quote_start>=relation.statement.quote_start);assert.ok(relation.object.quote_end<=relation.statement.quote_end);
});

test("ordinary malformed or incomplete structured responses fail explicitly rather than completing an empty shell",()=>{
  const {work,documents,sources,candidate,generated}=fixture();
  assert.throws(()=>entityResult(work,documents,sources,{answer:'{"candidates":['}),{code:"PROVIDER_INVALID_RESPONSE"});
  assert.throws(()=>entityResult(work,documents,sources,generated([{...candidate,identifiers:undefined}])),{code:"PROVIDER_INVALID_RESPONSE"});
});

test("the evidence prompt includes every requested target, real source scope and explicit uncertainty",()=>{
  const {work,documents,sources}=fixture(),prompt=entityPrompt(work,documents,sources);
  assert.ok(prompt.includes(JSON.stringify(work.targets)));assert.ok(prompt.includes("NOT_VERIFIED_IDENTITIES"));
  assert.ok(prompt.includes("Do not drop qualifiers"));assert.ok(prompt.includes("no source-anchored candidate"));
  assert.equal(JSON.parse(prompt.split("\nEVIDENCE:\n")[1]).length,2);
});

test("all twelve candidates retain forty maximum-length anchors, four relationships and all limitations",()=>{
  const data=entityCapacity(),work=entityWork(data.run),wire=entityWire(data.candidates,data.sources);
  const result=entityResult(work,data.documents,data.sources,{answer:JSON.stringify(wire)});
  assert.equal(result.analysis.candidates.length,12);assert.equal(result.analysis.documents.length,50);
  assert.equal(wire.texts.length,48);assert.equal(result.analysis.requested_targets.length,100);
  for(const row of result.analysis.candidates) {
    assert.equal(Array.from(row.name.quote).length,300);assert.equal(row.relationships.length,4);assert.equal(row.limitations.length,4);
    for(const field of ["identifiers","aliases","filings"])assert.equal(row[field].length,4);
    for(const relation of row.relationships)for(const field of ["statement","subject","predicate","object","valid_from","valid_to"])
      assert.equal(Array.from(relation[field].quote).length,300);
    assert.ok(row.limitations.every(value=>Array.from(value).length===240));
  }
  assert.ok(Buffer.byteLength(JSON.stringify(result))<1000000);
  assert.ok(Array.from(result.checked.answer).length<=16000);
});
