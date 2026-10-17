import test from "node:test";
import assert from "node:assert/strict";
import { handle } from "../../apps/gateway/src/preview-worker.js";
import {validateAggregation} from "../../apps/gateway/src/research-aggregations.js";

const workspace="11111111-1111-4111-8111-111111111111",user="22222222-2222-4222-8222-222222222222";
const plan="33333333-3333-4333-8333-333333333333",id="55555555-5555-4555-8555-555555555555";
const input={operation:"AVERAGE",values:[{value:"0.1",unit:"USD",evidence_ids:["source-a"]},
  {value:"0.2",unit:"USD",evidence_ids:["source-b"]}],weights:[],precision:2,missing_value_treatment:"REJECT",grouped:false};
const record={id,plan_id:plan,workspace_id:workspace,owner_id:user,input,
  result:{operation:"AVERAGE",groups:[{group:null,value:"0.15",unit:"USD",expression:"average(0.1,0.2)",
    evidence_ids:["source-a","source-b"],total_count:2,included_count:2,excluded_count:0,rows:[],excluded_input_indices:[],value_display:"ROUND_HALF_EVEN"}],precision:2,
    rounding:"ROUND_HALF_EVEN",missing_value_treatment:"REJECT"},
  schema_version:"research-aggregation/1",state:"calculated",persistence_state:"PERSISTED",input_evidence_state:"CALLER_ASSERTED_NOT_VERIFIED"};
const headers={authorization:"Bearer synthetic","x-workspace-id":workspace,"content-type":"application/json","idempotency-key":"synthetic-aggregation"};
const env={SUPABASE_URL:"https://aggregation.invalid",SUPABASE_PUBLISHABLE_KEY:"synthetic-public",SUPABASE_SERVICE_ROLE_KEY:"synthetic-service"};
function fixture(t,rpc) {
  t.mock.method(globalThis,"fetch",async(input,init={})=>{
    const url=new URL(input),json=value=>new Response(JSON.stringify(value));
    if(url.pathname==="/auth/v1/user")return json({id:user});
    if(url.pathname==="/rest/v1/workspace_members")return json([{workspace_id:workspace,user_id:user,role:"editor"}]);
    if(url.pathname==="/rest/v1/workspaces")return json([{lifecycle_state:"active",capability_revision:1}]);
    if(url.pathname==="/rest/v1/workspace_settings")return json([{active_policy_id:plan,policy_version:1}]);
    if(url.pathname==="/rest/v1/rpc/nexus_research_aggregation")return rpc(JSON.parse(init.body),json);
    throw new Error(`Unexpected ordinary fixture path ${url.pathname}`);
  });
}
test("an aggregate calculation executes and can be reloaded without losing decimal input or lineage",async t=>{
  const calls=[];fixture(t,(data,json)=>{calls.push(data);return json(data.p_operation==="create"?record:{items:[record],next_after:null});});
  const created=await handle(new Request(`https://gateway.invalid/api/v2/research/plans/${plan}/aggregations`,{method:"POST",headers,body:JSON.stringify(input)}),env);
  assert.equal(created.status,201);assert.equal((await created.json()).result.groups[0].value,"0.15");
  assert.deepEqual(calls[0].p_input,input);
  const listed=await handle(new Request(`https://gateway.invalid/api/v2/research/plans/${plan}/aggregations`,{headers}),env);
  assert.equal(listed.status,200);assert.equal((await listed.json()).items[0].id,id);
});
test("unconfirmed aggregate persistence does not produce a saved analysis",async t=>{
  fixture(t,(_data,json)=>json({...record,persistence_state:"NOT_PERSISTED"}));
  const result=await handle(new Request(`https://gateway.invalid/api/v2/research/plans/${plan}/aggregations`,{method:"POST",headers,body:JSON.stringify(input)}),env);
  assert.equal(result.status,503);assert.equal((await result.json()).error.code,"PERSISTENCE_UNCONFIRMED");
});
for(const change of [
  {weights:["1","2"]},{operation:"WEIGHTED_AVERAGE",weights:["1"]},{precision:19},{missing_value_treatment:"IGNORE"},
  {values:[{...input.values[0],value:0.1}]},{values:[{...input.values[0],value:null}]},
  {values:[{...input.values[0],group:"A"}]},{grouped:true},{values:[]},
])test(`ordinary malformed worksheet is actionable: ${JSON.stringify(change)}`,()=>{
  assert.throws(()=>validateAggregation({...input,...change}),error=>error.status===422 && error.code==="INVALID_AGGREGATION");
});
test("grouped weighted input preserves explicit exclusion, exact weights and ordered references",()=>{
  const command={...input,operation:"WEIGHTED_AVERAGE",weights:["1","0"],grouped:true,missing_value_treatment:"EXCLUDE",
    values:input.values.map((q,index)=>({...q,value:index===0?q.value:null,group:"A"}))};
  assert.deepEqual(validateAggregation(command),command);
});
for(const change of [{unit:"kg"},{evidence_ids:["source-b"]},{included_count:1},{excluded_input_indices:[1]},
  {rows:[{value:"0.15",unit:"USD"}]},{value_display:"INPUT_VALUES_UNROUNDED"}])test(`incomplete result is not saved confirmation: ${JSON.stringify(change)}`,async t=>{
  fixture(t,(_data,json)=>json({...record,result:{...record.result,groups:[{...record.result.groups[0],...change}]}}));
  const result=await handle(new Request(`https://gateway.invalid/api/v2/research/plans/${plan}/aggregations`,{method:"POST",headers,body:JSON.stringify(input)}),env);
  assert.equal(result.status,503);assert.equal((await result.json()).error.code,"PERSISTENCE_UNCONFIRMED");
});
test("missing aggregate schema returns an actionable unavailable state",async t=>{
  fixture(t,()=>new Response(JSON.stringify({code:"PGRST202",message:"missing function"}),{status:404}));
  const result=await handle(new Request(`https://gateway.invalid/api/v2/research/plans/${plan}/aggregations`,{headers}),env);
  assert.equal(result.status,503);assert.equal((await result.json()).error.code,"MIGRATION_REQUIRED");
});
test("stored result pages preserve their explicit cursor",async t=>{
  fixture(t,(data,json)=>{assert.equal(data.p_limit,1);assert.equal(data.p_after,id);return json({items:[record],next_after:id});});
  const result=await handle(new Request(`https://gateway.invalid/api/v2/research/plans/${plan}/aggregations?limit=1&after=${id}`,{headers}),env);
  assert.equal(result.status,200);assert.equal((await result.json()).next_after,id);
});
