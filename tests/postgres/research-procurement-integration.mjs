// Production executor/Findings handlers with owned local SQL and controlled provider peers.
import assert from "node:assert/strict";
import {execFile,execFileSync} from "node:child_process";
import {randomUUID} from "node:crypto";
import {writeFile} from "node:fs/promises";
import {processResearchMessage} from "../../apps/gateway/src/research-executor.js";
import {handleResearchRuns} from "../../apps/gateway/src/research-runs.js";
import {handleWorkbench} from "../../apps/gateway/src/workbench.js";
import {procurementCapacity,procurementWire} from "../fixtures/research-procurement-data.mjs";

assert.equal(process.env.NEXUS_DISPOSABLE_SQL,"1");assert.ok(process.env.PGHOST?.startsWith("/"));
const capacityMode=true;
const ws="11111111-1111-4111-8111-111111111111",actor="22226060-2222-4222-8222-222222222222",reviewer="33333333-3333-4333-8333-333333333333";
const args=["-X","-qAt","-v","ON_ERROR_STOP=1"],fixture=procurementCapacity();
function input(statement,values) {
  const keys=Object.keys(values);assert.ok(keys.every(key=>/^[a-z_]+$/.test(key)));
  const params=JSON.stringify(Object.fromEntries(Object.entries(values).map(([key,value])=>[key,typeof value==="string"?value:JSON.stringify(value)])));
  return `set request.jwt.claim.role='service_role';\n${keys.length?`select ${keys.map(key=>`params->>'${key}' as "${key}"`).join(",")} from (select '${params.replaceAll("'","''")}'::jsonb params) input\n\\gset\n`:""}${statement}`;
}
function sql(statement,values={}) {
  try {const output=execFileSync("psql",args,{input:input(statement,values),encoding:"utf8",maxBuffer:32*1024*1024}).trim();return output?JSON.parse(output):null;}
  catch(error){const code=String(error.stderr||error).match(/NR:([A-Z_]+)/)?.[1];if(code)throw Object.assign(new Error(`Disposable SQL ${code}`),{code});throw error;}
}
const connections=[];
function concurrent(expression,values) {
  const statement=`with ready as materialized(select pg_backend_pid() pid,clock_timestamp() began),
    waiting as materialized(select pg_sleep(0.5) from ready),result as materialized(select ${expression} value from waiting)
    select jsonb_build_object('pid',ready.pid,'began',ready.began,'ended',clock_timestamp(),'result',result.value) from ready,result;`;
  return new Promise((resolve,reject)=>{const child=execFile("psql",args,{encoding:"utf8",maxBuffer:32*1024*1024},(error,out)=>{
    if(error)return reject(error);try{const value=JSON.parse(out.trim());connections.push(value);resolve(value);}catch(error){reject(error);}});child.stdin.end(input(statement,values));});
}
function overlap(a,b) {assert.notEqual(a.pid,b.pid);assert.ok(Date.parse(a.began)<=Date.parse(b.ended)&&Date.parse(b.began)<=Date.parse(a.ended),"Independent SQL sessions must actually overlap");}
sql(`insert into auth.users(id,email,raw_user_meta_data) values(:'actor','procurement-executor060@example.invalid','{}');
 insert into public.workspace_members(workspace_id,user_id,role) values(:'ws',:'actor','editor');
 insert into public.workspace_members(workspace_id,user_id,role) values(:'ws',:'reviewer','editor') on conflict(workspace_id,user_id) do update set role='editor';`,{actor,ws,reviewer});
for(const [i,original] of fixture.originals.entries())sql(`
 insert into public.documents(id,workspace_id,uploaded_by,filename,original_filename,status) values(:'doc',:'ws',:'actor',:'name',:'name','ready');
 insert into public.document_versions(id,workspace_id,document_id,original_bucket,original_key,original_hash,original_bytes,original_verified_at,parser_version,chunker_version,lifecycle_epoch,
   publication_state,index_generation,data_classification,classification_declared_by,classification_declared_at)
 values(:'version',:'ws',:'doc','documents',:'doc',:'hash',32768,now(),'synthetic','synthetic',1,'ready','procurement060-generation','non_sensitive',:'actor',now());
 update public.documents set active_version_id=:'version' where id=:'doc';
 insert into public.document_chunks(id,workspace_id,document_id,version_id,chunk_index,content,original_text,original_content_hash,page_number,location,embedding_space_id)
 values(:'chunk',:'ws',:'doc',:'version',0,:'text',:'text',:'hash',nullif(:'page','')::integer,:'location'::jsonb,'synthetic-space');`,
 {doc:original.document_id,ws,actor,name:fixture.documents[i].filename,version:original.version_id,hash:original.original_content_hash,chunk:original.id,
  text:original.original_text,page:original.page_number??"",location:original.location});
sql(`insert into public.document_chunks(id,workspace_id,document_id,version_id,chunk_index,content,original_text,original_content_hash,page_number,location,embedding_space_id)
 select (:'prefix'||lpad(n::text,12,'0'))::uuid,:'ws',:'doc',:'version',n,'Unrelated appendix.','Unrelated appendix.',
 encode(sha256(convert_to('Unrelated appendix.','UTF8')),'hex'),3,'{"page":3}','synthetic-space' from generate_series(1,399) n;`,
 {ws,doc:fixture.documents[0].id,version:fixture.originals[0].version_id,prefix:capacityMode?"ff606900-0000-4000-8100-":"ff606800-0000-4000-8100-"});
const ctx=sql(`select jsonb_build_object('workspace_id',w.id,'user_id',:'actor','membership_revision',w.capability_revision,
 'policy_id',s.active_policy_id,'policy_version',s.policy_version,'deadline',clock_timestamp()+interval '20 minutes')
 from public.workspaces w join public.workspace_settings s on s.workspace_id=w.id where w.id=:'ws';`,{actor,ws});
const planPayload={
 plan_id:"actual-procurement060-plan",mode:"PROCUREMENT_RESEARCH",question:capacityMode?fixture.run.questions[0]:"Review synthetic source assertions,qualifications and unresolved subject identities.",
 subquestions:capacityMode?fixture.run.questions.slice(1):Array.from({length:12},(_,i)=>`Inspect synthetic due procurement context ${i+1}.`),private_source_ids:fixture.documents.map(doc=>doc.id),
 public_provider_ids:[],date_from:null,date_to:null,jurisdiction:null,entity_scope:[],rights_constraints:[],expected_calculations:[],
 completion_criteria:["Inspect precise source wording and preserve unresolved identities for independent review."]};
assert.ok(Buffer.byteLength(JSON.stringify(planPayload))<100000,"The combined fixture must retain the existing aggregate plan byte limit");
const plan=sql("select public.nexus_research_plan(:'ctx'::jsonb,'create',p_plan=>:'plan'::jsonb,p_key=>'actual-procurement060-plan');",{ctx,plan:planPayload});
const start="public.nexus_research_run(:'ctx'::jsonb,'create',:'plan'::uuid,p_key=>:'key',p_command=>'{\"non_sensitive_attested\":true}')";
const starts=await Promise.all([concurrent(start,{ctx,plan:plan.id,key:"actual-procurement060-start"}),concurrent(start,{ctx,plan:plan.id,key:"actual-procurement060-start"})]);
overlap(...starts);assert.equal(starts[0].result.id,starts[1].result.id);let run=starts[0].result;
assert.equal(run.questions.length,11);assert.equal(run.source_snapshot.length,50);
let transports=0,generations=0,expansions=0,nextFailure=null,emptyNext=false;const sent=[],lexical=[];
const runExpression="public.nexus_research_run(:'ctx'::jsonb,:'op',:'plan'::uuid,nullif(:'id','')::uuid,nullif(:'key',''),:'command'::jsonb,:'limit'::integer,nullif(:'after','')::uuid)";
const findingExpression="public.nexus_finding(:'ctx'::jsonb,:'op',nullif(:'id','')::uuid,:'command'::jsonb,nullif(:'revision','')::bigint,nullif(:'key',''),nullif(:'hash',''))";
async function db(_env,path,init={}) {
  transports++;const url=new URL(path,"https://synthetic.invalid"),table=url.pathname.slice(1),p=init.body?JSON.parse(init.body):{};
  if(table==="rpc/nexus_research_candidates") {const result=sql("select public.nexus_research_candidates(:'ctx'::jsonb,:'id'::uuid,:'generation'::integer,:'position'::integer,array(select jsonb_array_elements_text(:'ids'::jsonb)::uuid));",
    {ctx:p.p_context,id:p.p_id,generation:p.p_generation,position:p.p_position,ids:p.p_document_ids});lexical.push(result.lexical_rows_read);return result;}
  if(table==="rpc/nexus_research_step")return sql("select public.nexus_research_step(:'ctx'::jsonb,:'op',:'id'::uuid,:'generation'::integer,:'position'::integer,nullif(:'token','')::uuid,nullif(:'result','')::jsonb,nullif(:'error',''));",
    {ctx:p.p_context,op:p.p_operation,id:p.p_id,generation:p.p_generation,position:p.p_position,token:p.p_token||"",result:p.p_result?JSON.stringify(p.p_result):"",error:p.p_error||""});
  if(table==="rpc/nexus_research_run")return sql(`select ${runExpression};`,{ctx:p.p_context,op:p.p_operation,plan:p.p_plan,id:p.p_id||"",key:p.p_key||"",command:p.p_command,limit:p.p_limit,after:p.p_after||""});
  if(table==="rpc/nexus_finding") {const values={ctx:p.p_context,op:p.p_operation,id:p.p_id||"",command:p.p_command,revision:p.p_revision||"",key:p.p_key||"",hash:p.p_hash||""};
    return p.p_operation==="create"?(await concurrent(findingExpression,values)).result:sql(`select ${findingExpression};`,values);}
  if(["rpc/nexus_research_procurement_contract","rpc/nexus_research_candidates_contract","rpc/nexus_research_finding_contract"].includes(table))return sql(`select public.${table.slice(4)}();`);
  assert.ok(["research_runs","documents","document_versions","document_chunks","workspaces","workspace_settings","finding_versions"].includes(table),table);
  const filters={};for(const [key,value] of url.searchParams) {
    if(["select","limit","order"].includes(key))continue;
    if(value.startsWith("eq."))filters[key]=[value.slice(3)];else if(value.startsWith("in.(")&&value.endsWith(")"))filters[key]=value.slice(4,-1).split(",");else throw Error(`Unsupported owned filter ${key}`);
  }
  const limit=Number(url.searchParams.get("limit")||201),order=url.searchParams.get("order");assert.ok(Number.isInteger(limit)&&limit>=1&&limit<=201);assert.ok(!order||order==="id.asc");
  return sql(`select coalesce(jsonb_agg(value),'[]') from(select to_jsonb(t) value from public.${table} t
    where not exists(select 1 from jsonb_each(:'filters'::jsonb) f where not(f.value ? (to_jsonb(t)->>f.key))) ${order?"order by t.id asc":""} limit ${limit}) rows;`,{filters});
}
const ordinaryFetch=globalThis.fetch;
globalThis.fetch=async(input,init={})=>{
  transports++;const url=new URL(input instanceof Request?input.url:input),json=value=>new Response(JSON.stringify(value));
  if(url.hostname==="procurement-peer.invalid") {
    const body=JSON.parse(init.body);
    if(url.pathname.endsWith("/v6_reserve_many"))return json({state:"READY",reservations:Object.values(body.p_dimensions).map(amount=>({id:randomUUID(),amount,replayed:false}))});
    if(url.pathname.endsWith("/v6_settle_many"))return json({state:"SETTLED"});
  }
  if(url.hostname==="procurement-qdrant.invalid")return json(url.pathname.endsWith("/points/query/batch")?{result:JSON.parse(init.body).searches.map(()=>({points:[]}))}:{result:{config:{params:{vectors:{size:8,distance:"Cosine"}}}}});
  if(url.hostname==="generativelanguage.googleapis.com") {
    if(url.pathname.endsWith(":embedContent"))return json({embedding:{values:Array(8).fill(0.1)}});
    if(url.pathname.endsWith(":batchEmbedContents"))return json({embeddings:JSON.parse(init.body).requests.map(()=>({values:Array(8).fill(0.1)}))});
    const body=JSON.parse(init.body),prompt=body.contents[0].parts[0].text;
    if(prompt.startsWith("RESEARCH_QUERY_VARIANTS")) {
      expansions++;const fullQuestion=prompt.split("QUESTION:\n")[1],question=capacityMode?fullQuestion.split(" ").slice(0,5).join(" "):fullQuestion;
      return json({candidates:[{finishReason:"STOP",content:{parts:[{text:JSON.stringify({queries:["filing","registry","identifier","ownership","alias","date","context"].map(word=>`${question} ${word}`)})}]}}]});
    }
    generations++;
    if(nextFailure){const failure=nextFailure;nextFailure=null;return failure==="503"?new Response("Synthetic ordinary provider outage",{status:503}):json({candidates:[{finishReason:"MAX_TOKENS",content:{parts:[{text:'{"candidates":['}]}}]});}
    const sources=JSON.parse(prompt.split("\nEVIDENCE:\n")[1]);assert.equal(sources.length,50);assert.equal(body.generationConfig.maxOutputTokens,4096);
    const wire=emptyNext?{schema_version:"research-procurement-wire/1",anchors:[],texts:[],records:[],gaps:[]}:procurementWire(sources);emptyNext=false;
    return json({candidates:[{finishReason:"STOP",content:{parts:[{text:JSON.stringify(wire)}]}}]});
  }
  throw Error(`Unexpected controlled external path ${url.hostname}${url.pathname}`);
};
const env={SUPABASE_URL:"https://procurement-peer.invalid",SUPABASE_SERVICE_ROLE_KEY:"synthetic-not-live",GOOGLE_API_KEY:"synthetic-not-live",
  QDRANT_URL:"https://procurement-qdrant.invalid",QDRANT_API_KEY:"synthetic-not-live",INGESTION_QUEUE:{send:async body=>sent.push(body)}};
const json=(_request,_env,value,status=200)=>new Response(JSON.stringify(value),{status});
const message=value=>({kind:"research",workspace_id:ws,run_id:value.id,generation:value.generation,position:value.position});
const read=id=>sql("select public.nexus_research_run(:'ctx'::jsonb,'read',:'plan'::uuid,:'id'::uuid);",{ctx,plan:plan.id,id});
async function command(operation,id,key) {
  const suffix=id?`/${id}${["cancel","resume"].includes(operation)?`/${operation}`:""}`:"";
  const response=await handleResearchRuns({request:new Request(`https://gateway.invalid/api/v2/research/plans/${plan.id}/runs${suffix}`,{
    method:operation==="read"?"GET":"POST",headers:key?{"Idempotency-Key":key}:undefined,
    body:operation==="read"?undefined:JSON.stringify({execution_mode:"PROCUREMENT_RESEARCH",non_sensitive_attested:true})}),env,workspace:ws,user:{id:actor},member:{role:"editor"},serviceRequest:db,json});
  assert.equal(response.status,operation==="create"?201:200);return response.json();
}
try {
  let maxCalls=0;
  for(let position=0;position<11;position++) {
    const before=transports,previous=run;run=await processResearchMessage(env,message(run),db);
    const stored=read(previous.id);
    assert.ok(run,JSON.stringify({state:stored.state,position:stored.position,error_code:stored.error_code}));assert.equal(run.position,position+1);maxCalls=Math.max(maxCalls,transports-before);assert.ok(transports-before<50);
    assert.deepEqual(read(run.id).results,run.results);const result=run.results[position];
    assert.equal(result.procurement.records.length,12);assert.equal(result.procurement.documents.length,50);
    assert.equal(result.query_retrieval.completed_queries,8);assert.equal(result.sources.length,12);
    assert.ok(result.procurement.records.every(row=>row.record_state==="PROPOSED_NOT_VERIFIED"&&row.decision_state==="NO_AUTOMATIC_ELIGIBILITY_AWARD_OR_RANKING"));
    assert.equal(result.procurement.gaps.length,12);
    for(const row of result.procurement.records) {
      assert.equal(Object.keys(row.fields).length,13);assert.equal(row.limitations.length,4);
      assert.ok(Object.values(row.fields).every(anchor=>Array.from(anchor.quote).length===300));
      assert.ok(row.limitations.every(value=>Array.from(value).length===240));
    }
    assert.equal(result.procurement.documents[0].consulted_sources[0].page_number,null);
    assert.equal(result.procurement.documents[1].consulted_sources[0].page_number,0);
    assert.ok(result.procurement.documents.slice(2).every(doc=>doc.consulted_sources[0].page_number===2));
    assert.equal(result.procurement.records.at(-1).source_document_id,fixture.documents.at(-1).id);
  }
  assert.equal(run.state,"completed");assert.equal(generations,11);assert.equal(expansions,11);assert.ok(lexical.every(rows=>rows<=201));
  await processResearchMessage(env,message({...run,position:0}),db);assert.equal(generations,11);
  const createFinding=()=>handleWorkbench({request:new Request("https://gateway.invalid/api/v2/findings",{method:"POST",headers:{"idempotency-key":"procurement060-later-finding"},
    body:JSON.stringify({title:"Synthetic qualified product procurement evidence",research_run_id:run.id,result_index:10})}),env,workspace:ws,user:{id:actor},member:{role:"editor"},serviceRequest:db,json});
  const beforeConnections=connections.length,created=await Promise.all([createFinding(),createFinding()]);created.forEach(response=>assert.equal(response.status,201));
  overlap(...connections.slice(beforeConnections));const finding=await created[0].json();assert.equal((await created[1].json()).id,finding.id);
  assert.deepEqual(finding.research_origin.procurement,run.results[10].procurement);assert.equal(finding.evidence.length,12);
  const audits=()=>sql("select count(*) from public.audit_events where workspace_id=:'ws' and action='finding.create' and resource_id=:'id';",{ws,id:finding.id});
  assert.equal(audits(),1);assert.equal((await(await createFinding()).json()).id,finding.id);assert.equal(audits(),1);
  async function findingCommand(who,operation,body,method="POST") {
    const response=await handleWorkbench({request:new Request(`https://gateway.invalid/api/v2/findings/${finding.id}${operation?`/${operation}`:""}`,{method,body:JSON.stringify(body)}),
      env,workspace:ws,user:{id:who},member:{role:"editor"},serviceRequest:db,json});assert.equal(response.status,200);return response.json();
  }
  await findingCommand(actor,"share",{user_id:reviewer,permission:"contribute"});
  const changes=await findingCommand(reviewer,"review",{decision:"changes_requested",comment:"Check literal identifier and temporal wording.",revision:1});assert.equal(changes.reviews[0].reviewer_id,reviewer);
  const revised=await findingCommand(actor,"",{title:"Revised synthetic Procurement Research Finding",authored_markdown:"Product applicability and proposed status require review.",revision:1},"PATCH");
  assert.equal(revised.revision,2);assert.equal(revised.reviews.length,0);assert.deepEqual(revised.research_origin.procurement,finding.research_origin.procurement);
  const reviewed=await findingCommand(reviewer,"review",{decision:"approved",comment:"Reviewed source wording; product applicability is not certified.",revision:2});
  assert.equal(reviewed.reviews[0].reviewer_id,reviewer);assert.equal(reviewed.reviews[0].revision,2);assert.ok(reviewed.research_origin.procurement.records.every(row=>row.record_state==="PROPOSED_NOT_VERIFIED"));
  let lifecycle=await command("create",undefined,"procurement060-lifecycle");lifecycle=await processResearchMessage(env,message(lifecycle),db);const saved=structuredClone(lifecycle.results);
  lifecycle=await command("cancel",lifecycle.id);assert.equal(lifecycle.state,"cancelled");lifecycle=await command("resume",lifecycle.id);
  assert.equal(lifecycle.generation,2);assert.deepEqual(lifecycle.results,saved);
  for(const [failure,code] of [["503","PROVIDER_UNAVAILABLE"],["incomplete","PROVIDER_INCOMPLETE"]]) {
    nextFailure=failure;assert.equal(await processResearchMessage(env,message(lifecycle),db),null);lifecycle=await command("read",lifecycle.id);
    assert.equal(lifecycle.error_code,code);assert.deepEqual(lifecycle.results,saved);lifecycle=await command("resume",lifecycle.id);
  }
  sql("update public.research_runs set deadline=clock_timestamp()-interval '1 second' where id=:'id';",{id:lifecycle.id});
  lifecycle=await command("read",lifecycle.id);assert.equal(lifecycle.error_code,"RUN_DEADLINE");lifecycle=await command("resume",lifecycle.id);
  assert.equal(sql("select to_jsonb(abs(extract(epoch from deadline-updated_at)-420)<1) from public.research_runs where id=:'id';",{id:lifecycle.id}),true);
  let ambiguous=await command("create",undefined,"procurement060-ambiguous"),lost=false;const stale=message(ambiguous);
  const losing=async(_env,path,init)=>{const result=await db(_env,path,init);if(path==="rpc/nexus_research_step"&&JSON.parse(init?.body||"{}").p_operation==="commit"&&!lost){lost=true;throw Error("Synthetic response lost after actual commit");}return result;};
  assert.equal(await processResearchMessage(env,stale,losing),null);ambiguous=await command("read",ambiguous.id);assert.equal(ambiguous.position,1);
  const beforeRepeat=generations;await processResearchMessage(env,stale,db);assert.equal(generations,beforeRepeat);
  emptyNext=true;ambiguous=await processResearchMessage(env,message(ambiguous),db);assert.equal(ambiguous.position,2);
  assert.equal(ambiguous.results[1].claim_state,"UNSUPPORTED");assert.equal(ambiguous.results[1].sources.length,0);assert.equal(ambiguous.results[1].procurement.documents.length,50);
  assert.match(ambiguous.results[1].answer,/not an exhaustive market search/);assert.equal(sql("select free_chat_queries from public.nexus_account_usage where user_id=:'actor';",{actor}),3);
  if(process.env.NEXUS_PROCUREMENT_RECEIPT_PATH)await writeFile(process.env.NEXUS_PROCUREMENT_RECEIPT_PATH,JSON.stringify({kind:"SYNTHETIC_LOCAL_SQL_NOT_HOSTED_ACCEPTANCE",plan,run,finding:reviewed},null,2),{flag:"wx"});
  console.log(JSON.stringify({marker:"REAL_SQL_PROCUREMENT_EXECUTOR_RECOVERY_REVIEW_PASS",documents:50,criteria:11,records_per_result:12,
    maximum_record_fields:capacityMode,plan_json_bytes:Buffer.byteLength(JSON.stringify(planPayload)),plan_byte_cap:100000,
    combined_fixture_subquestion_characters:capacityMode?5500:null,jsonb_result_bytes:sql("select pg_column_size((results->0)::text) from public.research_runs where id=:'id';",{id:run.id}),
    jsonb_run_bytes:sql("select pg_column_size(results::text) from public.research_runs where id=:'id';",{id:run.id}),
    saved_positions:11,original_bytes_each:32768,first_document_chunks:400,query_variants_each:8,original_candidate_rows_limit:201,max_controlled_calls_per_step:maxCalls,
    reread_each_position_exact:true,independent_concurrent_start_connections:2,independent_concurrent_finding_connections:2,one_creation_audit:true,
    review_revision:2,reviewer_is_original_author:false,cancel_resume_preserves_results:true,provider503_incomplete_preserve_progress:true,
    expired_resume_420seconds:true,ambiguous_commit_no_provider_repeat:true,empty_evidence_honest:true,account_admissions:3,
    sql_and_provider_peers:"REAL_OWNED_SQL_CONTROLLED_PROVIDERS",hosted_or_real_provider_quality:false,provider_processing:false}));
}finally{globalThis.fetch=ordinaryFetch;}
