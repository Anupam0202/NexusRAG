import test from "node:test";
import assert from "node:assert/strict";
import { handle } from "../../apps/gateway/src/preview-worker.js";

const workspace="11111111-1111-4111-8111-111111111111", user="22222222-2222-4222-8222-222222222222";
const plan="33333333-3333-4333-8333-333333333333", policy="44444444-4444-4444-8444-444444444444", run="55555555-5555-4555-8555-555555555555";
const headers={authorization:"Bearer synthetic", "x-workspace-id":workspace,"content-type":"application/json","idempotency-key":"synthetic-run"};
function fixture(t, options={}) {
  const sent=[], calls=[];
  const receipt={id:run,plan_id:plan,workspace_id:workspace,owner_id:user,schema_version:"research-run/1",persistence_state:"PERSISTED",
    state:"queued",generation:1,position:0,questions:["Synthetic retention period?"],results:[],source_state:"CURRENT",error_code:null,created_at:"2026-10-15T00:00:00Z"};
  t.mock.method(globalThis,"fetch",async(input,init={})=>{
    const path=new URL(input).pathname, json=value=>new Response(JSON.stringify(value));
    if(path==="/auth/v1/user")return json({id:user});
    if(path==="/rest/v1/workspace_members")return json([{workspace_id:workspace,user_id:user,role:"editor"}]);
    if(path==="/rest/v1/workspaces")return json([{lifecycle_state:"active",capability_revision:1}]);
    if(path==="/rest/v1/workspace_settings")return json([{active_policy_id:policy,policy_version:1}]);
    if(path==="/rest/v1/rpc/nexus_research_deep_contract")return options.deepMissing?new Response(JSON.stringify({code:"PGRST202"}),{status:404})
      :json({schema_version:"research-deep/1",max_sources:60,max_subquestions:12,max_steps:13,max_query_variants:8,runtime_seconds:600,max_prior_originals:144,max_synthesis_sources:156});
    if(path==="/rest/v1/rpc/nexus_research_candidates_contract")return options.candidatesMissing?new Response(JSON.stringify({code:"PGRST202"}),{status:404}):json({schema_version:"research-candidates/1",max_rows:201,max_candidates:200,max_sources:50});
    if(path==="/rest/v1/rpc/nexus_research_run") {
      const data=JSON.parse(init.body);calls.push(data);
      if(options.rpc)return options.rpc(data,json);
      return json(data.p_operation==="list"?{items:[receipt],next_after:null}:receipt);
    }
    throw new Error(`Unexpected fixture ${path}`);
  });
  return {sent,calls,receipt,env:{SUPABASE_URL:"https://supabase.invalid",SUPABASE_PUBLISHABLE_KEY:"synthetic-public",SUPABASE_SERVICE_ROLE_KEY:"synthetic-service",
    INGESTION_QUEUE:{send:async value=>{if(options.queueError)throw Error("synthetic queue interruption");sent.push(value);}}}};
}
const request=(method="GET",suffix="",body)=>new Request(`https://gateway.invalid/api/v2/research/plans/${plan}/runs${suffix}`,{method,headers,body:body?JSON.stringify(body):undefined});

for(const mismatch of [null,"absent","sources","fields"])test(`Procurement confirms its full durable contract before admission: ${mismatch}`,async t=>{
  const {env,receipt,calls,sent}=fixture(t);
  Object.assign(receipt,{mode:"PROCUREMENT_RESEARCH",source_snapshot:Array.from({length:50},(_,i)=>({document_id:`00000060-0000-4000-8000-${String(i).padStart(12,"0")}`})),
    questions:Array.from({length:11},(_,i)=>`Procurement criterion ${i+1}`),total_steps:11});
  const original=globalThis.fetch;
  t.mock.method(globalThis,"fetch",async(input,init)=>new URL(input).pathname==="/rest/v1/rpc/nexus_research_procurement_contract"
    ?new Response(JSON.stringify(mismatch==="absent"?{code:"PGRST202",message:"Function is absent"}:{schema_version:"research-procurement/1",
      max_sources:mismatch==="sources"?20:50,max_subquestions:10,max_steps:11,max_query_variants:8,runtime_seconds:420,max_records:12,
      max_fields:mismatch==="fields"?12:13,max_anchors:156,max_result_bytes:1000000,max_run_bytes:11000000}),{status:mismatch==="absent"?404:200}):original(input,init));
  const response=await handle(request("POST","",{non_sensitive_attested:true,execution_mode:"PROCUREMENT_RESEARCH"}),env);
  assert.equal(response.status,mismatch?503:201);assert.equal(calls.length,mismatch?0:1);assert.equal(sent.length,mismatch?0:1);
  if(mismatch)assert.match((await response.json()).error.message,/research_procurement_execution/);
  else {const result=await response.json();assert.equal(result.source_snapshot.length,50);assert.equal(result.questions.length,11);}
});
test("Procurement list keeps11completed positions while omitted results are not a read receipt",async t=>{
  const {env,receipt}=fixture(t);Object.assign(receipt,{mode:"PROCUREMENT_RESEARCH",source_snapshot:Array.from({length:50},()=>({document_id:plan})),
    questions:Array.from({length:11},(_,i)=>`Criterion ${i+1}`),total_steps:11,position:11,state:"completed",results_included:false});
  const response=await handle(request(),env);assert.equal(response.status,200);assert.equal((await response.json()).items[0].position,11);
  assert.equal((await handle(request("GET",`/${run}`),env)).status,503);
});

