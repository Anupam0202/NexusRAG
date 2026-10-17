import test from "node:test";
import assert from "node:assert/strict";
import {queryVariantPrompt,queryVariants,fuseQueryVariants} from "../../apps/gateway/src/research-query-retrieval.js";
import {searchChunkVariants} from "../../apps/gateway/src/worker-pipeline.js";
const generated=queries=>({answer:JSON.stringify({queries}),model:"synthetic",usage:{promptTokenCount:10}});
for(const [mode,max] of [["QUICK_LOOKUP",2],["EVIDENCE_ANSWER",4],["COMPARE",6],["TIMELINE",6],["CONTRADICTION_ANALYSIS",8]])test(`${mode} keeps the original and its adopted ${max}-query maximum`,()=>{
  const list=Array.from({length:max-1},(_,i)=>`Alternative wording ${String.fromCharCode(65+i)}`);
  const result=queryVariants("Original question",mode,generated(list));
  assert.deepEqual(result.queries,["Original question",...list]);assert.equal(result.max_queries,max);
  assert.equal(result.expansion_status,"EXPANDED");assert.match(queryVariantPrompt("Original question",mode),new RegExp(`at most ${max-1}`));
  assert.equal(result.evidence_interpretation,"SEARCH_QUERIES_NOT_EVIDENCE");
});
test("literal identifiers, quoted phrases, dates, numbers, negation and exceptions survive expansion",()=>{
  const question='Which "cover letter" for END-400 after 2024-02-29 is not a 30 day resume?';
  const good='Find "cover letter" END-400 after 2024-02-29 not a 30 day resume.';
  const result=queryVariants(question,"CONTRADICTION_ANALYSIS",generated([good,good.toUpperCase(),good.replace("END-400","END-401"),good.replace("not ",""),good.replace('"cover letter"','cover letter')]));
  assert.deepEqual(result.queries,[question,good]);assert.equal(result.rejected_queries,4);
});
test("measurement units and bound qualifiers cannot silently change in an alternate query",()=>{
  const question="No less than 30 kg and at most 50 days",good="No less than 30 kg and at most 50 days of measurement context";
  const result=queryVariants(question,"EVIDENCE_ANSWER",generated([good,good.replace("kg","lb"),good.replace("at most","after")]));
  assert.deepEqual(result.queries,[question,good]);assert.equal(result.rejected_queries,2);
});

for(const [original,alternative] of [
  ["Evidence for ISO-9001","Evidence for ISO-90010"],
  ["Evidence for ISO-9001","Evidence for XISO-9001"],
  ["Evidence for ISO-9001","Evidence for ISO-9001-2"],
  ["Evidence for ISO-9001","Evidence for ISO-9001.2"],
  ["Evidence for ISO-9001","Evidence for ISO-9001/2"],
  ["Evidence for ISO-9001","Evidence for X/ISO-9001"],
  ["Evidence for 10 kg","Evidence for 210 kg"],
  ["Evidence for 10.5 kg","Evidence for 110.5 kg"],
  ["Evidence for 2.5","Evidence for 2.5.1"],
  ["Evidence after 2024-02-29","Evidence after 2024-02-290"],
  ["Evidence not renewable","Evidence notation renewable"],
  ["Evidence at most 50 days","Evidence at mostly 50 days"],
])test(`literal token boundaries reject changed meaning: ${alternative}`,()=>{
  const result=queryVariants(original,"QUICK_LOOKUP",generated([alternative]));
  assert.deepEqual(result.queries,[original]);assert.equal(result.rejected_queries,1);
  assert.equal(result.expansion_status,"ORIGINAL_ONLY");
});

test("literal token boundaries retain faithful case and surrounding punctuation",()=>{
  const question='Evidence for ISO-9001, "cover letter", 10.5 kg after 2024-02-29 not a 50 day limit';
  const alternative='Find (iso-9001), "cover letter", (10.5 KG), after (2024-02-29), not a (50 DAY) limit.';
  const result=queryVariants(question,"QUICK_LOOKUP",generated([alternative]));
  assert.deepEqual(result.queries,[question,alternative]);assert.equal(result.rejected_queries,0);
});

test("a bounded long identifier question retains its original without accepting a partial scope",()=>{
  const question=Array.from({length:1200},(_,i)=>`ID-${i}`).join(" ");
  assert.ok(question.length<=10000);
  const result=queryVariants(question,"QUICK_LOOKUP",generated(["Locate ID-0"]));
  assert.deepEqual(result.queries,[question]);assert.equal(result.rejected_queries,1);
});

