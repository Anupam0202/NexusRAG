// Execute the real batch transport in local Workerd with explicit synthetic peers.
import assert from "node:assert/strict";
import {startLocalWorker} from "./local-worker-harness.mjs";
import {mkdtemp,writeFile} from "node:fs/promises";
import {createServer} from "node:http";
import {tmpdir} from "node:os";
import {dirname,join,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {randomUUID} from "node:crypto";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"../.."),workspace="11111111-1111-4111-8111-111111111111",id="22222222-2222-4222-8222-222222222222";
const requests=[];let partial=false;
const literalCases=[
  ["Evidence for ISO-9001","Evidence for ISO-90010"],
  ["Evidence for ISO-9001","Evidence for ISO-9001-2"],
  ["Evidence for 10 kg","Evidence for 210 kg"],
  ["Evidence for 10.5 kg","Evidence for 110.5 kg"],
  ["Evidence not renewable","Evidence notation renewable"],
  ["Evidence for ISO-9001 at 10.5 kg","Find (iso-9001) at (10.5 KG).",true],
  ["Evidence for ISO-9001","Locate ISO-9001.",true],
  ["Evidence after 2024-02-29","Locate evidence after 2024-02-29.",true],
  ["Evidence for 10.5kg","Locate 10.5kg.",true],
];
const authority=createServer(async(request,response)=>{
  let text="";for await(const part of request)text+=part;
  const body=JSON.parse(text||"{}"),url=new URL(request.url,"http://localhost");requests.push({path:url.pathname,body});
  const json=value=>{response.setHeader("content-type","application/json");response.end(JSON.stringify(value));};
  if(url.pathname.endsWith("v6_reserve_many"))return json({state:"READY",reservations:Object.values(body.p_dimensions).map(amount=>({id:randomUUID(),amount,replayed:false}))});
  if(url.pathname.endsWith("v6_settle_many"))return json({state:"SETTLED"});
  if(url.pathname==="/synthetic-gemini")return json({embeddings:body.requests.map(()=>({values:Array(768).fill(0.01)}))});
  if(url.pathname.endsWith("/points/query/batch"))return json({result:body.searches.slice(0,partial?7:8).map(()=>({points:[{id,score:0.8,payload:{workspace_id:workspace,document_id:id,version_id:id,index_generation:"synthetic",chunk_id:id}}]}))});
  return json({});
});
await new Promise(resolve=>authority.listen(0,"127.0.0.1",resolve));
let runtime,port;
const directory=await mkdtemp(join(tmpdir(),"nexusrag-query-workerd-")),base=`http://127.0.0.1:${authority.address().port}`;
const entry=join(directory,"query-entry.mjs"),config=join(directory,"wrangler.json");
await writeFile(entry,`import {searchChunkVariants} from ${JSON.stringify(join(root,"apps/gateway/src/worker-pipeline.js").replaceAll("\\","/"))};
import {queryVariants} from ${JSON.stringify(join(root,"apps/gateway/src/research-query-retrieval.js").replaceAll("\\","/"))};
const ordinary=globalThis.fetch;
globalThis.fetch=(input,init)=>{const url=new URL(input);if(url.hostname==="generativelanguage.googleapis.com")return ordinary(${JSON.stringify(base+"/synthetic-gemini")},init);return ordinary(input,init);};
export default {async fetch(request,env){const path=new URL(request.url).pathname;if(path==="/health")return new Response("OK");try{
if(path==="/literals")return Response.json({results:${JSON.stringify(literalCases)}.map(([question,alternative])=>queryVariants(question,"QUICK_LOOKUP",{answer:JSON.stringify({queries:[alternative]}),model:"synthetic",usage:{}}))});
return Response.json({hits:await searchChunkVariants(env,{queries:Array.from({length:8},(_,i)=>"Synthetic query "+i),workspaceId:${JSON.stringify(workspace)},documentIds:[${JSON.stringify(id)}],versionIds:[${JSON.stringify(id)}],indexGenerations:["synthetic"],limit:3,dataClassification:"non_sensitive",signal:AbortSignal.timeout(10000)})});}catch(error){return Response.json({code:error.code},{status:503});}}};`);
await writeFile(config,JSON.stringify({name:"nexusrag-synthetic-query-worker",main:entry,compatibility_date:"2026-09-20",vars:{SUPABASE_URL:base,
  SUPABASE_SERVICE_ROLE_KEY:"synthetic-service",GOOGLE_API_KEY:"synthetic-not-live",QDRANT_URL:base,QDRANT_API_KEY:"synthetic-not-live"}}));
try {
  runtime=await startLocalWorker({frontend:join(root,"frontend"),directory,configPath:config});
  port=runtime.port;
  const literalResponse=await fetch(`http://127.0.0.1:${port}/literals`,{signal:AbortSignal.timeout(15000)});
  assert.equal(literalResponse.status,200);
  const literalResults=(await literalResponse.json()).results;
  assert.equal(literalResults.length,literalCases.length);
  for(const [index,receipt] of literalResults.entries()){
    const [question,alternative,faithful]=literalCases[index];
    assert.deepEqual(receipt.queries,faithful?[question,alternative]:[question]);
    assert.equal(receipt.rejected_queries,faithful?0:1);
  }
  assert.equal(requests.length,0);
  console.log(`ACTUAL_WORKER_RESEARCH_QUERY_LITERAL_PASS cases=${literalCases.length} provider_requests=0`);
  const response=await fetch(`http://127.0.0.1:${port}/query`,{signal:AbortSignal.timeout(15000)}),result=await response.json();
  assert.equal(response.status,200,JSON.stringify(result));assert.equal(result.hits.length,8);assert.ok(result.hits.every(hits=>hits.length===1&&hits[0].id===id));
  const embedding=requests.find(r=>r.path==="/synthetic-gemini"),search=requests.find(r=>r.path.endsWith("/points/query/batch"));
  assert.equal(embedding.body.requests.length,8);assert.equal(search.body.searches.length,8);
  assert.ok(search.body.searches.every(query=>query.limit===3&&query.filter.must[0].match.value===workspace));
  assert.equal(requests.find(r=>r.body.p_dimensions?.embedding_tokens).body.p_dimensions.requests,8);
  const successRequests=requests.length;assert.ok(successRequests<50);
  partial=true;
  const failure=await fetch(`http://127.0.0.1:${port}/query`,{signal:AbortSignal.timeout(15000)});
  assert.equal(failure.status,503);assert.equal((await failure.json()).code,"PROVIDER_INVALID_RESPONSE");
  console.log(JSON.stringify({marker:"ACTUAL_WORKER_RESEARCH_QUERY_BATCH_PASS",queries:8,dimensions:768,actual_controlled_http_requests:successRequests,partial_batch_rejected:true,
    production_implementation:true,hosted_or_provider_processing:false,actual_hosted_cpu_latency_acceptance:false}));
} finally {
  try{if(runtime)await runtime.close();}finally{
    await new Promise(resolve=>authority.close(resolve));
  }
}
