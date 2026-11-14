import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { handle } from "../../apps/gateway/src/preview-worker.js";
import { sha256 } from "../../apps/gateway/src/worker-pipeline.js";

const workspace="11111111-1111-4111-8111-111111111111",documentId="22222222-2222-4222-8222-222222222222";
const versionId="33333333-3333-4333-8333-333333333333",user="44444444-4444-4444-8444-444444444444";
const env={SUPABASE_URL:"https://supabase.invalid",SUPABASE_PUBLISHABLE_KEY:"synthetic-public",SUPABASE_SERVICE_ROLE_KEY:"synthetic-service",FRONTEND_ORIGIN:"https://frontend.invalid"};
const json=(value,status=200)=>new Response(JSON.stringify(value),{status});
async function fixture() {
  const bytes=new TextEncoder().encode("\uFEFFSynthetic original,not just extracted chunks\r\nmass,1.005\r\n");
  const key=`${workspace}/${documentId}/${versionId}/Synthetic original.csv`;
  const doc={id:documentId,workspace_id:workspace,status:"ready",lifecycle_state:"active",lifecycle_epoch:1,active_version_id:versionId,filename:"Synthetic original.csv",content_type:"text/csv"};
  const version={id:versionId,workspace_id:workspace,document_id:documentId,publication_state:"ready",lifecycle_epoch:1,
    original_bucket:"documents",original_key:key,original_hash:await sha256(bytes),original_bytes:bytes.length,original_verified_at:"2026-10-01T00:00:00Z"};
  const calls=[];let quota="READY",storageStatus=200,storageBody=()=>bytes,settlement="SETTLED";
  const run=async(method="GET",expectedVersion=versionId,signal)=>{
    const previous=globalThis.fetch;
    globalThis.fetch=async(raw,init={})=>{
      const url=new URL(raw);calls.push({url,method:init.method||"GET",body:init.body?JSON.parse(init.body):null});
      if(url.pathname==="/auth/v1/user")return json({id:user});
      if(url.pathname==="/rest/v1/workspace_members")return json([{workspace_id:workspace,user_id:user,role:"viewer"}]);
      if(url.pathname==="/rest/v1/documents")return json([doc]);
      if(url.pathname==="/rest/v1/document_versions")return json([version]);
      if(url.pathname.endsWith("/rpc/v6_reserve_many")) {
        const data=JSON.parse(init.body);
        return json({state:quota,reservations:Object.entries(data.p_dimensions).map(([,amount])=>({id:randomUUID(),amount,replayed:false}))});
      }
      if(url.pathname.endsWith("/rpc/v6_settle_many"))return json({state:settlement});
      if(url.pathname.startsWith("/storage/v1/object/")) {
        assert.equal(decodeURIComponent(url.pathname),`/storage/v1/object/${init.method==="HEAD"?"":"authenticated/"}documents/${key}`);
        if(storageStatus!==200)return json({message:"Synthetic object unavailable"},storageStatus);
        return new Response(init.method==="HEAD"?null:storageBody(),{headers:{"content-length":String(bytes.length),"content-type":"text/csv"}});
      }
      throw Error(`Unexpected synthetic original path ${url.pathname}`);
    };
    try{return await handle(new Request(`https://gateway.invalid/api/v1/documents/${documentId}/original?version_id=${expectedVersion}`,{
      method,signal,headers:{authorization:"Bearer synthetic-user","X-Nexus-Workspace-Id":workspace,origin:env.FRONTEND_ORIGIN}}),env);}
    finally{globalThis.fetch=previous;}
  };
  return{bytes,doc,version,calls,run,setQuota:value=>{quota=value;},setStorageStatus:value=>{storageStatus=value;},
    setStorageBody:value=>{storageBody=value;},setSettlement:value=>{settlement=value;}};
}

