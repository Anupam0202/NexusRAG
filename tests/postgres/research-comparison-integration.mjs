// Actual comparison executor and Findings handler with owned disposable PostgreSQL.
// Provider/quota peers and REST transport are controlled, never real user/provider data.
import assert from "node:assert/strict";
import { execFile,execFileSync } from "node:child_process";
import { createHash,randomUUID } from "node:crypto";
import { processResearchMessage } from "../../apps/gateway/src/research-executor.js";
import { handleWorkbench } from "../../apps/gateway/src/workbench.js";
import { timelineDate } from "../../apps/gateway/src/research-timeline.js";
const mode=process.env.NEXUS_RESEARCH_MODE||"COMPARE",timelining=mode==="TIMELINE";
assert.ok(["COMPARE","TIMELINE"].includes(mode));
assert.equal(process.env.NEXUS_DISPOSABLE_SQL,"1");assert.ok(process.env.PGHOST?.startsWith("/"));
const ws="11111111-1111-4111-8111-111111111111",actor="22222222-2222-4222-8222-222222222222";
function args(values){return ["-X","-qAt","-v","ON_ERROR_STOP=1",...Object.entries(values).flatMap(([key,v])=>["-v",`${key}=${typeof v==="string"?v:JSON.stringify(v)}`])];}
function sql(statement,values={}) {
  const value=execFileSync("psql",args(values),{input:`set request.jwt.claim.role='service_role';\n${statement}`,encoding:"utf8"}).trim();
  return value?JSON.parse(value):null;
}
function concurrently(statement,values) {return new Promise((resolve,reject)=>{
  const child=execFile("psql",args(values),{encoding:"utf8"},(error,out)=>{if(error)reject(error);else try{resolve(JSON.parse(out.trim()));}catch(error){reject(error);}});
  child.stdin.end(`set request.jwt.claim.role='service_role';\n${statement}`);
});}
const documents=[];
for(let i=1;i<=9;i++) {
  const prefix=timelining?"033":"031";
  const doc=`d${prefix}0000-0000-4000-8100-${String(i).padStart(12,"0")}`,version=`e${prefix}0000-0000-4000-8100-${String(i).padStart(12,"0")}`;
  const chunk=i===1?`000000${timelining?"33":"31"}-0000-4000-8100-000000000000`:`f${prefix}0000-0000-4000-8100-${String(i).padStart(12,"0")}`;
  const text=timelining?`Synthetic document ${i} took effect on 2024-02-${String(10-i).padStart(2,"0")}.`:`Synthetic document ${i} reports retention ${30+i} days.`,hash=createHash("sha256").update(text).digest("hex");documents.push(doc);
  sql(`insert into public.documents(id,workspace_id,uploaded_by,filename,original_filename,status) values(:'doc',:'ws',:'actor',:'name',:'name','ready');
    insert into public.document_versions(id,workspace_id,document_id,original_bucket,original_key,original_hash,original_bytes,original_verified_at,parser_version,chunker_version,lifecycle_epoch,
      publication_state,index_generation,data_classification,classification_declared_by,classification_declared_at)
      values(:'version',:'ws',:'doc','documents',:'doc',repeat('a',64),1,now(),'synthetic','synthetic',1,'ready','comparison-generation','non_sensitive',:'actor',now());
    update public.documents set active_version_id=:'version' where id=:'doc';
    insert into public.document_chunks(id,workspace_id,document_id,version_id,chunk_index,content,original_text,original_content_hash,page_number,location,embedding_space_id)
      values(:'chunk',:'ws',:'doc',:'version',0,:'text',:'text',:'hash',2,'{"page":2}','synthetic-space');`,{doc,ws,actor,name:`Comparison ${i}.txt`,version,chunk,text,hash});
  if(i===1)sql(`insert into public.document_chunks(id,workspace_id,document_id,version_id,chunk_index,content,original_text,original_content_hash,page_number,location,embedding_space_id)
    select ('000000'||:'prefix'||'-0000-4000-8100-'||lpad(n::text,12,'0'))::uuid,:'ws',:'doc',:'version',n,
      'Unrelated appendix material.','Unrelated appendix material.',encode(sha256(convert_to('Unrelated appendix material.','UTF8')),'hex'),3,'{"page":3}','synthetic-space'
    from generate_series(1,399) n;`,{prefix:timelining?"33":"31",ws,doc,version});
}
const ctx=sql(`select jsonb_build_object('workspace_id',w.id,'user_id',:'actor','membership_revision',w.capability_revision,'policy_id',s.active_policy_id,
  'policy_version',s.policy_version,'deadline',clock_timestamp()+interval '10 minutes') from public.workspaces w join public.workspace_settings s on s.workspace_id=w.id where w.id=:'ws';`,{actor,ws});