for(const mismatch of [null,"absent","limits"])test(`Product Passport confirms durable scope and declared product before admission: ${mismatch}`,async t=>{
  const {env,receipt,calls,sent}=fixture(t);
  const subject={product_id:"P-42",product_name:"Synthetic sensor",product_version:"2.1",supplier:"Example Components"};
  Object.assign(receipt,{mode:"PRODUCT_PASSPORT",passport_subject:subject,source_snapshot:Array.from({length:60},(_,i)=>({
    document_id:`00000059-0000-4000-8000-${String(i).padStart(12,"0")}`})),questions:Array.from({length:13},(_,i)=>`Criterion ${i+1}`),total_steps:13});
  const original=globalThis.fetch;
  t.mock.method(globalThis,"fetch",async(input,init)=>new URL(input).pathname==="/rest/v1/rpc/nexus_research_passport_contract"
    ?new Response(JSON.stringify(mismatch==="absent"?{code:"PGRST202",message:"Function is absent"}:{schema_version:"research-passport/1",
      max_sources:mismatch==="limits"?50:60,max_subquestions:12,max_steps:13,max_query_variants:8,runtime_seconds:600,
      max_claims:12,max_result_bytes:1000000,max_run_bytes:13001000}),{status:mismatch==="absent"?404:200}):original(input,init));
  const response=await handle(request("POST","",{non_sensitive_attested:true,execution_mode:"PRODUCT_PASSPORT"}),env);
  assert.equal(response.status,mismatch?503:201);assert.equal(calls.length,mismatch?0:1);assert.equal(sent.length,mismatch?0:1);
  if(mismatch)assert.match((await response.json()).error.message,/research_passport_execution/);
  else {const result=await response.json();assert.equal(result.source_snapshot.length,60);assert.equal(result.questions.length,13);assert.deepEqual(result.passport_subject,subject);}
});

for(const mismatch of [null,"absent","limits"])test(`Due Diligence confirms its installed60source13criterion contract before ordinary admission: ${mismatch}`,async t=>{
  const {env,receipt,calls,sent}=fixture(t);
  Object.assign(receipt,{mode:"DUE_DILIGENCE",entity_scope:["Example Works"],source_snapshot:Array.from({length:60},(_,i)=>({
    document_id:`00000052-0000-4000-8000-${String(i).padStart(12,"0")}`})),questions:Array.from({length:13},(_,i)=>`Criterion ${i+1}`),total_steps:13});
  const original=globalThis.fetch;
  t.mock.method(globalThis,"fetch",async(input,init)=>new URL(input).pathname==="/rest/v1/rpc/nexus_research_diligence_contract"
    ?new Response(JSON.stringify(mismatch==="absent"?{code:"PGRST202",message:"Function is absent"}:{schema_version:"research-diligence/1",
      max_sources:mismatch==="limits"?50:60,max_subquestions:12,max_steps:13,max_query_variants:8,runtime_seconds:600,
      max_observations:12,max_result_bytes:1000000,max_run_bytes:13001000}),{status:mismatch==="absent"?404:200}):original(input,init));
  const response=await handle(request("POST","",{non_sensitive_attested:true,execution_mode:"DUE_DILIGENCE"}),env);
  assert.equal(response.status,mismatch?503:201);assert.equal(calls.length,mismatch?0:1);assert.equal(sent.length,mismatch?0:1);
  if(mismatch)assert.match((await response.json()).error.message,/research_diligence_execution/);
  else {const result=await response.json();assert.equal(result.source_snapshot.length,60);assert.equal(result.questions.length,13);assert.deepEqual(result.entity_scope,["Example Works"]);}
});

