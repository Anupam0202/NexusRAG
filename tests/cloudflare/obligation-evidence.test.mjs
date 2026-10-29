import test from "node:test";
import assert from "node:assert/strict";
import {allowRequest,handle} from "../../apps/gateway/src/preview-worker.js";
import {servingIntentHash,servingIntentSerialization} from "../../apps/gateway/src/serving-intent.js";
import vectors from "../fixtures/serving-intent-vectors.json" with {type:"json"};
import {obligationIds as ids,obligationContract,obligationDetail,obligationWithheld,obligationSummary,obligationRights,servingPolicy} from "../fixtures/obligation-evidence-data.mjs";
const env={SUPABASE_URL:"https://obligation-peer.invalid",SUPABASE_PUBLISHABLE_KEY:"synthetic-public",SUPABASE_SERVICE_ROLE_KEY:"synthetic-service"};
const request=(path,init={})=>new Request(`https://gateway.invalid${path}`,{...init,headers:{authorization:"Bearer synthetic","x-workspace-id":ids.workspace,...init.headers}});
const rest=(suffix="")=>`/api/v2/obligations${suffix}`,detailPath=()=>rest(`/${ids.finding}?revision=3`);
const rightsPath=(action="SERVE_API")=>`/api/v2/findings/${ids.finding}/serving-rights?action=${action}`;
const list=(items=[],action="SERVE_API",next_after=null)=>({schema_version:"obligation-evidence-list/1",workspace_id:ids.workspace,action,items,next_after});
function peer(t,{role="owner",actor=ids.user,contract=obligationContract(),onReader=(_body,reply)=>reply(list()),onRights=(_body,reply)=>reply(obligationRights()),auditFails=false}={}){
  const calls=[];t.mock.method(globalThis,"fetch",async(input,init={})=>{
    const url=new URL(input),body=init.body?JSON.parse(init.body):null,reply=value=>new Response(JSON.stringify(value));calls.push({url,body});
    if(url.pathname==="/auth/v1/user")return reply({id:actor});
    if(url.pathname==="/rest/v1/workspace_members")return reply([{workspace_id:ids.workspace,user_id:actor,role}]);
    if(url.pathname==="/rest/v1/workspaces")return reply([{lifecycle_state:"active",capability_revision:7}]);
    if(url.pathname==="/rest/v1/workspace_settings")return reply([{active_policy_id:ids.policy,policy_version:9}]);
    if(url.pathname==="/rest/v1/rpc/nexus_obligation_evidence_contract")return contract instanceof Response?contract:reply(contract);
    if(url.pathname==="/rest/v1/rpc/nexus_obligation_evidence")return onReader(body,reply);
    if(url.pathname==="/rest/v1/rpc/nexus_finding_serving_rights")return onRights(body,reply);
    if(url.pathname==="/rest/v1/audit_events")return auditFails?new Response("{}",{status:503}):reply([]);
    throw Error(`Unexpected controlled peer ${url.pathname}`);
  });return calls;
}
async function confirmation(body,changes={}){return {schema_version:"finding-serving-rights-confirmation/1",finding_id:ids.finding,finding_revision:body.p_revision,action:body.p_action,actor_id:ids.user,
  review_ids:[ids.policy],serialization:servingIntentSerialization,intent_hash:await servingIntentHash({finding_id:ids.finding,finding_revision:body.p_revision,action:body.p_action,actor_id:ids.user,command:body.p_command}),...changes};}
