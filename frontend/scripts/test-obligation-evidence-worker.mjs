// Actual local Worker transport with synthetic auth/storage peers. This does
// not execute SQL, hosted users/providers or standard MCP interoperability.
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {mkdtemp,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {dirname,join,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {startLocalWorker} from "./local-worker-harness.mjs";
import {servingIntentHash,servingIntentSerialization} from "../../apps/gateway/src/serving-intent.js";
import {obligationIds as ids,obligationContract,obligationDetail,obligationSummary,obligationWithheld,obligationRights,servingPolicy} from "../../tests/fixtures/obligation-evidence-data.mjs";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../.."),directory=await mkdtemp(join(tmpdir(),"nexusrag-obligation-reader-workerd-"));
const max=obligationDetail(),missing=obligationWithheld(),calls=[],peerErrors=[];
let missingContract=false,withheld=false,revoked=false,erased=false,sourceGone=false,writeCount=0,originalReceipt=null;
const revokedHeadId="ae444400-0000-4000-8100-000000000001";
const peer=createServer(async(request,response)=>{
  const json=(value,status=200)=>{response.writeHead(status,{"content-type":"application/json"});response.end(JSON.stringify(value));};
  try{
    const chunks=[];for await(const chunk of request)chunks.push(chunk);
    const body=JSON.parse(Buffer.concat(chunks).toString("utf8")||"{}"),url=new URL(request.url,"http://localhost");calls.push({path:url.pathname,body});
    if(url.pathname==="/auth/v1/user")return json({id:request.headers.authorization==="Bearer saturated"?"99999999-9999-4999-8999-999999999999":ids.user});
    if(url.pathname==="/rest/v1/workspace_members")return json([{workspace_id:ids.workspace,user_id:url.searchParams.get("user_id")?.replace(/^eq\./,"")||ids.user,role:"owner"}]);
    if(url.pathname==="/rest/v1/workspaces")return json([{lifecycle_state:"active",capability_revision:7}]);
    if(url.pathname==="/rest/v1/workspace_settings")return json([{active_policy_id:ids.policy,policy_version:9}]);
    if(url.pathname==="/rest/v1/rpc/nexus_obligation_evidence_contract")return missingContract?json({code:"PGRST202",message:"missing063"},404):json(obligationContract());
    if(url.pathname==="/rest/v1/rpc/nexus_obligation_evidence"){
      assert.equal(body.p_context.workspace_id,ids.workspace);assert.equal(body.p_context.user_id,ids.user);assert.ok(["SERVE_API","SERVE_MCP"].includes(body.p_action));
      if(body.p_operation==="list")return json({schema_version:"obligation-evidence-list/1",workspace_id:ids.workspace,action:body.p_action,items:[obligationSummary(withheld?missing:max)],next_after:null});
      assert.equal(body.p_finding,ids.finding);assert.equal(body.p_revision,3);return json({...(sourceGone?obligationWithheld("SOURCE_UNAVAILABLE"):withheld?missing:max),action:body.p_action});
    }
    if(url.pathname==="/rest/v1/rpc/nexus_finding_serving_rights"){
      assert.equal(body.p_finding,ids.finding);const value=obligationRights(body.p_action);
      if(body.p_operation==="record"){
        assert.equal(body.p_key,"synthetic-stable-serving-intent");assert.equal(body.p_revision,3);
        const intent_hash=await servingIntentHash({finding_id:ids.finding,finding_revision:body.p_revision,action:body.p_action,actor_id:ids.user,command:body.p_command});
        if(!originalReceipt){writeCount++;originalReceipt={schema_version:"finding-serving-rights-confirmation/1",finding_id:ids.finding,finding_revision:3,
          action:body.p_action,actor_id:ids.user,review_ids:[ids.policy],intent_hash,serialization:servingIntentSerialization};}
        else assert.equal(intent_hash,originalReceipt.intent_hash);
        value.confirmed_review=originalReceipt;
      }
      if(originalReceipt)value.items[0]={...value.items[0],review_id:originalReceipt.review_ids[0]};
      // A later immutable human decision is a distinct head, not an in-place
      // rewrite of the ALLOW receipt. Lifecycle erasure retains that latest id.
      if(revoked){value.eligible=false;value.items[0]={...value.items[0],review_id:revokedHeadId,created_at:"2026-10-28T17:49:00.000Z",state:"REVOKED",allowed:false,policy:{...servingPolicy(),decision:"REVOKED"}};}
      if(erased){value.eligible=false;value.items[0]={...value.items[0],policy:null,policy_erased_at:"2026-10-28T17:50:00.000Z",allowed:false,state:"REVOKED"};}
      if(sourceGone){value.source_state="UNAVAILABLE_OR_CHANGED";value.eligible=false;value.items=value.items.map(row=>({...row,allowed:false,state:"SOURCE_UNAVAILABLE"}));}
      return json(value);
    }
    if(url.pathname==="/rest/v1/audit_events")return json([]);
    throw Error(`Unexpected controlled peer path ${url.pathname}`);
  }catch(error){peerErrors.push(String(error));json({message:"Controlled peer assertion failed."},500);}
});
await new Promise(resolve=>peer.listen(0,"127.0.0.1",resolve));
const base=`http://127.0.0.1:${peer.address().port}`,entry=join(directory,"reader-entry.mjs"),config=join(directory,"wrangler.json");
await writeFile(entry,`import worker from ${JSON.stringify(join(root,"apps/gateway/src/preview-worker.js"))};
const ordinary=globalThis.fetch;globalThis.fetch=(input,init)=>{const url=new URL(input instanceof Request?input.url:input);
 if(url.origin!==${JSON.stringify(base)})throw Error("Only the explicit local synthetic peer is configured.");return ordinary(input,init);};
export default worker;`);
await writeFile(config,JSON.stringify({name:"nexusrag-synthetic-obligation-reader",main:entry,compatibility_date:"2026-09-20",vars:{SUPABASE_URL:base,SUPABASE_PUBLISHABLE_KEY:"synthetic-public",SUPABASE_SERVICE_ROLE_KEY:"synthetic-service"}}));
let runtime,port,failure,successReport,requests=0,maxBytes=0;
try{
  runtime=await startLocalWorker({frontend:join(root,"frontend"),directory,configPath:config});port=runtime.port;
  const call=async(path,init={})=>{
    requests++;const response=await fetch(`http://127.0.0.1:${port}${path}`,{...init,headers:{authorization:"Bearer synthetic","x-workspace-id":ids.workspace,...init.headers},signal:AbortSignal.timeout(15000)});
    const raw=await response.text();maxBytes=Math.max(maxBytes,Buffer.byteLength(raw));return {response,raw,value:raw?JSON.parse(raw):null};
  };
  const discovery=await call("/api/v2/mcp/operations");assert.equal(discovery.response.status,200);assert.ok(discovery.value.operations.some(row=>row.name==="obligation_lookup"));
  const ready=await call(`/api/v2/obligations/${ids.finding}?revision=3`);assert.equal(ready.response.status,200);assert.deepEqual(ready.value,max);
  const mcp=await call("/api/v2/mcp/execute",{method:"POST",body:JSON.stringify({operation:"obligation_lookup",finding_id:ids.finding,revision:3})});
  assert.equal(mcp.response.status,200);assert.equal(mcp.value.action,"SERVE_MCP");assert.equal(mcp.value.protocol,"nexusrag-evidence-mcp/1");assert.deepEqual(mcp.value.result,ready.value.result);
  assert.equal(mcp.value.source_snapshot.length,50);assert.equal(mcp.value.result.obligations.candidates.length,12);assert.equal(Buffer.byteLength(mcp.value.evidence.at(-1).original_text),32768);
  withheld=true;
  const later=await call(`/api/v2/obligations/${ids.finding}?revision=3`);assert.equal(later.response.status,200);assert.equal(later.value.state,"RIGHTS_BLOCKED");assert.equal(later.value.result,null);assert.equal(later.value.title,null);
  assert.equal(later.value.rights.length,0);assert.equal(later.value.evidence.length,0);
  const page=await call("/api/v2/obligations?limit=50");assert.equal(page.response.status,200);assert.deepEqual(page.value.items,[obligationSummary(missing)]);
  const head=await call(`/api/v2/obligations/${ids.finding}?revision=3`,{method:"HEAD"});assert.equal(head.response.status,200);assert.equal(head.raw,"");assert.match(head.response.headers.get("cache-control"),/no-store/);
  const original=obligationRights().items[0],body={revision:3,selections:[{version_id:original.version_id,original_hash:original.original_hash,expected_review_id:original.review_id}],policy:servingPolicy()};
  const write=()=>call(`/api/v2/findings/${ids.finding}/serving-rights?action=SERVE_API`,{method:"POST",headers:{"Idempotency-Key":"synthetic-stable-serving-intent"},body:JSON.stringify(body)});
  const first=await write();assert.equal(first.response.status,201);assert.equal(first.value.confirmed_review.actor_id,ids.user);assert.equal(first.value.eligible,true);assert.equal(Object.hasOwn(first.value.confirmed_review,"command"),false);
  revoked=true;const replay=await write();assert.equal(replay.response.status,201);assert.deepEqual(replay.value.confirmed_review,first.value.confirmed_review);assert.equal(replay.value.eligible,false);assert.equal(writeCount,1);
  erased=true;const erasedReplay=await write();assert.equal(erasedReplay.response.status,201);assert.deepEqual(erasedReplay.value.confirmed_review,first.value.confirmed_review);
  assert.equal(erasedReplay.value.eligible,false);assert.equal(erasedReplay.value.items[0].policy,null);assert.equal(erasedReplay.value.items[0].state,"REVOKED");
  assert.equal(erasedReplay.value.items[0].policy_erased_at,"2026-10-28T17:50:00.000Z");assert.equal(erasedReplay.value.items[0].review_id,revokedHeadId);
  assert.notEqual(erasedReplay.value.items[0].review_id,first.value.confirmed_review.review_ids[0]);
  sourceGone=true;const sourceGoneReplay=await write();assert.equal(sourceGoneReplay.response.status,201);assert.equal(sourceGoneReplay.value.source_state,"UNAVAILABLE_OR_CHANGED");
  assert.equal(sourceGoneReplay.value.items[0].policy,null);assert.equal(sourceGoneReplay.value.items[0].state,"SOURCE_UNAVAILABLE");assert.deepEqual(sourceGoneReplay.value.confirmed_review,first.value.confirmed_review);assert.equal(writeCount,1);
  const removedDetail=await call(`/api/v2/obligations/${ids.finding}?revision=3`);assert.equal(removedDetail.response.status,200);assert.equal(removedDetail.value.state,"SOURCE_UNAVAILABLE");assert.equal(removedDetail.value.result,null);assert.equal(removedDetail.value.rights.length,0);
  missingContract=true;const missingResult=await call("/api/v2/obligations");assert.equal(missingResult.response.status,503);assert.equal(missingResult.value.error.code,"MIGRATION_REQUIRED");
  const missingDiscovery=await call("/api/v2/mcp/operations");assert.equal(missingDiscovery.value.obligation_evidence.available,false);assert.ok(missingDiscovery.value.unavailable_operations.includes("obligation_lookup"));
  missingContract=false;for(let i=0;i<60;i++)assert.equal((await call("/api/v2/capabilities",{headers:{authorization:"Bearer saturated"}})).response.status,200);
  const limited=await call("/api/v2/obligations",{headers:{authorization:"Bearer saturated"}});assert.equal(limited.response.status,429);assert.equal(limited.response.headers.get("retry-after"),"60");assert.equal(limited.value.error.retryable,true);
  assert.deepEqual(peerErrors,[]);assert.equal(calls.some(row=>/account|gemini|\/research_runs$|\/document_chunks$/.test(row.path)),false);
  successReport={marker:"ACTUAL_WORKER_OBLIGATION_EVIDENCE_PASS",requests,source_versions:50,candidates:12,original_utf8_bytes:32768,max_response_utf8_bytes:maxBytes,separate_serving_actions:true,
    withheld_current_content:true,compact_immutable_intent_current_revocation:true,erased_latest_head_no_allow_resurrection:true,source_erased_old_intent_confirmed_withheld:true,actual_60_request_bucket:true,retry_after_seconds:60,canonical_dto_preserved:true,
    sql_auth_and_rights_peers:"CONTROLLED_NOT_HOSTED",sql_durability_claimed:false,standard_mcp_conformance_claimed:false,hosted_cpu_memory_budget_acceptance:false};
}catch(error){failure=error;}
finally{
  try{if(runtime)await runtime.close();}catch(error){failure??=error;}
  try{await new Promise(resolve=>peer.close(resolve));}catch(error){failure??=error;}
  try{await rm(directory,{recursive:true,force:true});}catch(error){failure??=error;}
}
if(failure)throw failure;
const released=createServer();await new Promise((resolve,reject)=>{released.once("error",reject);released.listen(port,"127.0.0.1",resolve);});await new Promise(resolve=>released.close(resolve));
console.log(JSON.stringify(successReport));console.log("ACTUAL_WORKER_OBLIGATION_EVIDENCE_OWNED_LISTENER_RELEASED");