test("download returns current original bytes, length and hash rather than reconstructed chunk text",async()=>{
  const f=await fixture(),response=await f.run();
  assert.equal(response.status,200);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()),f.bytes);
  assert.equal(response.headers.get("content-length"),String(f.bytes.length));
  assert.equal(response.headers.get("x-nexus-original-sha256"),f.version.original_hash);
  assert.equal(response.headers.get("x-nexus-original-version"),versionId);
  assert.match(response.headers.get("content-disposition"),/attachment/);
  assert.match(response.headers.get("access-control-expose-headers"),/x-nexus-original-sha256/i);
  const reservation=f.calls.find(call=>call.url.pathname.endsWith("v6_reserve_many"));
  assert.deepEqual(reservation.body.p_dimensions,{requests:1,egress_bytes:f.bytes.length});
  assert.equal(reservation.body.p_provider,"supabase_storage");
});
test("ordinary HEAD reads original metadata without a response body",async()=>{
  const f=await fixture(),response=await f.run("HEAD");
  assert.equal(response.status,200);assert.equal((await response.arrayBuffer()).byteLength,0);
  assert.equal(response.headers.get("content-length"),String(f.bytes.length));
  assert.deepEqual(f.calls.find(call=>call.url.pathname.endsWith("v6_reserve_many")).body.p_dimensions,{requests:1});
});
test("storage quota exhaustion is explicit and never starts the original read",async()=>{
  const f=await fixture();f.setQuota("QUOTA_EXHAUSTED");const response=await f.run();
  assert.equal(response.status,429);assert.equal((await response.json()).error.code,"QUOTA_EXHAUSTED");
  assert.equal(f.calls.some(call=>call.url.pathname.startsWith("/storage/")),false);
});
test("missing stored original is not reported as a successful download",async()=>{
  const f=await fixture();f.setStorageStatus(404);const response=await f.run();
  assert.equal(response.status,404);assert.equal((await response.json()).error.code,"ORIGINAL_UNAVAILABLE");
});
test("an ordinary stale document view asks for refresh after reindex",async()=>{
  const f=await fixture();const response=await f.run("GET","55555555-5555-4555-8555-555555555555");
  assert.equal(response.status,409);assert.equal((await response.json()).error.code,"VERSION_CONFLICT");
  assert.equal(f.calls.some(call=>call.url.pathname.startsWith("/storage/")),false);
});
test("a long Unicode original filename remains downloadable at the truncation boundary",async()=>{
  const f=await fixture();f.doc.filename="a".repeat(179)+"\u{1f4c4}.txt";
  const response=await f.run();assert.equal(response.status,200);
  assert.equal(decodeURIComponent(response.headers.get("x-nexus-original-filename")),"a".repeat(179));
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()),f.bytes);
});
test("truncated and oversized original bodies fail rather than completing a partial transfer",async()=>{
  for(const delta of [-1,1]) {
    const f=await fixture();f.setStorageBody(()=>new Uint8Array(f.bytes.length+delta));
    const response=await f.run();assert.equal(response.status,200);
    await assert.rejects(response.arrayBuffer(),delta<0?/before its declared length/:/exceeded its declared length/);
  }
});
test("ordinary client cancellation cancels the pending Storage body",async()=>{
  const f=await fixture();let cancelled=false;
  f.setStorageBody(()=>new ReadableStream({cancel(){cancelled=true;}}));
  const controller=new AbortController(),response=await f.run("GET",versionId,controller.signal);
  const reading=response.arrayBuffer();controller.abort();await assert.rejects(reading,{name:"AbortError"});
  assert.equal(cancelled,true);
});
test("unconfirmed quota settlement cancels the acquired original and returns no download",async()=>{
  const f=await fixture();let cancelled=false;
  f.setStorageBody(()=>new ReadableStream({cancel(){cancelled=true;}}));f.setSettlement("REVIEW_REQUIRED");
  const response=await f.run();assert.equal(response.status,503);assert.equal((await response.json()).error.code,"REVIEW_REQUIRED");
  assert.equal(cancelled,true);
});
