import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {handle} from "../../apps/gateway/src/preview-worker.js";

const workspace="11111111-1111-4111-8111-111111111111",user="22222222-2222-4222-8222-222222222222";
const finding="33333333-3333-4333-8333-333333333333",policy="44444444-4444-4444-8444-444444444444";
const env={SUPABASE_URL:"https://package-peer.invalid",SUPABASE_PUBLISHABLE_KEY:"synthetic-public",SUPABASE_SERVICE_ROLE_KEY:"synthetic-service"};
const request=(path,init={})=>new Request(`https://gateway.invalid/api/v2/findings/${finding}${path}`,{
  ...init,headers:{authorization:"Bearer synthetic","x-workspace-id":workspace,...init.headers}});
function peer(t,onRpc,role="owner") {
  const calls=[];
  t.mock.method(globalThis,"fetch",async(input,init={})=>{
    const url=new URL(input),reply=value=>new Response(JSON.stringify(value));calls.push({url,init});
    if(url.pathname==="/auth/v1/user")return reply({id:user});
    if(url.pathname==="/rest/v1/workspace_members")return reply([{workspace_id:workspace,user_id:user,role}]);
    if(url.pathname==="/rest/v1/workspaces")return reply([{lifecycle_state:"active",capability_revision:7}]);
    if(url.pathname==="/rest/v1/workspace_settings")return reply([{active_policy_id:policy,policy_version:9}]);
    if(url.pathname.startsWith("/rest/v1/rpc/"))return onRpc(url,JSON.parse(init.body),reply);
    throw Error(`Unexpected controlled peer ${url.pathname}`);
  });return calls;
}
const rights=()=>({schema_version:"finding-export-rights/1",finding_id:finding,revision:3,can_review:true,eligible:false,
  items:[{version_id:policy,document_id:workspace,original_hash:"a".repeat(64),filename:"Owned source.txt",review_id:null,policy:null,allowed:false}],reason:"RIGHTS_REVIEW_REQUIRED"});
function savedPackage(){
  const manifest_text=JSON.stringify({"@id":`urn:nexusrag:finding:${finding}:3`,format:"nexusrag-finding-package/1",finding_id:finding,workspace_id:workspace,revision:3,
    "@context":{"@version":1.1},"@type":"prov:Entity",claim_state:"HUMAN_REVIEWED_NOT_CERTIFICATION",evidence:[{original_text:"Synthetic"}],reviews:[{decision:"approved"}],"@included":[{"@id":`urn:nexusrag:version:${policy}`}],analysis:{answer:"Synthetic"}});
  return {schema_version:"finding-package/1",workspace_id:workspace,state:"ready",finding_id:finding,finding_revision:3,manifest_text,manifest_bytes:Buffer.byteLength(manifest_text),
    serialization:"POSTGRES_JSONB_TEXT_UTF8/1",manifest_hash:createHash("sha256").update(manifest_text).digest("hex"),id:policy,requested_by:user,created_at:"2026-10-25T00:00:00Z",reason:null};
}
const savedReceipt=()=>{const {manifest_text,...rest}=savedPackage();void manifest_text;return {...rest,schema_version:"finding-package-receipt/1"};};
test("a Finding exposes its actual version-bound export review state",async t=>{
  peer(t,(url,data,reply)=>{
    assert.equal(url.pathname,"/rest/v1/rpc/nexus_finding_export_rights");assert.equal(data.p_operation,"read");
    assert.equal(data.p_finding,finding);assert.equal(data.p_context.workspace_id,workspace);assert.equal(data.p_context.user_id,user);
    return reply(rights());
  });
  const response=await handle(request("/export-rights"),env);assert.equal(response.status,200);
  assert.equal((await response.json()).reason,"RIGHTS_REVIEW_REQUIRED");
});
test("an explicitly requested source-linked package uses durable server construction and stable retry intent",async t=>{
  peer(t,(url,data,reply)=>{
    assert.equal(url.pathname,"/rest/v1/rpc/nexus_finding_package");assert.equal(data.p_operation,"create_receipt");
    assert.equal(data.p_finding,finding);assert.equal(data.p_revision,3);assert.equal(data.p_key,"synthetic-package-intent");
    return reply(savedReceipt());
  });
  const response=await handle(request("/packages",{method:"POST",headers:{"Idempotency-Key":"synthetic-package-intent"},body:JSON.stringify({revision:3})}),env);
  assert.equal(response.status,201);assert.equal((await response.json()).finding_revision,3);
});

