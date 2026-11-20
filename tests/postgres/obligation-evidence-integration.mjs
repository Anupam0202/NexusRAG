// Actual Gateway + real saved Finding/review/version rights in owned local SQL.
// Auth/HTTP peers are controlled, not real OAuth/hosted/provider acceptance.
import assert from "node:assert/strict";
import {execFile,execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {readFile,writeFile} from "node:fs/promises";
import {handle} from "../../apps/gateway/src/preview-worker.js";
import {servingIntentHash,servingIntentSerialization} from "../../apps/gateway/src/serving-intent.js";
assert.equal(process.env.NEXUS_DISPOSABLE_SQL,"1");assert.ok(process.env.PGHOST?.startsWith("/"));
const ws="11111111-1111-4111-8111-111111111111",owner="22222222-2222-4222-8222-222222222222",author="22222244-2222-4222-8222-222222222222";
const args=["-X","-qAt","-v","ON_ERROR_STOP=1"],timings=[];
function input(statement,values={}){
  const keys=Object.keys(values);assert.ok(keys.every(key=>/^[a-z_]+$/.test(key)));
  const params=JSON.stringify(Object.fromEntries(Object.entries(values).map(([key,value])=>[key,typeof value==="string"?value:JSON.stringify(value)])));
  return `set request.jwt.claim.role='service_role';\n${keys.length?`select ${keys.map(key=>`params->>'${key}' as "${key}"`).join(",")} from (select '${params.replaceAll("'","''")}'::jsonb params) input\n\\gset\n`:""}${statement}`;
}
function sql(statement,values={}){
  try{const out=execFileSync("psql",args,{input:input(statement,values),encoding:"utf8",maxBuffer:32*1024*1024}).trim();return out?JSON.parse(out):null;}
  catch(error){const code=String(error.stderr||error).match(/NR:([A-Z_]+)/)?.[1];if(code)throw Object.assign(new Error(`Owned SQL ${code}`),{code});throw error;}
}
function context(actor){return sql(`select jsonb_build_object('workspace_id',w.id,'user_id',:'actor','membership_revision',w.capability_revision,
 'policy_id',s.active_policy_id,'policy_version',s.policy_version,'deadline',clock_timestamp()+interval '10 minutes')
 from public.workspaces w join public.workspace_settings s on s.workspace_id=w.id where w.id=:'ws';`,{ws,actor});}
const beforeUsage=sql("select jsonb_agg(to_jsonb(x) order by user_id) from public.nexus_account_usage x;");
const vectors=JSON.parse(await readFile(new URL("../fixtures/serving-intent-vectors.json",import.meta.url),"utf8"));
for(const {intent,sha256} of vectors.vectors){
  const stored=sql("select to_jsonb(public.nexus_serving_intent_hash(:'finding'::uuid,:'revision'::bigint,:'action',:'actor'::uuid,:'command'::jsonb));",
    {finding:intent.finding_id,revision:intent.finding_revision,action:intent.action,actor:intent.actor_id,command:intent.command});
  assert.equal(stored,sha256);assert.equal(await servingIntentHash(intent),sha256);
}
assert.equal(servingIntentSerialization,vectors.serialization);
const run=sql(`select to_jsonb(r) from public.research_runs r join public.research_plans p on p.workspace_id=r.workspace_id and p.id=r.plan_id
 where r.workspace_id=:'ws' and p.plan->>'plan_id'='obligation-capacity-plan' and r.idempotency_key='obligation-capacity-start';`,{ws});
assert.equal(run.mode,"OBLIGATION_ANALYSIS");assert.equal(run.source_snapshot.length,50);assert.equal(run.results.length,11);
const source=run.results[10];assert.equal(source.obligations.candidates.length,12);
function createFinding(runId,key,title){const command={title,authored_markdown:"Keep all qualifications.",research_run_id:runId,result_index:10};
  const finding=sql("select public.nexus_finding(:'ctx'::jsonb,'create',null,:'command'::jsonb,null,:'key',:'hash');",
    {ctx:context(author),command,key,hash:createHash("sha256").update(JSON.stringify(command)).digest("hex")});
  sql("select public.nexus_finding(:'ctx'::jsonb,'share',:'id'::uuid,:'command'::jsonb,null,null,null);",{ctx:context(author),id:finding.id,command:{user_id:owner,permission:"contribute"}});return finding.id;}
const fid=createFinding(run.id,"obligation063-native","Gateway serving063 maximum 📊");
const ordinaryRun=sql("select to_jsonb(r) from public.research_runs r where workspace_id=:'ws' and idempotency_key='actual-OBLIGATION_ANALYSIS-start';",{ws});
const concurrentFid=createFinding(ordinaryRun.id,"obligation063-concurrent","Ordinary source serving concurrency");
const policy={decision:"ALLOW",basis:"OWNED_CONTENT",rationale:"Synthetic author owns source 📊",evidence_reference:"urn:synthetic:owned063",attribution:"Synthetic author",duties:["Retain qualifications 📊"],review_by:"2030-01-01T00:00:00.000Z"};
const selections=items=>items.map(row=>({version_id:row.version_id,original_hash:row.original_hash,expected_review_id:row.review_id}));
function concurrentRights(command,key){
  const statement=`with before as materialized(select pg_backend_pid() pid,clock_timestamp() began),waiting as materialized(select pg_sleep(0.25) from before),
 saved as materialized(select public.nexus_finding_serving_rights(:'ctx'::jsonb,'record',:'finding'::uuid,'SERVE_API',:'command'::jsonb,1,:'key') value from waiting)
 select jsonb_build_object('pid',before.pid,'began',before.began,'ended',clock_timestamp(),'result',saved.value) from before,saved;`;
  return new Promise((resolve,reject)=>{const child=execFile("psql",args,{encoding:"utf8",maxBuffer:32*1024*1024},(error,out)=>{
    if(error){const code=String(error.stderr||error).match(/NR:([A-Z_]+)/)?.[1];return reject(Object.assign(error,{code}));}try{resolve(JSON.parse(out.trim()));}catch(error){reject(error);}});
    child.stdin.end(input(statement,{ctx:context(owner),finding:concurrentFid,command,key}));});
}
const unknown=sql("select public.nexus_finding_serving_rights(:'ctx'::jsonb,'read',:'id'::uuid,'SERVE_API');",{ctx:context(owner),id:concurrentFid});
const first={selections:selections(unknown.items).slice(0,1),policy},same=await Promise.all([concurrentRights(first,"obligation063-same-intent"),concurrentRights(first,"obligation063-same-intent")]);
assert.notEqual(same[0].pid,same[1].pid);assert.ok(Date.parse(same[0].began)<=Date.parse(same[1].ended)&&Date.parse(same[1].began)<=Date.parse(same[0].ended));
assert.deepEqual(same[0].result.confirmed_review,same[1].result.confirmed_review);
const competing=await Promise.allSettled([concurrentRights({selections:selections(unknown.items).slice(1,2),policy},"obligation063-compete-a"),concurrentRights({selections:selections(unknown.items).slice(1,2),policy},"obligation063-compete-b")]);
assert.equal(competing.filter(x=>x.status==="fulfilled").length,1);assert.equal(competing.find(x=>x.status==="rejected").reason.code,"VERSION_CONFLICT");
sql("select public.nexus_finding(:'ctx'::jsonb,'unshare',:'id'::uuid,:'command'::jsonb,null,null,null);",{ctx:context(author),id:concurrentFid,command:{user_id:owner}});

const env={SUPABASE_URL:"https://obligation063-sql.invalid",SUPABASE_PUBLISHABLE_KEY:"synthetic-publishable",SUPABASE_SERVICE_ROLE_KEY:"synthetic-service",FRONTEND_ORIGIN:"https://console.invalid"};
const previousFetch=globalThis.fetch;let loseNextReply=false,loseAudit=false,sourceLoss=false,rpcCalls=0;
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{"content-type":"application/json"}});
globalThis.fetch=async(target,init={})=>{
  const url=new URL(target instanceof Request?target.url:target);assert.equal(url.hostname,"obligation063-sql.invalid",`Unexpected test egress ${url.hostname}`);
  if(url.pathname==="/auth/v1/user")return json({id:owner});assert.ok(url.pathname.startsWith("/rest/v1/"));
  const table=url.pathname.slice(9),body=init.body?JSON.parse(init.body):{};
  try{
    if(table.startsWith("rpc/")){
      rpcCalls++;const started=performance.now();let value;
      if(table==="rpc/nexus_obligation_evidence_contract")value=sql("select public.nexus_obligation_evidence_contract();");
      else if(table==="rpc/nexus_obligation_evidence"){
        const expression="select public.nexus_obligation_evidence(:'ctx'::jsonb,:'op',:'action',nullif(:'finding','')::uuid,nullif(:'revision','')::bigint,:'limit'::integer,nullif(:'after','')::uuid);";
        const prefix=sourceLoss?"begin;select public.tombstone_document(:'ws'::uuid,:'document'::uuid,:'actor'::uuid) as owned_removal\n\\gset\n":"";
        value=sql(prefix+expression+(sourceLoss?"rollback;":""),{ctx:body.p_context,op:body.p_operation,action:body.p_action,finding:body.p_finding??"",revision:body.p_revision??"",limit:body.p_limit,after:body.p_after??"",ws,document:run.source_snapshot[0].document_id,actor:owner});
      }else if(table==="rpc/nexus_finding_serving_rights"){
        const expression="select public.nexus_finding_serving_rights(:'ctx'::jsonb,:'op',:'id'::uuid,:'action',:'command'::jsonb,nullif(:'revision','')::bigint,nullif(:'key',''));";
        const prefix=sourceLoss&&body.p_operation==="read"?"begin;select public.tombstone_document(:'ws'::uuid,:'document'::uuid,:'actor'::uuid) as owned_removal\n\\gset\n":"";
        value=sql(prefix+expression+(prefix?"rollback;":""),
          {ctx:body.p_context,op:body.p_operation,id:body.p_finding,action:body.p_action,command:body.p_command,revision:body.p_revision??"",key:body.p_key??"",ws,document:run.source_snapshot[0].document_id,actor:owner});
        if(loseNextReply&&body.p_operation==="record"){loseNextReply=false;throw Error("Controlled response lost AFTER SQL commit");}
      }else if(table==="rpc/nexus_finding")value=sql("select public.nexus_finding(:'ctx'::jsonb,:'op',:'id'::uuid,:'command'::jsonb,null,null,null);",{ctx:body.p_context,op:body.p_operation,id:body.p_id,command:body.p_command});
      else throw Error(`Unexpected owned RPC ${table}`);
      timings.push({rpc:table,elapsed_ms:Math.round(performance.now()-started),result_bytes:Buffer.byteLength(JSON.stringify(value))});return json(value);
    }
    if(table==="audit_events"){
      if(loseAudit)throw Error("Controlled unavailable best-effort audit");
      sql(`insert into public.audit_events(workspace_id,user_id,action,resource_type,resource_id,metadata)
       select workspace_id,user_id,action,resource_type,resource_id,metadata from jsonb_to_recordset(:'events'::jsonb)
       as x(workspace_id uuid,user_id uuid,action text,resource_type text,resource_id text,metadata jsonb);`,{events:body});return json([]);
    }
    if(table==="workspace_members")return json(sql(`select coalesce(jsonb_agg(to_jsonb(m)||jsonb_build_object('workspaces',jsonb_build_object('lifecycle_state',w.lifecycle_state))),'[]')
     from public.workspace_members m join public.workspaces w on w.id=m.workspace_id where m.workspace_id=:'ws' and m.user_id=:'actor' and w.lifecycle_state='active';`,{ws,actor:owner}));
    if(table==="workspaces")return json(sql("select coalesce(jsonb_agg(to_jsonb(w)),'[]') from public.workspaces w where id=:'ws';",{ws}));
    if(table==="workspace_settings")return json(sql("select coalesce(jsonb_agg(to_jsonb(s)),'[]') from public.workspace_settings s where workspace_id=:'ws';",{ws}));
    if(table==="finding_versions")return json(sql("select coalesce(jsonb_agg(jsonb_build_object('author_id',author_id)),'[]') from public.finding_versions where workspace_id=:'ws' and finding_id=:'id' and revision=1;",{ws,id:fid}));
    throw Error(`Unexpected owned SQL table ${table}`);
  }catch(error){if(error.code?.match(/^[A-Z_]+$/))return json({message:`NR:${error.code}`},400);throw error;}
};
async function request(path,{method="GET",body,key}={}){
  const response=await handle(new Request(`https://gateway.invalid${path}`,{method,headers:{authorization:"Bearer controlled-synthetic-owner","x-nexus-workspace-id":ws,"content-type":"application/json",...(key?{"idempotency-key":key}:{})},body:body?JSON.stringify(body):undefined}),env);
  return {status:response.status,body:await response.json()};
}
const artifact={schema_version:"obligation-evidence-browser-sql-fixture/1",workspace_id:ws,actor_id:owner,author_id:author};
const rightsPath=action=>`/api/v2/findings/${fid}/serving-rights?action=${action}`;
const apiPath=`/api/v2/obligations/${fid}?revision=1`,mcpRequest={method:"POST",body:{operation:"obligation_lookup",finding_id:fid,revision:1}};
async function actual(path,options){const response=await request(path,options);assert.equal(response.status,200,JSON.stringify(response.body));return response.body;}
try{
  artifact.review_required_api=await actual(apiPath);artifact.review_required_mcp=await actual("/api/v2/mcp/execute",mcpRequest);assert.equal(artifact.review_required_api.state,"REVIEW_REQUIRED");
  sql("select public.nexus_finding(:'ctx'::jsonb,'review',:'id'::uuid,'{\"decision\":\"approved\",\"comment\":\"Independent source review, no legal certification\"}',1,null,null);",{ctx:context(owner),id:fid});
  artifact.rights_api_initial=await actual(rightsPath("SERVE_API"));artifact.rights_mcp_initial=await actual(rightsPath("SERVE_MCP"));
  artifact.review_command_api={revision:1,selections:selections(artifact.rights_api_initial.items),policy};
  const before=sql("select count(*) from public.finding_serving_rights where workspace_id=:'ws';",{ws});loseNextReply=true;
  let response=await request(rightsPath("SERVE_API"),{method:"POST",body:artifact.review_command_api,key:"obligation063-lost-api"});assert.equal(response.status,500);
  response=await request(rightsPath("SERVE_API"),{method:"POST",body:artifact.review_command_api,key:"obligation063-lost-api"});assert.equal(response.status,201,JSON.stringify(response.body));artifact.rights_api_allowed=response.body;
  assert.equal(sql("select count(*) from public.finding_serving_rights where workspace_id=:'ws';",{ws}),before+50);
  assert.equal(response.body.confirmed_review.intent_hash,await servingIntentHash({finding_id:fid,finding_revision:1,action:"SERVE_API",actor_id:owner,command:{selections:artifact.review_command_api.selections,policy}}));
  assert.equal(response.body.confirmed_review.command,undefined);artifact.detail_api=await actual(apiPath);assert.equal(artifact.detail_api.state,"READY");assert.deepEqual(artifact.detail_api.result,source);assert.deepEqual(artifact.detail_api.source_snapshot,run.source_snapshot);assert.equal(artifact.detail_api.evidence.length,50);
  const blocked=await actual("/api/v2/mcp/execute",mcpRequest);assert.equal(blocked.state,"RIGHTS_BLOCKED");
  artifact.review_command_mcp={revision:1,selections:selections(artifact.rights_mcp_initial.items),policy};
  response=await request(rightsPath("SERVE_MCP"),{method:"POST",body:artifact.review_command_mcp,key:"obligation063-mcp-allow"});assert.equal(response.status,201,JSON.stringify(response.body));artifact.rights_mcp_allowed=response.body;
  artifact.detail_mcp=await actual("/api/v2/mcp/execute",mcpRequest);assert.equal(artifact.detail_mcp.state,"READY");assert.deepEqual(artifact.detail_mcp.result,source);
  artifact.finding=await actual(`/api/v2/findings/${fid}`);artifact.list_api=await actual("/api/v2/obligations?limit=50");artifact.list_mcp=await actual("/api/v2/mcp/execute",{method:"POST",body:{operation:"obligation_lookup",limit:50}});
  assert.ok(artifact.list_api.items.some(x=>x.finding_id===fid));assert.ok(artifact.list_api.items.every(x=>!Object.hasOwn(x,"title")&&!Object.hasOwn(x,"result")));
  sourceLoss=true;artifact.source_unavailable_api=await actual(apiPath);artifact.source_unavailable_mcp=await actual("/api/v2/mcp/execute",mcpRequest);
  artifact.rights_api_erased=await actual(rightsPath("SERVE_API"));artifact.rights_mcp_erased=await actual(rightsPath("SERVE_MCP"));sourceLoss=false;
  assert.equal(artifact.source_unavailable_api.state,"SOURCE_UNAVAILABLE");assert.equal(artifact.source_unavailable_api.result,null);
  for(const [erased,allowed] of [[artifact.rights_api_erased,artifact.rights_api_allowed],[artifact.rights_mcp_erased,artifact.rights_mcp_allowed]]){
    assert.equal(erased.source_state,"UNAVAILABLE_OR_CHANGED");assert.equal(erased.eligible,false);assert.equal(erased.items.length,50);
    erased.items.forEach((item,index)=>{assert.equal(item.state,"SOURCE_UNAVAILABLE");assert.equal(item.allowed,false);assert.equal(item.policy,null);
      assert.ok(Number.isFinite(Date.parse(item.policy_erased_at)));assert.equal(item.review_id,allowed.items[index].review_id);
      assert.equal(item.actor_id,allowed.items[index].actor_id);assert.equal(item.created_at,allowed.items[index].created_at);});
  }
  loseAudit=true;response=await request(apiPath);assert.equal(response.status,200);assert.equal(response.body.state,"READY");assert.equal(response.body.audit_receipt,undefined);loseAudit=false;
  const apiCurrent=await actual(rightsPath("SERVE_API"));artifact.revoke_command_api={revision:1,selections:selections(apiCurrent.items),policy:{...policy,decision:"REVOKED"}};
  response=await request(rightsPath("SERVE_API"),{method:"POST",body:artifact.revoke_command_api,key:"obligation063-api-revoke"});assert.equal(response.status,201);artifact.rights_api_revoked=response.body;artifact.withheld_api=await actual(apiPath);assert.equal(artifact.withheld_api.state,"RIGHTS_BLOCKED");
  response=await request(rightsPath("SERVE_API"),{method:"POST",body:artifact.review_command_api,key:"obligation063-lost-api"});assert.equal(response.status,201);assert.equal(response.body.eligible,false);assert.deepEqual(response.body.confirmed_review,artifact.rights_api_allowed.confirmed_review);
  assert.equal((await actual("/api/v2/mcp/execute",mcpRequest)).state,"READY","API revocation cannot revoke MCP");
  const mcpCurrent=await actual(rightsPath("SERVE_MCP"));artifact.revoke_command_mcp={revision:1,selections:selections(mcpCurrent.items),policy:{...policy,decision:"REVOKED"}};
  response=await request(rightsPath("SERVE_MCP"),{method:"POST",body:artifact.revoke_command_mcp,key:"obligation063-mcp-revoke"});assert.equal(response.status,201);artifact.rights_mcp_revoked=response.body;artifact.withheld_mcp=await actual("/api/v2/mcp/execute",mcpRequest);assert.equal(artifact.withheld_mcp.state,"RIGHTS_BLOCKED");
  sql("select public.nexus_finding(:'ctx'::jsonb,'unshare',:'id'::uuid,:'command'::jsonb,null,null,null);",{ctx:context(author),id:fid,command:{user_id:owner}});response=await request(apiPath);assert.equal(response.status,403);
  assert.deepEqual(sql("select jsonb_agg(to_jsonb(x) order by user_id) from public.nexus_account_usage x;"),beforeUsage);assert.ok(timings.every(x=>x.elapsed_ms<8000),"Keep original8s RPC bound");
  if(process.env.NEXUS_OBLIGATION_EVIDENCE_OUTPUT){const encoded=JSON.stringify(artifact),path=process.env.NEXUS_OBLIGATION_EVIDENCE_OUTPUT;
    await writeFile(path,encoded,{flag:"wx"});await writeFile(path.replace(/\.json$/,"")+".receipt.json",JSON.stringify({schema_version:"obligation-evidence-synthetic-native-receipt/1",bytes:Buffer.byteLength(encoded),sha256:createHash("sha256").update(encoded).digest("hex"),source_versions:50,candidates:12,criteria:11,actual_sql_projection:true,controlled_transport:true,hosted_acceptance:false}),{flag:"wx"});}
  console.log(JSON.stringify({marker:"REAL_SQL_OBLIGATION_EVIDENCE_SERVING_PASS",sources:50,candidates:12,criteria:11,result_json_bytes:Buffer.byteLength(JSON.stringify(source)),full_original_bytes:artifact.detail_api.evidence.reduce((sum,x)=>sum+Buffer.byteLength(x.original_text),0),
    exact_canonical_result:true,independent_same_intent_connections:2,competing_intent_one_winner:true,known_hash_vectors:vectors.vectors.length,lost_committed_reply_no_duplicate:true,api_mcp_independent:true,
    revoked_intent_replay_current_withheld:true,source_tombstone_projection_rolled_back:true,actual_erased_policy_heads_gateway_validated:true,ordinary_unshare:true,audit_failure_not_receipt:true,account_usage_unchanged:true,max_rpc_ms:Math.max(...timings.map(x=>x.elapsed_ms)),rpc_calls:rpcCalls,
    hosted_acceptance:false,provider_processing:false,standard_mcp_transport_conformance:false}));
}finally{globalThis.fetch=previousFetch;}