test("shared compact intent encoder independently matches fixed Python UTF8 vectors",async()=>{
  assert.equal(vectors.serialization,servingIntentSerialization);
  for(const {intent,sha256} of vectors.vectors)assert.equal(await servingIntentHash(intent),sha256);
});
test("typed metadata pages use the domain RPC before pagination and audit only identities",async t=>{
  const item=obligationSummary(),calls=peer(t,{role:"viewer",onReader:(body,reply)=>{
    assert.equal(body.p_operation,"list");assert.equal(body.p_action,"SERVE_API");assert.equal(body.p_limit,20);assert.equal(body.p_finding,null);
    assert.equal(body.p_context.workspace_id,ids.workspace);assert.equal(body.p_context.user_id,ids.user);assert.equal(body.p_context.membership_revision,7);return reply(list([item]));
  }});
  const response=await handle(request(rest()),env);assert.equal(response.status,200);assert.deepEqual((await response.json()).items,[item]);
  assert.equal(calls.filter(row=>row.url.pathname.includes("/rpc/nexus_obligation_evidence")).length,2);assert.equal(calls.some(row=>/account|research_runs|document_chunks|\/findings$/.test(row.url.pathname)),false);
  const audit=calls.find(row=>row.url.pathname.endsWith("/audit_events")).body[0];assert.equal(audit.metadata.serving_action,"SERVE_API");assert.equal(audit.resource_id,null);assert.equal(JSON.stringify(audit).includes("Synthetic reviewed"),false);
});
test("REST and custom MCP preserve maximum canonical fields with distinct serving actions",async t=>{
  const calls=peer(t,{onReader:(body,reply)=>reply(obligationDetail(body.p_action))});
  const response=await handle(request(detailPath()),env),restValue=await response.json();assert.equal(response.status,200);
  const mcpResponse=await handle(request("/api/v2/mcp/execute",{method:"POST",body:JSON.stringify({operation:"obligation_lookup",finding_id:ids.finding,revision:3,action:"SERVE_API"})}),env),mcp=await mcpResponse.json();
  assert.equal(mcpResponse.status,200);assert.equal(mcp.action,"SERVE_MCP");assert.equal(mcp.protocol,"nexusrag-evidence-mcp/1");assert.deepEqual(mcp.result,restValue.result);
  assert.equal(restValue.result.obligations.candidates.length,12);assert.equal(restValue.source_snapshot.length,50);assert.equal(restValue.rights.length,50);assert.equal(Buffer.byteLength(restValue.evidence.at(-1).original_text),32768);
  assert.equal(restValue.result.obligations.candidates.at(-1).control_state,"PROPOSED_NOT_IMPLEMENTED");assert.deepEqual(calls.filter(row=>row.url.pathname.endsWith("/nexus_obligation_evidence")).map(row=>row.body.p_action),["SERVE_API","SERVE_MCP"]);
});
for(const state of ["SOURCE_UNAVAILABLE","REVIEW_REQUIRED","RIGHTS_BLOCKED"])test(`${state} metadata remains visible without content`,async t=>{
  peer(t,{onReader:(_body,reply)=>reply(obligationWithheld(state))});const response=await handle(request(detailPath()),env);assert.equal(response.status,200);const value=await response.json();
  assert.equal(value.state,state);assert.equal(value.result,null);assert.equal(value.title,null);assert.equal(value.source_snapshot,null);assert.deepEqual(value.evidence,[]);assert.deepEqual(value.reviews,[]);assert.deepEqual(value.rights,[]);
});
test("HEAD checks exact-current state with no response body",async t=>{
  peer(t,{onReader:(_body,reply)=>reply(obligationWithheld())});const response=await handle(request(detailPath(),{method:"HEAD"}),env);assert.equal(response.status,200);assert.equal(await response.text(),"");assert.match(response.headers.get("cache-control"),/no-store/);
});
for(const [name,value] of [["missing",null],["wrong schema",{schema_version:"obligation-evidence/0"}],["reduced cap",{...obligationContract(),max_sources:10}]])test(`${name} contract cannot advertise or execute the reader`,async t=>{
  const calls=peer(t,{contract:value}),response=await handle(request(rest()),env);assert.equal(response.status,503);assert.equal((await response.json()).error.code,"MIGRATION_REQUIRED");
  const discovery=await(await handle(request("/api/v2/mcp/operations"),env)).json();assert.equal(discovery.operations.some(row=>row.name==="obligation_lookup"),false);assert.ok(discovery.unavailable_operations.includes("obligation_lookup"));assert.equal(calls.some(row=>row.url.pathname.endsWith("/nexus_obligation_evidence")),false);
});
test("missing RPC is migration-required",async t=>{
  peer(t,{contract:new Response(JSON.stringify({code:"PGRST202",message:"missing contract"}),{status:404})});const response=await handle(request(rest()),env);assert.equal(response.status,503);assert.equal((await response.json()).error.code,"MIGRATION_REQUIRED");
});
test("available discovery adds only the implemented typed domain operation",async t=>{
  peer(t);const response=await handle(request("/api/v2/mcp/operations"),env);assert.equal(response.status,200);const value=await response.json();assert.deepEqual(value.operations.map(row=>row.name).sort(),["claim_retrieval","finding_retrieval","obligation_lookup"]);
  assert.equal(value.obligation_evidence.available,true);assert.ok(value.unavailable_operations.includes("procurement_lookup"));assert.ok(value.unavailable_operations.includes("passport_retrieval"));
});
for(const path of [rest("?limit=0"),rest("?limit=51"),rest("?limit=1.2"),rest("?after=invalid"),rest(`/${ids.finding}`),rest(`/${ids.finding}?revision=0`),rest("?revision=3")])test(`invalid selection ${path} fails before storage`,async t=>{
  const calls=peer(t),response=await handle(request(path),env);assert.equal(response.status,422);assert.equal(calls.some(row=>row.url.pathname.includes("/rpc/")),false);
});
for(const mutate of [value=>{value.workspace_id=ids.finding;},value=>{value.revision=4;},value=>{value.result.obligations.candidates[0].control_state="IMPLEMENTED";},value=>{value.evidence[0].original_content_hash="f".repeat(64);},
  value=>{value.rights.pop();},value=>{value.title="Private title";value.state="RIGHTS_BLOCKED";value.rights_state="RIGHTS_BLOCKED";},value=>{Object.assign(value,obligationWithheld());value.generated_markdown="unexpected content";}])test("unconfirmed or improperly withheld detail never returns content",async t=>{
  const value=obligationDetail();mutate(value);peer(t,{onReader:(_body,reply)=>reply(value)});const response=await handle(request(detailPath()),env);assert.equal(response.status,503);assert.equal((await response.json()).error.code,"PERSISTENCE_UNCONFIRMED");
});
test("metadata pages cannot expose a full Finding alias",async t=>{peer(t,{onReader:(_body,reply)=>reply(list([{...obligationSummary(),title:"unexpected source title"}]))});assert.equal((await handle(request(rest()),env)).status,503);});
test("read audit failure does not invent persistence or discard an authorized result",async t=>{
  peer(t,{onReader:(_body,reply)=>reply(obligationWithheld()),auditFails:true});const response=await handle(request(detailPath()),env);assert.equal(response.status,200);assert.equal(Object.hasOwn(await response.json(),"audit_receipt"),false);
});
test("compact immutable intent confirmation and current rights remain separate on replay",async t=>{
  const first=obligationRights(),selection={version_id:first.items[0].version_id,original_hash:first.items[0].original_hash,expected_review_id:first.items[0].review_id};
  peer(t,{onRights:async(body,reply)=>{
    assert.equal(body.p_operation,"record");assert.equal(body.p_action,"SERVE_MCP");assert.equal(body.p_revision,3);assert.equal(body.p_key,"stable-serving-intent");assert.deepEqual(body.p_command.selections,[selection]);
    const current=obligationRights("SERVE_MCP");current.revision=4;current.eligible=false;current.items[0]={...current.items[0],allowed:false,state:"REVOKED",policy:{...servingPolicy(),decision:"REVOKED"}};
    return reply({...current,confirmed_review:await confirmation(body)});
  }});
  const response=await handle(request(rightsPath("SERVE_MCP"),{method:"POST",headers:{"Idempotency-Key":"stable-serving-intent"},body:JSON.stringify({revision:3,selections:[selection],policy:servingPolicy(),user_id:ids.finding})}),env);
  assert.equal(response.status,201);const value=await response.json();assert.equal(value.eligible,false);assert.equal(value.revision,4);assert.equal(value.confirmed_review.finding_revision,3);assert.equal(Object.hasOwn(value.confirmed_review,"command"),false);
});
test("each serving action has a separate current rights projection and metadata-only read audit",async t=>{
  const calls=peer(t,{onRights:(body,reply)=>reply(obligationRights(body.p_action))});for(const action of ["SERVE_API","SERVE_MCP"]){const response=await handle(request(rightsPath(action)),env);assert.equal(response.status,200);assert.equal((await response.json()).action,action);}
  const audits=calls.filter(row=>row.url.pathname.endsWith("/audit_events")).map(row=>row.body[0]);assert.equal(audits.length,2);assert.ok(audits.every(row=>row.action==="finding.serving_rights.read"&&row.resource_id===ids.finding&&row.metadata.revision===3));
  assert.deepEqual(audits.map(row=>row.metadata.serving_action),["SERVE_API","SERVE_MCP"]);assert.equal(JSON.stringify(audits).includes("Synthetic owner-held"),false);
});
test("empty rights metadata is unconfirmed for a genuine origin",async t=>{peer(t,{onRights:(_body,reply)=>reply({...obligationRights(),items:[],eligible:false})});assert.equal((await handle(request(rightsPath()),env)).status,503);});
for(const role of ["viewer","editor"])test(`${role} cannot record workspace serving rights`,async t=>{const calls=peer(t,{role}),response=await handle(request(rightsPath(),{method:"POST",body:"{}"}),env);assert.equal(response.status,403);assert.equal(calls.some(row=>row.url.pathname.includes("/rpc/")),false);});
test("rights action and exact original hash are required before mutation",async t=>{
  const calls=peer(t);assert.equal((await handle(request(`/api/v2/findings/${ids.finding}/serving-rights`),env)).status,422);
  const response=await handle(request(rightsPath(),{method:"POST",headers:{"Idempotency-Key":"bad-hash"},body:JSON.stringify({revision:3,selections:[{version_id:ids.policy,expected_review_id:null}],policy:servingPolicy()})}),env);
  assert.equal(response.status,422);assert.equal(calls.some(row=>row.url.pathname.includes("/rpc/")),false);
});
test("a hash for another persisted command cannot confirm the submitted intent",async t=>{
  const right=obligationRights(),selection={version_id:right.items[0].version_id,original_hash:right.items[0].original_hash,expected_review_id:right.items[0].review_id};
  peer(t,{onRights:async(body,reply)=>reply({...right,confirmed_review:await confirmation(body,{intent_hash:"a".repeat(64)})})});
  const response=await handle(request(rightsPath(),{method:"POST",headers:{"Idempotency-Key":"wrong-receipt"},body:JSON.stringify({revision:3,selections:[selection],policy:servingPolicy()})}),env);assert.equal(response.status,503);
});
test("compact confirmations cannot retain a plaintext command or policy copy",async t=>{
  const right=obligationRights(),selection={version_id:right.items[0].version_id,original_hash:right.items[0].original_hash,expected_review_id:null};
  peer(t,{onRights:async(body,reply)=>reply({...right,confirmed_review:await confirmation(body,{command:body.p_command})})});
  const response=await handle(request(rightsPath(),{method:"POST",headers:{"Idempotency-Key":"unexpected-plaintext"},body:JSON.stringify({revision:3,selections:[selection],policy:servingPolicy()})}),env);assert.equal(response.status,503);
});
test("expired same-intent ALLOW reaches SQL and returns current EXPIRED without restoring eligibility",async t=>{
  const right=obligationRights(),selection={version_id:right.items[0].version_id,original_hash:right.items[0].original_hash,expected_review_id:null},policy={...servingPolicy(),review_by:"2020-01-01T00:00:00.000Z"};
  peer(t,{onRights:async(body,reply)=>{const current=obligationRights();current.eligible=false;current.items[0]={...current.items[0],policy,allowed:false,state:"EXPIRED"};return reply({...current,confirmed_review:await confirmation(body)});}});
  const response=await handle(request(rightsPath(),{method:"POST",headers:{"Idempotency-Key":"expired-original-intent"},body:JSON.stringify({revision:3,selections:[selection],policy})}),env);
  assert.equal(response.status,201);const value=await response.json();assert.equal(value.eligible,false);assert.equal(value.items[0].state,"EXPIRED");
});
for(const source_state of ["CURRENT","UNAVAILABLE_OR_CHANGED"])test(`opaque old intent confirms a ${source_state} erased head without older ALLOW resurrection`,async t=>{
  const original=obligationRights(),selection={version_id:original.items[0].version_id,original_hash:original.items[0].original_hash,expected_review_id:null};
  peer(t,{actor:ids.user,onRights:async(body,reply)=>{
    const current=obligationRights();current.source_state=source_state;current.eligible=false;
    current.items[0]={...current.items[0],policy:null,policy_erased_at:"2026-10-28T17:50:00.000Z",allowed:false,state:source_state==="CURRENT"?"REVOKED":"SOURCE_UNAVAILABLE"};
    return reply({...current,confirmed_review:await confirmation(body)});
  }});
  const response=await handle(request(rightsPath(),{method:"POST",headers:{"Idempotency-Key":"erased-original-intent"},body:JSON.stringify({revision:3,selections:[selection],policy:servingPolicy()})}),env);
  assert.equal(response.status,201);const value=await response.json();assert.equal(value.eligible,false);assert.equal(value.items[0].policy,null);
  assert.equal(value.items[0].policy_erased_at,"2026-10-28T17:50:00.000Z");assert.equal(Object.hasOwn(value.confirmed_review,"command"),false);
});
for(const mutation of [row=>{delete row.policy_erased_at;},row=>{row.policy_erased_at="invalid";},row=>{row.allowed=true;row.state="ALLOWED";},
  row=>{row.policy=servingPolicy();},row=>{row.state="DENIED";}])test("unconfirmed erased-head metadata never restores serving rights",async t=>{
  const current=obligationRights();current.eligible=false;current.items[0]={...current.items[0],policy:null,policy_erased_at:"2026-10-28T17:50:00.000Z",allowed:false,state:"REVOKED"};
  mutation(current.items[0]);peer(t,{onRights:(_body,reply)=>reply(current)});const response=await handle(request(rightsPath()),env);assert.equal(response.status,503);assert.equal((await response.json()).error.code,"PERSISTENCE_UNCONFIRMED");
});
test("malformed version types yield422 before RPC",async t=>{
  const calls=peer(t,{actor:"88888888-8888-4888-8888-888888888888"});for(const version_id of [17,{},null])assert.equal((await handle(request(rightsPath(),{method:"POST",headers:{"Idempotency-Key":"invalid-version"},body:JSON.stringify({revision:3,selections:[{version_id,original_hash:"a".repeat(64),expected_review_id:null}],policy:servingPolicy()})}),env)).status,422);
  assert.equal(calls.some(row=>row.url.pathname.includes("/rpc/")),false);
});
test("unsupported nested rights fields fail before they can be omitted from an intent hash",async t=>{
  const right=obligationRights(),selection={version_id:right.items[0].version_id,original_hash:right.items[0].original_hash,expected_review_id:null},calls=peer(t,{actor:"aaaaaaa1-1111-4111-8111-111111111111"});
  for(const data of [{revision:3,selections:[{...selection,future_meaning:"unknown"}],policy:servingPolicy()},{revision:3,selections:[selection],policy:{...servingPolicy(),future_meaning:"unknown"}}]){
    const response=await handle(request(rightsPath(),{method:"POST",headers:{"Idempotency-Key":"unsupported-field"},body:JSON.stringify(data)}),env);assert.equal(response.status,422);
  }
  assert.equal(calls.some(row=>row.url.pathname.includes("/rpc/")),false);
});
test("actual60-request bucket returns conservative Retry-After before storage",async t=>{
  const actor="77777777-7777-4777-8777-777777777777",calls=peer(t,{actor});for(let i=0;i<60;i++)assert.equal(allowRequest(actor),true);
  const response=await handle(request(rest()),env);assert.equal(response.status,429);assert.equal(response.headers.get("retry-after"),"60");assert.equal((await response.json()).error.retryable,true);assert.equal(calls.length,1);
});
test("the configured frontend can inspect Retry-After across origins",async t=>{
  const actor="77777771-7777-4777-8777-777777777777";peer(t,{actor});for(let i=0;i<60;i++)assert.equal(allowRequest(actor),true);
  const origin="https://frontend.invalid",response=await handle(request(rest(),{headers:{origin}}),{...env,FRONTEND_ORIGIN:origin});
  assert.equal(response.status,429);assert.equal(response.headers.get("access-control-allow-origin"),origin);assert.equal(response.headers.get("access-control-expose-headers"),"retry-after");
  assert.equal(response.headers.get("retry-after"),"60");
});