for(const target of ["Example Works","\u{1F4CA}".repeat(128)])test(`Entity Investigation preserves50sources11questions and ${target==="Example Works"?"ordinary":"128Unicode-character"} targets through the Gateway`,async t=>{
  const {env,receipt,calls,sent}=fixture(t);
  Object.assign(receipt,{mode:"ENTITY_INVESTIGATION",entity_scope:[target],source_snapshot:Array.from({length:50},(_,i)=>({
    document_id:`00000048-0000-4000-8000-${String(i).padStart(12,"0")}`})),
    questions:Array.from({length:11},(_,i)=>`Inspect synthetic entity evidence ${i+1}`),total_steps:11});
  const original=globalThis.fetch;
  t.mock.method(globalThis,"fetch",async(input,init)=>new URL(input).pathname==="/rest/v1/rpc/nexus_research_entity_contract"
    ?new Response(JSON.stringify({schema_version:"research-entities/1",max_sources:50,max_subquestions:10,max_steps:11,
      max_query_variants:8,runtime_seconds:420,max_candidates:12,max_result_bytes:1000000,max_run_bytes:11000000})):original(input,init));
  const response=await handle(request("POST","",{non_sensitive_attested:true,execution_mode:"ENTITY_INVESTIGATION"}),env);
  assert.equal(response.status,201);const result=await response.json();
  assert.equal(result.source_snapshot.length,50);assert.equal(result.questions.length,11);
  assert.deepEqual(result.entity_scope,[target]);
  assert.equal(calls.length,1);assert.equal(sent.length,1);
});

for(const mismatch of [null,"absent","limits"])test(`Obligation Analysis confirms its full installed contract before admission and dispatch: ${mismatch}`,async t=>{
  const {env,receipt,calls,sent}=fixture(t);
  Object.assign(receipt,{mode:"OBLIGATION_ANALYSIS",source_snapshot:Array.from({length:50},(_,i)=>({document_id:`00000044-0000-4000-8000-${String(i).padStart(12,"0")}`})),
    questions:Array.from({length:11},(_,i)=>`Question ${i+1}`),total_steps:11});
  const original=globalThis.fetch;
  t.mock.method(globalThis,"fetch",async(input,init)=>new URL(input).pathname==="/rest/v1/rpc/nexus_research_obligation_contract"
    ?new Response(JSON.stringify(mismatch==="absent"?{code:"PGRST202",message:"Function is absent"}:{schema_version:"research-obligations/1",max_sources:mismatch==="limits"?40:50,
      max_subquestions:10,max_steps:11,max_query_variants:8,runtime_seconds:420,max_candidates:12,max_result_bytes:1000000,max_run_bytes:11000000}),{status:mismatch==="absent"?404:200}):original(input,init));
  const response=await handle(request("POST","",{non_sensitive_attested:true,execution_mode:"OBLIGATION_ANALYSIS"}),env);
  assert.equal(response.status,mismatch?503:201);assert.equal(calls.length,mismatch?0:1);assert.equal(sent.length,mismatch?0:1);
  if(mismatch)assert.match((await response.json()).error.message,/research_obligation_execution/);
});
test("Obligation Analysis list preserves all11 completed positions without pretending omitted results are a read receipt",async t=>{
  const {env,receipt}=fixture(t);Object.assign(receipt,{mode:"OBLIGATION_ANALYSIS",source_snapshot:Array.from({length:50},()=>({document_id:plan})),
    questions:Array.from({length:11},(_,i)=>`Question ${i+1}`),total_steps:11,position:11,state:"completed",results_included:false});
  const response=await handle(request(),env);assert.equal(response.status,200);assert.equal((await response.json()).items[0].position,11);
  assert.equal((await handle(request("GET",`/${run}`),env)).status,503);
});

test("Deep Research requires its installed contract before a new admission or dispatch",async t=>{
  const {env,calls,sent}=fixture(t,{deepMissing:true});
  const response=await handle(request("POST","",{non_sensitive_attested:true,execution_mode:"DEEP_RESEARCH"}),env);
  assert.equal(response.status,503);assert.match((await response.json()).error.message,/research_deep_execution/);
  assert.equal(calls.length,0);assert.equal(sent.length,0);
});

