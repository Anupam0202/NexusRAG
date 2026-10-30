import assert from "node:assert/strict";
import {readFile,mkdtemp,writeFile,rm} from "node:fs/promises";
import {createServer} from "node:http";
import {createHash} from "node:crypto";
import {tmpdir} from "node:os";
import {dirname,resolve,join} from "node:path";
import {fileURLToPath} from "node:url";
import jsonld from "jsonld";
import {startLocalWorker} from "./local-worker-harness.mjs";
import {findingPackageClient} from "./finding-package-client.mjs";
import {normalizeRadarText} from "../../apps/gateway/src/radar-materiality.js";

// Both inputs are exact disposable-SQL outputs. Never synthesize or edit a
// manifest/receipt here, and never load a hosted/customer/provider export.
const [artifactPath,receiptPath,...flags]=process.argv.slice(2);
assert.ok(artifactPath&&!artifactPath.startsWith("--")&&receiptPath&&!receiptPath.startsWith("--"),
  "Usage: node scripts/test-radar-package.mjs <actual-sql-package.json> <actual-sql-receipt.json> [--slow-body]");
assert.ok(flags.every(flag=>flag==="--slow-body")&&new Set(flags).size===flags.length);
const value=JSON.parse(await readFile(artifactPath,"utf8")),receipt=JSON.parse(await readFile(receiptPath,"utf8"));
const {confirmedFindingPackage,confirmedPackageReceipt,findingPackageDownload}=await findingPackageClient();
assert.ok(await confirmedFindingPackage(value,value.finding_id,value.workspace_id));
assert.ok(confirmedPackageReceipt(receipt,value.finding_id,value.workspace_id,value.finding_revision));
const {manifest_text:manifestText,schema_version,...metadata}=value;
assert.equal(schema_version,"finding-package/1");
assert.deepEqual(receipt,{...metadata,schema_version:"finding-package-receipt/1"});
const sha256=text=>createHash("sha256").update(text,"utf8").digest("hex");
assert.equal(Buffer.byteLength(manifestText,"utf8"),value.manifest_bytes);
assert.equal(sha256(manifestText),value.manifest_hash);

const manifest=JSON.parse(manifestText),analysis=manifest.analysis,evidence=manifest.evidence;
assert.equal(analysis.schema_version,"radar-change/1");
assert.equal(analysis.finding_id,value.finding_id);assert.equal(analysis.workspace_id,value.workspace_id);
assert.equal(analysis.status,"CHANGED");assert.equal(analysis.materiality,"REVIEW_REQUIRED");
assert.equal(analysis.review_state,"APPROVED");assert.equal(analysis.source_available,true);
assert.equal(analysis.coverage,"SELECTED_CHUNKS_NOT_FULL_DOCUMENT");
assert.equal(analysis.before.coverage,analysis.coverage);assert.equal(analysis.after.coverage,analysis.coverage);
assert.equal(analysis.before.document_original_bytes,524288000); // retained500MiB bound
assert.equal(analysis.before.chunk_ids.length,156);assert.equal(analysis.before.selected_originals.length,156);
assert.equal(analysis.before.selected_utf8_bytes,156*32768);assert.equal(analysis.before.comparison_complete,false);
assert.equal(analysis.before_chunk_ids.length,155);assert.equal(analysis.after.chunk_ids.length,1);
assert.equal(analysis.after.comparison_complete,true);assert.equal(evidence.length,156);
assert.deepEqual(analysis.before_chunk_ids,analysis.before.chunk_ids.slice(0,155));
assert.notEqual(analysis.previous_hash,analysis.before.normalized_hash,
  "A155-chunk before subset must not claim the full156-chunk snapshot hash.");
