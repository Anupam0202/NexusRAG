import assert from "node:assert/strict";
import {readFile,mkdtemp,writeFile} from "node:fs/promises";
import {createServer} from "node:http";
import {createHash} from "node:crypto";
import {tmpdir} from "node:os";
import {dirname,resolve,join} from "node:path";
import {fileURLToPath} from "node:url";
import {startLocalWorker} from "./local-worker-harness.mjs";
import {findingPackageClient} from "./finding-package-client.mjs";
const {confirmedFindingPackage,findingPackageDownload}=await findingPackageClient();

// Exact real disposable-SQL output; no hosted credentials or provider requests.
const value=JSON.parse(await readFile(process.argv[2],"utf8"));
const receipt=JSON.parse(await readFile(process.argv[3],"utf8"));
assert.ok(await confirmedFindingPackage(value,value.finding_id,value.workspace_id));
assert.ok(value.manifest_bytes>30000000);
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../.."),calls=[];let release;
const wire=JSON.stringify(value),policy="44444444-4444-4444-8444-444444444444";
const authority=createServer(async(request,response)=>{
  const url=new URL(request.url,"http://localhost");let body="";for await(const chunk of request)body+=chunk;
  calls.push(url.pathname);response.setHeader("content-type","application/json");
  const send=value=>response.end(JSON.stringify(value));
  if(url.pathname==="/auth/v1/user")return send({id:value.requested_by});
  if(url.pathname==="/rest/v1/workspace_members")return send([{workspace_id:value.workspace_id,user_id:value.requested_by,role:"owner"}]);
  if(url.pathname==="/rest/v1/workspaces")return send([{id:value.workspace_id,lifecycle_state:"active",capability_revision:1}]);
  if(url.pathname==="/rest/v1/workspace_settings")return send([{active_policy_id:policy,policy_version:1}]);
  if(url.pathname==="/rest/v1/rpc/nexus_finding_package"){
    const command=JSON.parse(body);assert.equal(command.p_finding,value.finding_id);
    if(command.p_operation==="create_receipt"){
      assert.equal(command.p_revision,value.finding_revision);assert.equal(command.p_key,"native-capacity-package");return send(receipt);
    }
    assert.equal(command.p_operation,"read");assert.equal(command.p_id,value.id);
    response.write(wire.slice(0,1024));release=()=>response.end(wire.slice(1024));return;
  }
  response.statusCode=404;response.end("{}");
});
await new Promise(resolve=>authority.listen(0,"127.0.0.1",resolve));
const directory=await mkdtemp(join(tmpdir(),"nexusrag-finding-package-workerd-")),config=join(directory,"wrangler.json");
await writeFile(config,JSON.stringify({name:"nexusrag-finding-package-fixture",main:join(root,"apps/gateway/src/preview-worker.js"),
  compatibility_date:"2026-09-20",vars:{SUPABASE_URL:`http://127.0.0.1:${authority.address().port}`,SUPABASE_PUBLISHABLE_KEY:"synthetic-public",SUPABASE_SERVICE_ROLE_KEY:"synthetic-service"}}));
let runtime;
try{
  runtime=await startLocalWorker({frontend:join(root,"frontend"),directory,configPath:config});
  const start=performance.now(),response=await fetch(new URL(`/api/v2/findings/${value.finding_id}/packages`,runtime.url),{
    method:"POST",headers:{authorization:"Bearer synthetic","x-workspace-id":value.workspace_id,"Idempotency-Key":"native-capacity-package"},
    body:JSON.stringify({revision:value.finding_revision}),signal:AbortSignal.timeout(15000)});
  assert.equal(response.status,201,`Actual Worker returned ${response.status}`);
  const metadata=await response.json();assert.equal(metadata.schema_version,"finding-package-receipt/1");assert.ok(!Object.hasOwn(metadata,"manifest_text"));
  assert.ok(Buffer.byteLength(JSON.stringify(metadata))<4096);
  const downloadResponse=await fetch(new URL(`/api/v2/findings/${value.finding_id}/packages/${metadata.id}`,runtime.url),{
    headers:{authorization:"Bearer synthetic","x-workspace-id":value.workspace_id},signal:AbortSignal.timeout(15000)});
  assert.equal(downloadResponse.status,200);assert.equal(downloadResponse.headers.get("cache-control"),"private,no-store");
  assert.equal(typeof release,"function");
  if(process.argv.includes("--slow-body"))await new Promise(resolve=>setTimeout(resolve,8100));
  release();
  const saved=await downloadResponse.json();assert.ok(await confirmedFindingPackage(saved,value.finding_id,value.workspace_id));
  assert.equal(saved.manifest_text,value.manifest_text);assert.equal(saved.manifest_hash,value.manifest_hash);
  const download=JSON.parse(findingPackageDownload(saved));assert.equal(download.manifest.evidence.length,156);
  assert.ok(download.manifest.evidence.every(row=>Buffer.byteLength(row.original_text,"utf8")===32768));
  assert.equal(createHash("sha256").update(download.manifest_text).digest("hex"),value.manifest_hash);
  assert.equal(calls.length,10);
  console.log(JSON.stringify({marker:"ACTUAL_WORKER_FINDING_PACKAGE_CAPACITY_PASS",manifest_bytes:saved.manifest_bytes,wire_bytes:Buffer.byteLength(wire),
    full_originals:156,source_versions:60,stream_headers_before_eof:true,creation_receipt_bytes:Buffer.byteLength(JSON.stringify(metadata)),
    elapsed_local_ms:Math.round(performance.now()-start),exact_hash:value.manifest_hash,
    controlled_http_requests:calls.length,production_implementation:true,hosted_provider_quality_cpu_or_memory_acceptance:false}));
}finally{try{if(runtime)await runtime.close();}finally{await new Promise(resolve=>authority.close(resolve));}}