test("Deep Research retains60sources and13saved questions through the actual Gateway run command",async t=>{
  const {env,receipt,calls,sent}=fixture(t);
  Object.assign(receipt,{mode:"DEEP_RESEARCH",source_snapshot:Array.from({length:60},(_,i)=>({document_id:`00000041-0000-4000-8000-${String(i).padStart(12,"0")}`})),
    questions:Array.from({length:13},(_,i)=>`Question ${i+1}`),total_steps:13});
  const response=await handle(request("POST","",{non_sensitive_attested:true,execution_mode:"DEEP_RESEARCH"}),env);
  assert.equal(response.status,201);assert.equal((await response.json()).source_snapshot.length,60);
  assert.equal(calls.length,1);assert.equal(sent.length,1);
});

test("missing fair candidate contract stops new processing before admission or dispatch",async t=>{
  const {env,calls,sent}=fixture(t,{candidatesMissing:true});
  const response=await handle(request("POST","",{non_sensitive_attested:true}),env);
  assert.equal(response.status,503);assert.match((await response.json()).error.message,/research_query_retrieval/);
  assert.equal(calls.length,0);assert.equal(sent.length,0);
});

test("a saved research plan can start a persisted queued execution without a private chat session",async t=>{
  const {env,sent,calls}=fixture(t);
  const response=await handle(request("POST","",{non_sensitive_attested:true}),env);
  assert.equal(response.status,201);
  assert.equal((await response.json()).state,"queued");
  assert.equal(calls[0].p_operation,"create");
  assert.deepEqual(sent,[{kind:"research",run_id:run,workspace_id:workspace,generation:1,position:0}]);
});
test("research executions can be reloaded from their saved plan",async t=>{
  const {env}=fixture(t);
  const response=await handle(request(),env);
  assert.equal(response.status,200);
  assert.equal((await response.json()).items[0].id,run);
});

test("comparison lists retain saved progress without carrying the full matrix",async t=>{
  const {env,receipt}=fixture(t,{rpc:(data,json)=>json(data.p_operation==="list"?{items:[receipt],next_after:null}:receipt)});
  Object.assign(receipt,{mode:"COMPARE",source_snapshot:[{id:plan},{id:run}],total_steps:1,position:1,state:"completed",results_included:false});
  const response=await handle(request(),env);
  assert.equal(response.status,200);
  assert.deepEqual((await response.json()).items[0],receipt);
  const read=await handle(request("GET",`/${run}`),env);
  assert.equal(read.status,503);
  assert.equal((await read.json()).error.code,"PERSISTENCE_UNCONFIRMED");
});

test("comparison execution checks the matching installed contract before queuing",async t=>{
  const {env,sent,receipt}=fixture(t);
  Object.assign(receipt,{mode:"COMPARE",source_snapshot:[{id:plan},{id:run}],total_steps:1});
  const original=globalThis.fetch;
  t.mock.method(globalThis,"fetch",async(input,init)=>new URL(input).pathname==="/rest/v1/rpc/nexus_research_comparison_contract"
    ?new Response(JSON.stringify({schema_version:"research-comparison/1",batch_size:8,max_steps:45})):original(input,init));
  const response=await handle(request("POST","",{non_sensitive_attested:true,execution_mode:"COMPARE"}),env);
  assert.equal(response.status,201);assert.equal(sent.length,1);
});
for(const missing of [false,true])test(`Timeline execution confirms its own schema before queue dispatch: missing=${missing}`,async t=>{
  const {env,sent,calls,receipt}=fixture(t);Object.assign(receipt,{mode:"TIMELINE",source_snapshot:[{id:plan}],total_steps:1});
  const original=globalThis.fetch;
  t.mock.method(globalThis,"fetch",async(input,init)=>new URL(input).pathname==="/rest/v1/rpc/nexus_research_timeline_contract"
    ?new Response(JSON.stringify(missing?{code:"PGRST202",message:"Function is absent"}:{schema_version:"research-timeline/1",batch_size:8,max_steps:45}),{status:missing?404:200}):original(input,init));
  const response=await handle(request("POST","",{non_sensitive_attested:true,execution_mode:"TIMELINE"}),env);
  assert.equal(response.status,missing?503:201);assert.equal(sent.length,missing?0:1);assert.equal(calls.length,missing?0:1);
  if(missing){const error=(await response.json()).error;assert.equal(error.code,"MIGRATION_REQUIRED");assert.match(error.message,/research_timeline_execution/);}
});
test("missing processing confirmation does not create or queue a run",async t=>{
  const {env,calls,sent}=fixture(t);
  assert.equal((await handle(request("POST","",{}),env)).status,403);
  assert.equal(calls.length,0);assert.equal(sent.length,0);
});