for(const [question,alternative] of [
  ["Evidence for ISO-9001","Locate ISO-9001."],
  ["Evidence after 2024-02-29","Find evidence after 2024-02-29."],
  ["Evidence for 10.5kg","Locate 10.5kg."],
  ["Evidence for 10.5 kg","Locate 10.5 kg."],
])test(`faithful literals retain sentence punctuation: ${alternative}`,()=>{
  const result=queryVariants(question,"QUICK_LOOKUP",generated([alternative]));
  assert.deepEqual(result.queries,[question,alternative]);assert.equal(result.rejected_queries,0);
});
for(const answer of ["No JSON",JSON.stringify({queries:null}),JSON.stringify({queries:Array(8).fill("excess")})])test(`invalid expansion remains explicit original-only, ${answer.slice(0,20)}`,()=>{
  const result=queryVariants("Original","CONTRADICTION_ANALYSIS",{answer});
  assert.deepEqual(result.queries,["Original"]);assert.equal(result.expansion_status,"INVALID_RESPONSE_ORIGINAL_ONLY");
});
test("cross-query rank fusion counts each identity once and preserves supported alpha",()=>{
  const dense={id:"a",payload:{chunk_id:"a",content:"semantic",document_id:"d"}};
  const sparse=[{id:"b",document_id:"d",content:"literal",metadata:{filename:"Synthetic"}}];
  assert.equal(fuseQueryVariants(["literal","literal"],[[dense],[dense]],sparse,2,1)[0].id,"a");
  assert.equal(fuseQueryVariants(["literal","literal"],[[dense],[dense]],sparse,2,0)[0].id,"b");
  assert.equal(new Set(fuseQueryVariants(["literal","literal"],[[dense],[dense]],sparse,2,0.6).map(hit=>hit.id)).size,2);
});

for(const fault of [null,"partial-embedding","partial-query","nonfinite","quota"])test(`actual batch transport confirms every query and reserves bounded work: ${fault}`,async t=>{
  const calls=[],workspace="11111111-1111-4111-8111-111111111111",id="22222222-2222-4222-8222-222222222222";
  t.mock.method(globalThis,"fetch",async(input,init={})=>{
    const url=new URL(input),body=JSON.parse(init.body||"{}"),json=value=>new Response(JSON.stringify(value));calls.push({path:url.pathname,body,signal:init.signal});
    if(url.pathname.endsWith("v6_reserve_many"))return json(fault==="quota"?{state:"QUOTA_EXHAUSTED"}:{state:"READY",reservations:Object.values(body.p_dimensions).map(amount=>({id,amount,replayed:false}))});
    if(url.pathname.endsWith("v6_settle_many"))return json({state:"SETTLED"});
    if(url.pathname.endsWith(":batchEmbedContents"))return json({embeddings:body.requests.slice(0,fault==="partial-embedding"?1:2).map(()=>({values:Array(8).fill(fault==="nonfinite"?null:0.1)}))});
    if(url.pathname.endsWith("/points/query/batch"))return json({result:body.searches.slice(0,fault==="partial-query"?1:2).map(()=>({points:[{id,score:0.8,payload:{workspace_id:workspace,document_id:id,version_id:id,index_generation:"g",chunk_id:id}}]}))});
    return json({});
  });
  const run=()=>searchChunkVariants({SUPABASE_URL:"https://sql.invalid",SUPABASE_SERVICE_ROLE_KEY:"synthetic",GOOGLE_API_KEY:"synthetic",QDRANT_URL:"https://qdrant.invalid",QDRANT_API_KEY:"synthetic"},
    {queries:["Original query","Alternative query"],workspaceId:workspace,documentIds:[id],versionIds:[id],indexGenerations:["g"],limit:3,dataClassification:"non_sensitive",signal:AbortSignal.timeout(1000)});
  if(fault)await assert.rejects(run,error=>error.code===(fault==="quota"?"QUOTA_EXHAUSTED":"PROVIDER_INVALID_RESPONSE"));
  else {
    const result=await run();assert.equal(result.length,2);assert.equal(result[1][0].id,id);
    const embedding=calls.find(c=>c.path.endsWith(":batchEmbedContents"));assert.equal(embedding.body.requests.length,2);
    const query=calls.find(c=>c.path.endsWith("/points/query/batch"));assert.equal(query.body.searches.length,2);
    assert.ok(query.body.searches.every(s=>s.limit===3&&s.filter.must[0].match.value===workspace));
    const reservation=calls.find(c=>c.body.p_dimensions?.embedding_tokens).body.p_dimensions;
    assert.equal(reservation.requests,2);assert.equal(reservation.embedding_tokens,new TextEncoder().encode("Original queryAlternative query").length);
    assert.ok(calls.filter(c=>!c.path.includes("/rpc/")).every(c=>c.signal instanceof AbortSignal));
  }
  if(fault==="quota")assert.equal(calls.filter(c=>!c.path.includes("/rpc/")).length,0);
});
