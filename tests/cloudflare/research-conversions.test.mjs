import test from "node:test";
import assert from "node:assert/strict";
import {handle} from "../../apps/gateway/src/preview-worker.js";
import {validateConversion} from "../../apps/gateway/src/research-conversions.js";
const workspace="11111111-1111-4111-8111-111111111111",user="22222222-2222-4222-8222-222222222222";
const plan="33333333-3333-4333-8333-333333333333",id="55555555-5555-4555-8555-555555555555";
const input={quantity:{value:"1.005",unit:"kg",evidence_ids:["source-a"]},factor:"1000",target_unit:"g",conversion_evidence_id:"factor-a",factor_effective_on:"2026-10-15",precision:2};
const record={id,plan_id:plan,workspace_id:workspace,owner_id:user,input,
  result:{operation:"CONVERT_UNIT",value:"1005.00",unit:"g",formula:"1.005*1000",evidence_ids:["source-a","factor-a"],precision:2,rounding:"ROUND_HALF_EVEN"},
  schema_version:"research-conversion/1",state:"calculated",persistence_state:"PERSISTED",input_evidence_state:"CALLER_ASSERTED_NOT_VERIFIED"};
const headers={authorization:"Bearer synthetic","x-workspace-id":workspace,"content-type":"application/json","idempotency-key":"synthetic-conversion"};
const env={SUPABASE_URL:"https://conversion.invalid",SUPABASE_PUBLISHABLE_KEY:"synthetic-public",SUPABASE_SERVICE_ROLE_KEY:"synthetic-service"};
function fixture(t,rpc,role="editor"){t.mock.method(globalThis,"fetch",async(input,init={})=>{
  const url=new URL(input),json=value=>new Response(JSON.stringify(value));
  if(url.pathname==="/auth/v1/user")return json({id:user});
  if(url.pathname==="/rest/v1/workspace_members")return json([{workspace_id:workspace,user_id:user,role}]);
  if(url.pathname==="/rest/v1/workspaces")return json([{lifecycle_state:"active",capability_revision:1}]);
  if(url.pathname==="/rest/v1/workspace_settings")return json([{active_policy_id:plan,policy_version:1}]);
  if(url.pathname==="/rest/v1/rpc/nexus_research_conversion")return rpc(JSON.parse(init.body),json);
  throw new Error(`Unexpected ordinary fixture path ${url.pathname}`);
});}
test("supplied-factor conversion executes and reloads exact units, references and factor date",async t=>{
  fixture(t,(data,json)=>{if(data.p_operation==="create"){assert.deepEqual(data.p_input,input);return json(record);}return json({items:[record],next_after:null});});
  const created=await handle(new Request(`https://gateway.invalid/api/v2/research/plans/${plan}/conversions`,{method:"POST",headers,body:JSON.stringify(input)}),env);
  assert.equal(created.status,201);assert.equal((await created.json()).result.value,"1005.00");
  const listed=await handle(new Request(`https://gateway.invalid/api/v2/research/plans/${plan}/conversions`,{headers}),env);
  assert.equal(listed.status,200);assert.deepEqual((await listed.json()).items[0].input,input);
});
test("unconfirmed conversion is not reported as durably saved",async t=>{
  fixture(t,(_data,json)=>json({...record,persistence_state:"NOT_PERSISTED"}));
  const result=await handle(new Request(`https://gateway.invalid/api/v2/research/plans/${plan}/conversions`,{method:"POST",headers,body:JSON.stringify(input)}),env);
  assert.equal(result.status,503);assert.equal((await result.json()).error.code,"PERSISTENCE_UNCONFIRMED");
});
for(const change of [{factor:"0"},{factor:"-1"},{factor:"0e128"},{factor:1000},{factor:"NaN"},{precision:19},{factor_effective_on:"2026-02-30"},
  {factor_effective_on:"0000-01-01"},{target_unit:""},{conversion_evidence_id:""},{quantity:{...input.quantity,evidence_ids:[]}}])test(`ordinary invalid conversion is actionable ${JSON.stringify(change)}`,()=>{
  assert.throws(()=>validateConversion({...input,...change}),error=>error.status===422 && error.code==="INVALID_CONVERSION");
});
for(const change of [{value:1005},{unit:"kg"},{formula:"inferred conversion"},{evidence_ids:["source-a"]},{precision:6}])test(`incomplete conversion result is not confirmation ${JSON.stringify(change)}`,async t=>{
  fixture(t,(_data,json)=>json({...record,result:{...record.result,...change}}));
  const response=await handle(new Request(`https://gateway.invalid/api/v2/research/plans/${plan}/conversions`,{method:"POST",headers,body:JSON.stringify(input)}),env);
  assert.equal(response.status,503);assert.equal((await response.json()).error.code,"PERSISTENCE_UNCONFIRMED");
});
test("ordinary viewer can read saved conversions but is not offered execution",async t=>{
  let writes=0;fixture(t,(data,json)=>{if(data.p_operation==="create")writes++;return json({items:[record],next_after:null});},"viewer");
  const listed=await handle(new Request(`https://gateway.invalid/api/v2/research/plans/${plan}/conversions`,{headers}),env);assert.equal(listed.status,200);
  const created=await handle(new Request(`https://gateway.invalid/api/v2/research/plans/${plan}/conversions`,{method:"POST",headers,body:JSON.stringify(input)}),env);assert.equal(created.status,403);assert.equal(writes,0);
});
test("missing reviewed conversion schema is an actionable unavailable state",async t=>{
  fixture(t,()=>new Response(JSON.stringify({code:"PGRST202",message:"missing function"}),{status:404}));
  const response=await handle(new Request(`https://gateway.invalid/api/v2/research/plans/${plan}/conversions`,{headers}),env);
  assert.equal(response.status,503);assert.equal((await response.json()).error.code,"MIGRATION_REQUIRED");
});