assert.notEqual(analysis.previous_selection_hash,analysis.before.selection_hash);
assert.equal(analysis.current_hash,analysis.after.normalized_hash);
assert.equal(analysis.current_selection_hash,analysis.after.selection_hash);
assert.deepEqual(evidence.map(row=>row.id),[...analysis.before_chunk_ids,...analysis.after.chunk_ids]);
assert.equal(new Set(evidence.map(row=>row.id)).size,156);
assert.deepEqual(evidence.map(row=>row.citation_id),Array.from({length:156},(_,i)=>`S${i+1}`));
assert.ok(!evidence.some(row=>row.id===analysis.before.chunk_ids[155]));
const references=new Map([...analysis.before.selected_originals,...analysis.after.selected_originals].map(row=>[row.id,row]));
for(const [index,row] of evidence.entries()){
  const reference=references.get(row.id);assert.ok(reference);
  assert.equal(row.available,true);assert.equal(row.freshness,"current");
  assert.equal(row.document_id,reference.document_id);assert.equal(row.version_id,reference.version_id);
  assert.deepEqual(row.location,reference.location);
  assert.equal(Buffer.byteLength(row.original_text,"utf8"),reference.original_bytes);
  assert.equal(sha256(row.original_text),row.original_content_hash);
  assert.equal(row.original_content_hash,reference.original_content_hash);
  if(index<155)assert.equal(reference.original_bytes,32768);
  else assert.ok(reference.original_bytes>0&&reference.original_bytes<32768);
}
assert.equal(sha256(normalizeRadarText(evidence.slice(0,155).map(row=>row.original_text).join("\n"))),analysis.previous_hash);
assert.equal(sha256(normalizeRadarText(evidence[155].original_text)),analysis.current_hash);
assert.ok(analysis.reviews.some(row=>row.decision==="approved"&&row.revision===analysis.review_revision
  &&row.reviewer_id!==analysis.before.actor_id&&row.reviewer_id!==analysis.after.actor_id));
assert.ok(manifest.reviews.some(row=>row.decision==="approved"&&row.revision===value.finding_revision&&row.reviewer_id!==manifest.author_id));
const versions=[analysis.before.version_id,analysis.after.version_id];
// Package061 keeps the source graph in canonical version-UUID order. Evidence
// and citations separately retain the immutable before/after selection order.
const sourceIds=versions.map(id=>`urn:nexusrag:version:${id}`).sort();
assert.equal(new Set(evidence.map(row=>row.version_id)).size,2);
assert.deepEqual([...new Set(evidence.map(row=>row.version_id))],versions);
assert.deepEqual(manifest["prov:wasDerivedFrom"],sourceIds.map(id=>({"@id":id})));
const activityId=`urn:nexusrag:radar-change:${analysis.id}`;
assert.deepEqual(manifest["prov:wasGeneratedBy"],{"@id":activityId});

// Strict JSON-LD1.1 expansion/RDF of the real client download, including its
// exact manifest_text. Inline contexts must never fetch remote documents.
const downloaded=JSON.parse(findingPackageDownload(value));let remoteLoads=0;
const options={safe:true,documentLoader:async()=>{remoteLoads++;throw Error("Radar package contexts must stay inline.");}};
const expanded=await jsonld.expand(downloaded,options),prov="http://www.w3.org/ns/prov#",ns="https://nexusrag.app/ns/";
assert.equal(expanded.length,1);assert.equal(expanded[0]["@id"],`urn:nexusrag:export:${value.id}`);
const expandedManifest=expanded[0][ns+"manifest"][0];
assert.equal(expandedManifest["@id"],`urn:nexusrag:finding:${value.finding_id}:${value.finding_revision}`);
assert.deepEqual(expandedManifest["@type"],[prov+"Entity"]);
assert.equal(expandedManifest[ns+"analysis"][0]["@type"],"@json");
assert.deepEqual(expandedManifest[ns+"analysis"][0]["@value"],analysis);
assert.deepEqual(expandedManifest[ns+"evidence"][0]["@value"],evidence);
const activities=expandedManifest["@included"].filter(row=>row["@type"].includes(prov+"Activity"));
const entities=expandedManifest["@included"].filter(row=>row["@type"].includes(prov+"Entity"));
assert.equal(activities.length,1);assert.equal(activities[0]["@id"],activityId);
assert.deepEqual(activities[0][prov+"used"].map(row=>row["@id"]),sourceIds);
assert.equal(entities.length,2);assert.deepEqual(entities.map(row=>row["@id"]),sourceIds);
const rdf=await jsonld.toRDF(downloaded,{...options,format:"application/n-quads"});
for(const id of sourceIds){
  assert.ok(rdf.includes(`<${activityId}> <${prov}used> <${id}> .`));
  assert.ok(rdf.includes(`<${manifest["@id"]}> <${prov}wasDerivedFrom> <${id}> .`));
}
assert.ok(rdf.includes(`<${manifest["@id"]}> <${prov}wasGeneratedBy> <${activityId}> .`));
assert.equal(remoteLoads,0);
console.log(JSON.stringify({marker:"RADAR_PACKAGE_JSONLD_PASS",manifest_bytes:value.manifest_bytes,manifest_hash:value.manifest_hash,
  selected_originals:156,full_32768_byte_originals:155,source_versions:2,before_snapshot_originals:156,before_compared_originals:155,
  exact_citations:true,independent_pair_and_finding_reviews:true,strict_jsonld_safe:true,remote_context_loads:remoteLoads,
  prov_source_entities:2,prov_radar_activities:1,hosted_acceptance:false}));

