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
test("missing processing confirmation does not create or queue a run",async t=>{
  const {env,calls,sent}=fixture(t);
  assert.equal((await handle(request("POST","",{}),env)).status,403);
  assert.equal(calls.length,0);assert.equal(sent.length,0);
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
