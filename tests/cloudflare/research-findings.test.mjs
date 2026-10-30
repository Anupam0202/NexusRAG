import test from "node:test";
import assert from "node:assert/strict";
import { handle } from "../../apps/gateway/src/preview-worker.js";
const workspace="11111111-1111-4111-8111-111111111111",user="22222222-2222-4222-8222-222222222222";
const finding="33333333-3333-4333-8333-333333333333",run="44444444-4444-4444-8444-444444444444";
const env={SUPABASE_URL:"https://supabase.invalid",SUPABASE_PUBLISHABLE_KEY:"synthetic-public",SUPABASE_SERVICE_ROLE_KEY:"synthetic-secret"};
function fixture(t,onRpc) {
  t.mock.method(globalThis,"fetch",async(input,init={})=>{
    const url=new URL(input),json=value=>new Response(JSON.stringify(value));
    if(url.pathname==="/auth/v1/user")return json({id:user});
    if(url.pathname==="/rest/v1/workspace_members")return json([{workspace_id:workspace,user_id:user,role:"editor"}]);
    if(url.pathname==="/rest/v1/workspaces")return json([{lifecycle_state:"active",capability_revision:7}]);
    if(url.pathname==="/rest/v1/workspace_settings")return json([{active_policy_id:run,policy_version:9}]);
    if(url.pathname.startsWith("/rest/v1/rpc/"))return onRpc(url,JSON.parse(init.body),json);
    throw Error(`Unexpected peer ${url.pathname}`);
  });
}
const request=(path,body)=>new Request(`https://gateway.invalid${path}`,{method:"POST",headers:{authorization:"Bearer synthetic",
  "x-workspace-id":workspace,"Idempotency-Key":"research-finding-retry"},body:JSON.stringify(body)});
test("saved research answer creates a typed finding rather than silently dropping its origin",async t=>{
  fixture(t,(url,data,json)=>{
    if(url.pathname.endsWith("/nexus_research_finding_contract"))return json({schema_version:"research-finding/1"});
    assert.equal(url.pathname,"/rest/v1/rpc/nexus_finding");
    assert.equal(data.p_command.research_run_id,run);assert.equal(data.p_command.result_index,0);
    assert.equal(data.p_command.run_id,undefined);assert.equal(data.p_command.authored_markdown,"");
    assert.equal(data.p_context.workspace_id,workspace);assert.equal(data.p_context.user_id,user);
    return json({id:finding,revision:1,source_research_run_id:run,source_research_position:0});
  });
  const response=await handle(request("/api/v2/findings",{title:"Synthetic saved answer",research_run_id:run,result_index:0}),env);
  assert.equal(response.status,201);
});
test("an older schema is reported before a research answer creates an empty manual note",async t=>{
  let writes=0;
  fixture(t,(url,_data,json)=>{
    if(url.pathname.endsWith("/nexus_research_finding_contract"))return new Response(JSON.stringify({code:"PGRST202",message:"Missing function"}),{status:404});
    writes++;return json({id:finding});
  });
  const response=await handle(request("/api/v2/findings",{title:"Saved answer",research_run_id:run,result_index:0}),env);
  assert.equal(response.status,503);assert.equal((await response.json()).error.code,"MIGRATION_REQUIRED");assert.equal(writes,0);
});
test("ambiguous origin and invalid result indexes are ordinary input errors without writes",async t=>{
  let calls=0;fixture(t,(_url,_data,json)=>{calls++;return json({});});
  for(const input of [{research_run_id:run,result_index:-1},{research_run_id:run,result_index:45},{research_run_id:run,result_index:0.5},
    {research_run_id:run,result_index:0,run_id:run},{result_index:0}]){
    assert.equal((await handle(request("/api/v2/findings",{title:"Saved answer",...input}),env)).status,422);
  }
  assert.equal(calls,0);
});

test("a later comparison batch retains its typed origin within the new storage limit",async t=>{
  fixture(t,(url,data,json)=>{
    if(url.pathname.endsWith("/nexus_research_finding_contract"))return json({schema_version:"research-finding/1",max_result_index:44});
    assert.equal(data.p_command.result_index,44);assert.equal(data.p_command.research_run_id,run);
    return json({id:finding,source_research_run_id:run,source_research_position:44});
  });
  assert.equal((await handle(request("/api/v2/findings",{title:"Later matrix",research_run_id:run,result_index:44}),env)).status,201);
});

test("an older five-result schema reports migration required before saving a later batch",async t=>{
  let writes=0;fixture(t,(url,_data,json)=>{
    if(url.pathname.endsWith("/nexus_research_finding_contract"))return json({schema_version:"research-finding/1"});
    writes++;return json({id:finding});
  });
  const response=await handle(request("/api/v2/findings",{title:"Later matrix",research_run_id:run,result_index:5}),env);
  assert.equal(response.status,503);assert.equal((await response.json()).error.code,"MIGRATION_REQUIRED");assert.equal(writes,0);
});
test("research-backed exports retain the source-rights boundary instead of becoming manual-note exports",async t=>{
  let recorded=0;
  fixture(t,(url,_data,json)=>{
    if(url.pathname.endsWith("/nexus_record_finding_export")){recorded++;return json({id:finding});}
    return json({id:finding,revision:1,title:"Research finding",source_run_id:null,source_research_run_id:run,source_research_position:0,
      authored_markdown:"",generated_markdown:"Synthetic answer [S1]",source_unavailable:false,evidence:[],reviews:[]});
  });
  const response=await handle(request(`/api/v2/findings/${finding}/export`,{}),env);
  assert.equal(response.status,403);assert.equal((await response.json()).error.code,"RIGHTS_BLOCKED");assert.equal(recorded,0);
});