const base=sql("select plan from public.research_plans where plan->>'plan_id'='mode-COMPARE';");
const plan=sql("select public.nexus_research_plan(:'ctx'::jsonb,'create',p_plan=>:'plan'::jsonb,p_key=>:'key');",{ctx,key:`actual-${mode}-plan`,plan:{...base,
  plan_id:`actual-${mode}-plan`,mode,question:timelining?"Timeline of synthetic policy changes.":"Compare retention periods.",subquestions:timelining?["Create chronology.","List events."]:["Compare retention duration.","Compare reported days."],
  private_source_ids:documents,public_provider_ids:[],entity_scope:[],rights_constraints:[],expected_calculations:[],date_from:null,date_to:null,jurisdiction:null}});
const start="select public.nexus_research_run(:'ctx'::jsonb,'create',:'plan'::uuid,p_key=>:'key',p_command=>'{\"non_sensitive_attested\":true}');";
const starts=await Promise.all([concurrently(start,{ctx,plan:plan.id,key:`actual-${mode}-start`}),concurrently(start,{ctx,plan:plan.id,key:`actual-${mode}-start`})]);
assert.equal(starts[0].id,starts[1].id);let run=starts[0];assert.equal(run.total_steps,6);
const tables=new Set(["workspaces","workspace_settings","documents","document_versions","document_chunks","research_runs","finding_versions"]),sent=[],lexicalReads=[];
async function db(_env,path,init={}) {
  const url=new URL(`https://local.invalid/${path}`),table=url.pathname.slice(1),p=init.body?JSON.parse(init.body):{};
  if(table==="rpc/nexus_research_step")return sql("select public.nexus_research_step(:'ctx'::jsonb,:'op',:'id'::uuid,:'generation'::integer,:'position'::integer,nullif(:'token','')::uuid,nullif(:'result','')::jsonb,nullif(:'error',''));",
    {ctx:p.p_context,op:p.p_operation,id:p.p_id,generation:p.p_generation,position:p.p_position,token:p.p_token||"",result:p.p_result?JSON.stringify(p.p_result):"",error:p.p_error||""});
  if(table==="rpc/nexus_research_finding_contract")return sql("select public.nexus_research_finding_contract();");
  if(table==="rpc/nexus_finding")return sql("select public.nexus_finding(:'ctx'::jsonb,:'op',nullif(:'id','')::uuid,:'command'::jsonb,nullif(:'revision','')::bigint,nullif(:'key',''),nullif(:'hash',''));",
    {ctx:p.p_context,op:p.p_operation,id:p.p_id||"",command:p.p_command,revision:p.p_revision||"",key:p.p_key||"",hash:p.p_hash||""});
  assert.ok(tables.has(table),table);const filters={};
  for(const [key,value] of url.searchParams) {
    if(["select","limit","order"].includes(key))continue;
    if(value.startsWith("eq."))filters[key]=[value.slice(3)];
    else if(value.startsWith("in.(")&&value.endsWith(")"))filters[key]=value.slice(4,-1).split(",");
    else throw Error(`Unsupported disposable filter ${key}`);
  }
  const limit=Number(url.searchParams.get("limit")||201),order=url.searchParams.get("order");
  assert.ok(Number.isSafeInteger(limit)&&limit>0&&limit<=201);assert.ok(!order||order==="id.asc");
  if(table==="document_chunks"&&!url.searchParams.has("id"))lexicalReads.push({limit,version:url.searchParams.get("version_id")});
  return sql(`select coalesce(jsonb_agg(value),'[]') from (select to_jsonb(t) value from public.${table} t
    where not exists(select 1 from jsonb_each(:'filters'::jsonb) f where not(f.value ? (to_jsonb(t)->>f.key))) ${order?"order by t.id asc":""} limit ${limit}) rows;`,{filters});
}
let generations=0;const ordinaryFetch=globalThis.fetch;
globalThis.fetch=async(input,init={})=>{
  const url=new URL(input),json=value=>new Response(JSON.stringify(value));
  if(url.hostname==="comparison-peer.invalid") {
    const p=JSON.parse(init.body);
    if(url.pathname.endsWith("v6_reserve_many"))return json({state:"READY",reservations:Object.entries(p.p_dimensions).map(([,amount])=>({id:randomUUID(),amount,replayed:false}))});
    if(url.pathname.endsWith("v6_settle_many"))return json({state:"SETTLED"});
  }
  if(url.hostname==="generativelanguage.googleapis.com") {
    if(url.pathname.endsWith(":embedContent"))return json({embedding:{values:Array(8).fill(0.1)}});
    generations++;const prompt=JSON.parse(init.body).contents[0].parts[0].text;
    const docs=JSON.parse(prompt.split(timelining?"TIMELINE_DOCUMENTS:\n":"COMPARISON_DOCUMENTS:\n")[1].split("\nEVIDENCE:\n")[0]);
    const sources=JSON.parse(prompt.split("\nEVIDENCE:\n")[1]);
    const output=timelining?{documents:docs.map(d=>{const s=sources.find(s=>s.document_id===d.document_id);return {document_id:d.document_id,events:[{citation_id:s.citation_id,
      quote:s.content,date_text:s.content.match(/\d{4}-\d{2}-\d{2}/)[0],date_role:"EFFECTIVE"}]};})}:
      {cells:docs.map(d=>{const s=sources.find(s=>s.document_id===d.document_id);return {document_id:d.document_id,answer:`Retention ${s.content.match(/retention (\d+) days/)[1]} days [${s.citation_id}].`};})};
    return json({candidates:[{finishReason:"STOP",content:{parts:[{text:JSON.stringify(output)}]}}]});
  }
  if(url.hostname==="comparison-qdrant.invalid")return json({result:{points:[]}});
  throw Error(`Unexpected local fixture egress ${url.hostname}`);
};
try {
  const env={SUPABASE_URL:"https://comparison-peer.invalid",SUPABASE_SERVICE_ROLE_KEY:"synthetic",GOOGLE_API_KEY:"synthetic-no-live-key",
    QDRANT_URL:"https://comparison-qdrant.invalid",QDRANT_API_KEY:"synthetic",INGESTION_QUEUE:{send:async message=>sent.push(message)}};
  let message={kind:"research",run_id:run.id,workspace_id:ws,generation:1,position:0};
  for(let i=0;i<6;i++) {
    run=await processResearchMessage(env,message,db);assert.equal(run.position,i+1);
    if(i<5){message=sent.shift();assert.equal(message.position,i+1);}
  }
  assert.equal(run.state,"completed");assert.equal(generations,6);
  assert.ok(run.results[0].coverage.lexical_limit_reached);
  assert.equal(new Set(run.results[0].sources.map(source=>source.document_id)).size,8);
  assert.equal(lexicalReads.length,27);
  assert.ok(lexicalReads.slice(0,8).reduce((sum,read)=>sum+read.limit,0)<=201);
  if(timelining) {
    assert.equal(run.results.flatMap(r=>r.timeline.events).length,27);
    assert.equal(run.results[5].timeline.events[0].document_id,documents[8]);assert.equal(run.results[5].timeline.events[0].date_text,"2024-02-01");
    const dates=["", "03/04/2024","2024/2025","2025/2024","0000","9999","2024-02-29T09:30:00+05:30","2024-01-01T24:00:00Z","2024-01-01T00:00:60Z","2024-01-01T00:00:00+14:30",
      "0001-01-01T00:00:00+14:00","0001-01-01T00:00:00Z","9998-12-31T23:30:00-14:00","2024-01-01T00:00:00.123-14:00"];
    for(const year of ["0067","0100","1900","2000","2023","2024"])for(const month of ["01","02","04","12"])for(const day of ["01","28","29","30","31"])dates.push(`${year}-${month}-${day}`);
    for(const year of ["0067","1900","2000","2024"])dates.push(year,`${year}-02`,`${year}-12`);
    const normalized=sql("select jsonb_agg(public.nexus_timeline_date(value) order by ordinal) from jsonb_array_elements_text(:'dates'::jsonb) with ordinality d(value,ordinal);",{dates});
    assert.deepEqual(normalized,dates.map(timelineDate));
    console.log(`TIMELINE_NATIVE_DATE_PARITY_PASS cases=${dates.length}`);
  } else {
    assert.equal(run.results.flatMap(r=>r.comparison.cells).length,27);
    assert.equal(run.results[5].comparison.cells[0].document_id,documents[8]);assert.equal(run.results[5].comparison.cells[0].answer,"Retention 39 days [S1].");
  }
  await processResearchMessage(env,message,db);assert.equal(generations,6);
  const request=new Request("https://gateway.invalid/api/v2/findings",{method:"POST",headers:{"Idempotency-Key":`${mode}-finding-later-batch`},
    body:JSON.stringify({title:"Later comparison batch",research_run_id:run.id,result_index:5})});
  const response=await handleWorkbench({request,env,user:{id:actor},workspace:ws,member:{role:"owner"},serviceRequest:db,
    json:(_request,_env,value,status=200)=>new Response(JSON.stringify(value),{status})});
  assert.equal(response.status,201);const finding=await response.json();
  assert.equal(finding.source_research_position,5);assert.equal(finding.research_origin[timelining?"timeline":"comparison"].criterion_index,2);
  assert.equal(finding.research_origin[timelining?"timeline":"comparison"].batch_index,1);assert.equal(finding.evidence.length,1);
  assert.equal(finding.evidence[0].document_id,documents[8]);assert.deepEqual(finding.evidence[0].location,{page:2});
  console.log(JSON.stringify({marker:timelining?"REAL_SQL_PRODUCTION_TIMELINE_EXECUTOR_PASS":"REAL_SQL_PRODUCTION_COMPARISON_EXECUTOR_PASS",documents:9,criteria:3,batches:6,cells_or_events:27,
    independently_concurrent_start_connections:2,starts_saved:1,generation_calls:generations,last_finding_position:5,exact_original_hash: finding.evidence[0].original_content_hash,
    first_document_chunks:400,first_batch_distinct_sources:8,first_batch_lexical_row_budget:lexicalReads.slice(0,8).reduce((sum,read)=>sum+read.limit,0),
    quota_provider_peers:"CONTROLLED_NOT_LIVE_QUALITY_OR_SQL_BUDGET_PROOF",provider_processing:false,hosted_acceptance:false}));
} finally {globalThis.fetch=ordinaryFetch;}