// Exercise the production Gateway under actual local workerd. The controlled
// authority returns exact SQL artifacts; only transport/auth metadata is a fixture.
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../.."),calls=[],authorityErrors=[];
const wire=JSON.stringify(value),policy="44444444-4444-4444-8444-444444444444",intent="radar-native-capacity-package";
let release,released=false;
const authority=createServer(async(request,response)=>{
  response.setHeader("content-type","application/json");
  try{
    const url=new URL(request.url,"http://localhost");let body="";for await(const chunk of request)body+=chunk;
    calls.push({path:url.pathname,method:request.method});const send=data=>response.end(JSON.stringify(data));
    if(url.pathname==="/auth/v1/user"){
      assert.equal(request.method,"GET");assert.equal(request.headers.authorization,"Bearer synthetic-radar");
      assert.equal(request.headers.apikey,"synthetic-public");return send({id:value.requested_by});
    }
    assert.equal(request.headers.authorization,"Bearer synthetic-service");assert.equal(request.headers.apikey,"synthetic-service");
    if(url.pathname==="/rest/v1/workspace_members"){
      assert.equal(request.method,"GET");assert.equal(url.searchParams.get("workspace_id"),`eq.${value.workspace_id}`);
      assert.equal(url.searchParams.get("user_id"),`eq.${value.requested_by}`);assert.equal(url.searchParams.get("limit"),"1");
      return send([{workspace_id:value.workspace_id,user_id:value.requested_by,role:"owner"}]);
    }
    if(url.pathname==="/rest/v1/workspaces"){
      assert.equal(request.method,"GET");assert.equal(url.searchParams.get("id"),`eq.${value.workspace_id}`);
      assert.equal(url.searchParams.get("select"),"capability_revision,lifecycle_state");assert.equal(url.searchParams.get("limit"),"1");
      return send([{id:value.workspace_id,lifecycle_state:"active",capability_revision:1}]);
    }
    if(url.pathname==="/rest/v1/workspace_settings"){
      assert.equal(request.method,"GET");assert.equal(url.searchParams.get("workspace_id"),`eq.${value.workspace_id}`);
      assert.equal(url.searchParams.get("select"),"active_policy_id,policy_version");assert.equal(url.searchParams.get("limit"),"1");
      return send([{active_policy_id:policy,policy_version:1}]);
    }
    assert.equal(url.pathname,"/rest/v1/rpc/nexus_finding_package");assert.equal(request.method,"POST");
    const command=JSON.parse(body),{deadline,...context}=command.p_context;
    assert.deepEqual(context,{workspace_id:value.workspace_id,user_id:value.requested_by,membership_revision:1,policy_id:policy,policy_version:1});
    assert.ok(Date.parse(deadline)>Date.now()&&Date.parse(deadline)<=Date.now()+31000);
    assert.equal(command.p_finding,value.finding_id);assert.equal(command.p_limit,20);assert.equal(command.p_after,null);
    if(command.p_operation==="create_receipt"){
      assert.equal(command.p_id,null);assert.equal(command.p_revision,value.finding_revision);assert.equal(command.p_key,intent);
      assert.ok(Buffer.byteLength(body)<4096);return send(receipt);
    }
    assert.equal(command.p_operation,"read");assert.equal(command.p_id,value.id);
    assert.equal(command.p_revision,null);assert.equal(command.p_key,null);
    response.write(wire.slice(0,1024));release=()=>{if(!released){released=true;response.end(wire.slice(1024));}};
  }catch(error){authorityErrors.push(error);response.statusCode=500;response.end(JSON.stringify({message:"Controlled authority assertion failed."}));}
});
await new Promise(resolve=>authority.listen(0,"127.0.0.1",resolve));
const directory=await mkdtemp(join(tmpdir(),"nexusrag-radar-package-workerd-")),config=join(directory,"wrangler.json");
let runtime;
try{
  await writeFile(config,JSON.stringify({name:"nexusrag-radar-package-fixture",main:join(root,"apps/gateway/src/preview-worker.js"),
    compatibility_date:"2026-09-20",vars:{SUPABASE_URL:`http://127.0.0.1:${authority.address().port}`,
      SUPABASE_PUBLISHABLE_KEY:"synthetic-public",SUPABASE_SERVICE_ROLE_KEY:"synthetic-service"}}));
  runtime=await startLocalWorker({frontend:join(root,"frontend"),directory,configPath:config});
  const start=performance.now(),headers={authorization:"Bearer synthetic-radar","x-workspace-id":value.workspace_id};
  const creation=await fetch(new URL(`/api/v2/findings/${value.finding_id}/packages`,runtime.url),{
    method:"POST",headers:{...headers,"Idempotency-Key":intent},body:JSON.stringify({revision:value.finding_revision}),signal:AbortSignal.timeout(15000)});
  assert.equal(creation.status,201,`Actual Worker returned ${creation.status}: ${authorityErrors.map(error=>error.message).join("; ")}`);
  const savedReceipt=await creation.json();assert.deepEqual(savedReceipt,receipt);
  assert.ok(!Object.hasOwn(savedReceipt,"manifest_text"));assert.ok(Buffer.byteLength(JSON.stringify(savedReceipt))<4096);
  const downloadResponse=await fetch(new URL(`/api/v2/findings/${value.finding_id}/packages/${savedReceipt.id}`,runtime.url),{
    headers,signal:AbortSignal.timeout(20000)});
  assert.equal(downloadResponse.status,200);assert.equal(downloadResponse.headers.get("cache-control"),"private,no-store");
  assert.equal(typeof release,"function");assert.equal(released,false);
  const headersAt=performance.now(),bodyHoldMs=flags.includes("--slow-body")?8100:0;
  if(bodyHoldMs)await new Promise(resolve=>setTimeout(resolve,bodyHoldMs));
  assert.equal(released,false);release();
  const saved=await downloadResponse.json();assert.ok(await confirmedFindingPackage(saved,value.finding_id,value.workspace_id));
  assert.deepEqual(saved,value);assert.equal(saved.manifest_text,manifestText);
  assert.equal(sha256(JSON.parse(findingPackageDownload(saved)).manifest_text),value.manifest_hash);
  assert.deepEqual(authorityErrors,[]);assert.equal(calls.length,10);
  for(const path of ["/auth/v1/user","/rest/v1/workspace_members","/rest/v1/workspaces","/rest/v1/workspace_settings","/rest/v1/rpc/nexus_finding_package"])
    assert.equal(calls.filter(call=>call.path===path).length,2,`Unexpected authority request count for${path}`);
  console.log(JSON.stringify({marker:"ACTUAL_WORKER_RADAR_PACKAGE_PASS",manifest_bytes:saved.manifest_bytes,manifest_hash:saved.manifest_hash,
    wire_bytes:Buffer.byteLength(wire),creation_receipt_bytes:Buffer.byteLength(JSON.stringify(savedReceipt)),controlled_http_requests:calls.length,
    selected_originals:156,full_32768_byte_originals:155,source_versions:2,stream_headers_before_eof:true,rpc_header_timeout_ms:8000,
    body_hold_ms:bodyHoldMs,held_body_observed_ms:Math.round(performance.now()-headersAt),elapsed_local_ms:Math.round(performance.now()-start),
    exact_client_hash:true,production_gateway_implementation:true,hosted_provider_quality_cpu_or_memory_acceptance:false}));
}finally{
  try{if(release)release();if(runtime)await runtime.close();}
  finally{authority.closeAllConnections();await new Promise(resolve=>authority.close(resolve));await rm(directory,{recursive:true,force:true});}
}