test("an owner records the exact selected version/review and stable review intent",async t=>{
  peer(t,(url,data,reply)=>{assert.equal(data.p_operation,"record");assert.equal(data.p_key,"review-intent");
    assert.deepEqual(data.p_command.selections,[{version_id:policy,expected_review_id:null}]);return reply(rights());});
  const response=await handle(request("/export-rights",{method:"POST",headers:{"Idempotency-Key":"review-intent"},body:JSON.stringify({revision:3,
    selections:[{version_id:policy,expected_review_id:null}],policy:{decision:"REVIEW_REQUIRED",basis:"UNKNOWN",rationale:"No licence evidence",evidence_reference:"",attribution:"",duties:[],review_by:null}})}),env);
  assert.equal(response.status,201);
});
for(const role of ["editor","viewer"])test(`${role} ordinary view does not offer owner rights-review mutation`,async t=>{
  let reached=false;peer(t,()=>{reached=true;},role);
  const response=await handle(request("/export-rights",{method:"POST",body:"{}"}),env);assert.equal(response.status,403);assert.equal(reached,false);
});
for(const [code,status] of [["RIGHTS_BLOCKED",403],["REVIEW_REQUIRED",409],["SOURCE_UNAVAILABLE",409],["VERSION_CONFLICT",409],["RESOURCE_LIMIT_EXCEEDED",413]])
  test(`${code} remains an explicit package failure`,async t=>{
    peer(t,()=>new Response(JSON.stringify({code:"P0001",message:`NR:${code}`}),{status:400}));
    const response=await handle(request("/packages",{method:"POST",headers:{"Idempotency-Key":"export"},body:'{"revision":3}'}),env);
    assert.equal(response.status,status);assert.equal((await response.json()).error.code,code);
  });
for(const field of ["manifest_hash","manifest_bytes","finding_revision"])test(`unconfirmed ${field} never produces a successful receipt`,async t=>{
  peer(t,(_url,_data,reply)=>reply({...savedReceipt(),[field]:field==="manifest_hash"?"incomplete":field==="manifest_bytes"?33554433:999}));
  const response=await handle(request("/packages",{method:"POST",headers:{"Idempotency-Key":"export"},body:'{"revision":3}'}),env);
  assert.equal(response.status,503);
});
test("large package read returns its stream before EOF without buffering the artifact",async t=>{
  let controller;
  peer(t,(_url,data)=>{assert.equal(data.p_operation,"read");return new Response(new ReadableStream({start(value){controller=value;}}));});
  const response=await Promise.race([handle(request(`/packages/${policy}`),env),new Promise((_,reject)=>setTimeout(()=>reject(Error("Package route buffered an unfinished response")),1000))]);
  assert.equal(response.status,200);assert.equal(response.headers.get("cache-control"),"private,no-store");
  controller.enqueue(new TextEncoder().encode(JSON.stringify(savedPackage())));controller.close();
  assert.deepEqual(await response.json(),savedPackage());
});
test("revocation withholds manifest content while retaining the package receipt",async t=>{
  peer(t,(_url,data,reply)=>{assert.equal(data.p_operation,"read");return reply({...savedPackage(),state:"expired",reason:"RIGHTS_BLOCKED",manifest_text:null});});
  const response=await handle(request(`/packages/${policy}`),env);assert.equal(response.status,200);assert.equal((await response.json()).manifest_text,null);
});
