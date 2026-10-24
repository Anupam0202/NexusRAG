import test from "node:test";
import assert from "node:assert/strict";
import { handle } from "../../apps/gateway/src/preview-worker.js";

const workspace="11111111-1111-4111-8111-111111111111", user="22222222-2222-4222-8222-222222222222";
const plan="33333333-3333-4333-8333-333333333333", id="55555555-5555-4555-8555-555555555555";
const command={operation:"ADD",left:{value:"9007199254740993.1",unit:"USD",evidence_ids:["source-a"]},
  right:{value:"0.2",unit:"USD",evidence_ids:["source-b"]},precision:2};
const headers={authorization:"Bearer synthetic", "x-workspace-id":workspace,"content-type":"application/json","idempotency-key":"synthetic-calculation"};
const env={SUPABASE_URL:"https://calculation.invalid",SUPABASE_PUBLISHABLE_KEY:"synthetic-public",SUPABASE_SERVICE_ROLE_KEY:"synthetic-service"};
const receipt={id,plan_id:plan,workspace_id:workspace,owner_id:user,input:command,result:{operation:"ADD",value:"9007199254740993.30",
  unit:"USD",formula:"9007199254740993.1+0.2",evidence_ids:["source-a","source-b"],precision:2,rounding:"ROUND_HALF_EVEN"},
  state:"calculated",schema_version:"research-calculation/1",persistence_state:"PERSISTED",input_evidence_state:"CALLER_ASSERTED_NOT_VERIFIED"};
function fixture(t, rpc) {
  t.mock.method(globalThis,"fetch",async(input,init={})=>{
    const url=new URL(input),json=value=>new Response(JSON.stringify(value));
    if(url.pathname==="/auth/v1/user")return json({id:user});
    if(url.pathname==="/rest/v1/workspace_members")return json([{workspace_id:workspace,user_id:user,role:"editor"}]);
    if(url.pathname==="/rest/v1/workspaces")return json([{lifecycle_state:"active",capability_revision:1}]);
    if(url.pathname==="/rest/v1/workspace_settings")return json([{active_policy_id:plan,policy_version:1}]);
    if(url.pathname==="/rest/v1/rpc/nexus_research_calculation")return rpc(JSON.parse(init.body),json);
    throw new Error(`Unexpected fixture path ${url.pathname}`);
  });
}
test("a real calculation journey preserves decimal strings through execution, storage receipt and reload",async t=>{
  const calls=[];fixture(t,(data,json)=>{calls.push(data);return json(data.p_operation==="create"?receipt:{items:[receipt]});});
  const created=await handle(new Request(`https://gateway.invalid/api/v2/research/plans/${plan}/calculations`,{method:"POST",headers,body:JSON.stringify(command)}),env);
  assert.equal(created.status,201);assert.deepEqual((await created.json()).result,receipt.result);
  assert.equal(calls[0].p_input.left.value,"9007199254740993.1");
  const listed=await handle(new Request(`https://gateway.invalid/api/v2/research/plans/${plan}/calculations`,{headers}),env);
  assert.equal(listed.status,200);assert.equal((await listed.json()).items[0].id,id);
});
test("unconfirmed calculation output cannot report a saved result",async t=>{
  fixture(t,(_data,json)=>json({...receipt,persistence_state:"NOT_PERSISTED"}));
  const response=await handle(new Request(`https://gateway.invalid/api/v2/research/plans/${plan}/calculations`,{method:"POST",headers,body:JSON.stringify(command)}),env);
  assert.equal(response.status,503);assert.equal((await response.json()).error.code,"PERSISTENCE_UNCONFIRMED");
});
test("ordinary numeric JSON input is rejected before losing integer precision",async t=>{
  let calls=0;fixture(t,(_data,json)=>{calls++;return json(receipt);});
  const response=await handle(new Request(`https://gateway.invalid/api/v2/research/plans/${plan}/calculations`,{method:"POST",headers,
    body:JSON.stringify({...command,left:{...command.left,value:9007199254740992}})}),env);
  assert.equal(response.status,422);assert.equal(calls,0);
});
for(const [code,status,message] of [["CALCULATION_INVALID",422,"undefined"],["CALCULATION_MODE_REQUIRED",422,"Calculation plan"],
  ["NOT_FOUND",404,"unavailable"],["TENANT_QUOTA_EXCEEDED",429,"limit"],["INVALID_SCOPE",422,"bounds"]])test(`ordinary ${code} has an actionable calculation error`,async t=>{
  fixture(t,()=>new Response(JSON.stringify({code:"P0001",message:`NR:${code}`}),{status:400}));
  const response=await handle(new Request(`https://gateway.invalid/api/v2/research/plans/${plan}/calculations`,{method:"POST",headers,body:JSON.stringify(command)}),env);
  assert.equal(response.status,status);assert.match((await response.json()).error.message,new RegExp(message));
});
test("absent calculation migration is reported separately from successful execution",async t=>{
  fixture(t,()=>new Response(JSON.stringify({code:"PGRST202",message:"missing RPC"}),{status:404}));
  const response=await handle(new Request(`https://gateway.invalid/api/v2/research/plans/${plan}/calculations`,{headers}),env);
  assert.equal(response.status,503);assert.equal((await response.json()).error.code,"MIGRATION_REQUIRED");
});