for(const mismatch of [null,"absent","sources","runtime"])test(`Contradiction execution checks its full-scope installed contract: ${mismatch}`,async t=>{
  const {env,sent,calls,receipt}=fixture(t);Object.assign(receipt,{mode:"CONTRADICTION_ANALYSIS",source_snapshot:Array.from({length:50},()=>({id:plan})),
    questions:Array.from({length:11},(_,i)=>`Criterion ${i}`),total_steps:11});
  const original=globalThis.fetch;
  t.mock.method(globalThis,"fetch",async(input,init)=>new URL(input).pathname==="/rest/v1/rpc/nexus_research_contradiction_contract"
    ?new Response(JSON.stringify(mismatch==="absent"?{code:"PGRST202",message:"Function is absent"}:{schema_version:"research-contradiction/1",max_sources:mismatch==="sources"?40:50,
      max_steps:11,max_pairs:6,runtime_seconds:mismatch==="runtime"?300:420}),{status:mismatch==="absent"?404:200}):original(input,init));
  const response=await handle(request("POST","",{non_sensitive_attested:true,execution_mode:"CONTRADICTION_ANALYSIS"}),env);
  assert.equal(response.status,mismatch?503:201);assert.equal(sent.length,mismatch?0:1);assert.equal(calls.length,mismatch?0:1);
  if(mismatch){const error=(await response.json()).error;assert.equal(error.code,"MIGRATION_REQUIRED");assert.match(error.message,/research_contradiction_execution/);}
});
test("completed contradiction list carries all11 progress positions without embedding paired results",async t=>{
  const {env,receipt}=fixture(t);Object.assign(receipt,{mode:"CONTRADICTION_ANALYSIS",source_snapshot:Array.from({length:50},()=>({id:plan})),
    questions:Array.from({length:11},(_,i)=>`Criterion ${i}`),total_steps:11,position:11,state:"completed",results_included:false});
  const response=await handle(request(),env);assert.equal(response.status,200);assert.equal((await response.json()).items[0].position,11);
  assert.equal((await handle(request("GET",`/${run}`),env)).status,503);
});
test("queue interruption reports durable pending recovery, not completed processing",async t=>{
  const {env}=fixture(t,{queueError:true});
  const response=await handle(request("POST","",{non_sensitive_attested:true}),env);
  assert.equal(response.status,201);
  assert.equal((await response.json()).dispatch_state,"PENDING_RECOVERY");
});
for(const code of ["MODE_NOT_EXECUTABLE","PLAN_CONSTRAINTS_UNSUPPORTED","SOURCE_UNAVAILABLE","BYOK_REQUIRED","TENANT_QUOTA_EXCEEDED"])
test(`ordinary run prerequisite ${code} remains an explicit non-success`,async t=>{
  const {env,sent}=fixture(t,{rpc:()=>new Response(JSON.stringify({code:"P0001",message:`NR:${code}`}),{status:400})});
  const response=await handle(request("POST","",{non_sensitive_attested:true}),env);
  assert.ok(response.status>=400);
  assert.equal((await response.json()).error.code,code);assert.equal(sent.length,0);
});
test("a malformed run receipt cannot enqueue or claim persistence",async t=>{
  const {env,sent}=fixture(t,{rpc:(_data,json)=>json({id:run,state:"queued"})});
  assert.equal((await handle(request("POST","",{non_sensitive_attested:true}),env)).status,503);assert.equal(sent.length,0);
});
test("cancel and explicit resume use the saved run, not a fresh start",async t=>{
  const {env,calls}=fixture(t);
  assert.equal((await handle(request("POST",`/${run}/cancel`,{}),env)).status,200);
  assert.equal((await handle(request("POST",`/${run}/resume`,{non_sensitive_attested:true}),env)).status,200);
  assert.deepEqual(calls.map(c=>[c.p_operation,c.p_id]),[["cancel",run],["resume",run]]);
});
