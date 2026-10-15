// The production executor commits real PostgreSQL rows; only provider/quota peers
// and the REST-to-local-SQL transport are controlled. Never run on hosted data.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash,randomUUID } from "node:crypto";
import { processResearchMessage } from "../../apps/gateway/src/research-executor.js";
assert.equal(process.env.NEXUS_DISPOSABLE_SQL,"1");
assert.ok(process.env.PGHOST?.startsWith("/"));
const ws="11111111-1111-4111-8111-111111111111",actor="22222222-2222-4222-8222-222222222222";
const doc="d0290000-0000-4000-8000-000000000021",version="d0290000-0000-4000-8000-000000000022",chunk="d0290000-0000-4000-8000-000000000023";
function sql(statement,values={}) {
  const args=["-X","-qAt","-v","ON_ERROR_STOP=1",...Object.entries(values).flatMap(([key,value])=>["-v",`${key}=${typeof value==="string"?value:JSON.stringify(value)}`])];
  const output=execFileSync("psql",args,{input:`set request.jwt.claim.role='service_role';\n${statement}\n`,encoding:"utf8"}).trim();
  return output?JSON.parse(output):null;
}
const text="The synthetic mass is 1.005 kg.",hash=createHash("sha256").update(text).digest("hex");
sql(`insert into public.documents(id,workspace_id,uploaded_by,filename,original_filename,status) values(:'doc',:'ws',:'actor','executor.txt','executor.txt','ready');
insert into public.document_versions(id,workspace_id,document_id,original_bucket,original_key,original_hash,original_bytes,original_verified_at,parser_version,chunker_version,lifecycle_epoch,
publication_state,index_generation,data_classification,classification_declared_by,classification_declared_at)
values(:'version',:'ws',:'doc','documents','local-executor',repeat('a',64),1,now(),'synthetic','synthetic',1,'ready','executor-generation','non_sensitive',:'actor',now());
update public.documents set active_version_id=:'version' where id=:'doc';
insert into public.document_chunks(id,workspace_id,document_id,version_id,chunk_index,content,original_text,original_content_hash,page_number,location,embedding_space_id)
values(:'chunk',:'ws',:'doc',:'version',0,:'text',:'text',:'hash',2,'{"page":2}','synthetic-space');`,{doc,ws,actor,version,chunk,text,hash});
const context=sql(`select jsonb_build_object('workspace_id',w.id,'user_id',:'actor','membership_revision',w.capability_revision,'policy_id',s.active_policy_id,
'policy_version',s.policy_version,'deadline',clock_timestamp()+interval '5 minutes') from public.workspaces w join public.workspace_settings s on s.workspace_id=w.id where w.id=:'ws';`,{actor,ws});
const base=sql("select plan from public.research_plans where plan->>'plan_id'='mode-EVIDENCE_ANSWER';");
const plan=sql("select public.nexus_research_plan(:'ctx'::jsonb,'create',p_plan=>:'plan'::jsonb,p_key=>'actual-executor-plan');",{ctx:context,
  plan:{...base,plan_id:"actual-executor-plan",question:"What is the synthetic mass?",subquestions:["How much mass is reported?"],private_source_ids:[doc]}});
const run=sql("select public.nexus_research_run(:'ctx'::jsonb,'create',:'plan'::uuid,p_key=>'actual-executor-start',p_command=>'{\"non_sensitive_attested\":true}');",{ctx:context,plan:plan.id});
const tables=new Set(["workspaces","workspace_settings","documents","document_versions","document_chunks","research_runs"]),sent=[];
async function db(_env,path,init={}) {
  const url=new URL(`https://local.invalid/${path}`),table=url.pathname.slice(1);
  if(table==="rpc/nexus_research_step") {
    const p=JSON.parse(init.body);
    return sql("select public.nexus_research_step(:'ctx'::jsonb,:'op',:'id'::uuid,:'generation'::integer,:'position'::integer,nullif(:'token','')::uuid,nullif(:'result','')::jsonb,nullif(:'error',''));",
      {ctx:p.p_context,op:p.p_operation,id:p.p_id,generation:p.p_generation,position:p.p_position,token:p.p_token||"",result:p.p_result?JSON.stringify(p.p_result):"",error:p.p_error||""});
  }
  assert.ok(tables.has(table),table);
  const filters={};
  for(const [key,value] of url.searchParams) {
    if(["select","limit","order"].includes(key))continue;
    if(value.startsWith("eq."))filters[key]=[value.slice(3)];
    else if(value.startsWith("in.(")&&value.endsWith(")"))filters[key]=value.slice(4,-1).split(",");
    else throw Error(`Unsupported local transport filter ${key}`);
  }
  const limit=Number(url.searchParams.get("limit")||20);assert.ok(Number.isSafeInteger(limit)&&limit>0&&limit<=201);
  return sql(`select coalesce(jsonb_agg(row_value),'[]') from (select to_jsonb(t) row_value from public.${table} t
    where not exists(select 1 from jsonb_each(:'filters'::jsonb) f where not (f.value ? (to_jsonb(t)->>f.key))) limit :'limit'::integer) rows;`,{filters,limit});
}
let generations=0;
const ordinaryFetch=globalThis.fetch;
globalThis.fetch=async(input,init={})=>{
  const url=new URL(input),json=value=>new Response(JSON.stringify(value));
  if(url.hostname==="executor-peer.invalid") {
    const p=JSON.parse(init.body);
    if(url.pathname.endsWith("v6_reserve_many"))return json({state:"READY",reservations:Object.entries(p.p_dimensions).map(([,amount])=>({id:randomUUID(),amount,replayed:false}))});
    if(url.pathname.endsWith("v6_settle_many"))return json({state:"SETTLED"});
  }
  if(url.hostname==="generativelanguage.googleapis.com") {
    if(url.pathname.endsWith(":embedContent"))return json({embedding:{values:Array(8).fill(0.1)}});
    generations++;
    return json({candidates:[{finishReason:"STOP",content:{parts:[{text:"Mass is 1.005 kg [S1]."}]}}]});
  }
  if(url.hostname==="executor-qdrant.invalid")return json(url.pathname.endsWith("/points/query")?{result:{points:[{id:chunk,score:0.9,
    payload:{workspace_id:ws,document_id:doc,version_id:version,index_generation:"executor-generation",chunk_id:chunk}}]}}:{});
  throw Error(`Unapproved local fixture egress ${url.hostname}`);
};
try {
  const env={SUPABASE_URL:"https://executor-peer.invalid",SUPABASE_SERVICE_ROLE_KEY:"synthetic",GOOGLE_API_KEY:"synthetic-no-live-key",QDRANT_URL:"https://executor-qdrant.invalid",QDRANT_API_KEY:"synthetic",
    INGESTION_QUEUE:{send:async message=>sent.push(message)}};
  const message={kind:"research",run_id:run.id,workspace_id:ws,generation:1,position:0};
  assert.equal((await processResearchMessage(env,message,db)).position,1);
  assert.equal(sent.length,1);assert.equal(sent[0].position,1);
  assert.equal((await processResearchMessage(env,sent[0],db)).state,"completed");
  await processResearchMessage(env,sent[0],db);
  assert.equal(generations,2);
  const read=sql("select public.nexus_research_run(:'ctx'::jsonb,'read',:'plan'::uuid,:'run'::uuid);",{ctx:context,plan:plan.id,run:run.id});
  assert.equal(read.position,2);assert.equal(read.results.length,2);assert.equal(read.state,"completed");
  for(const result of read.results){assert.equal(result.sources[0].original_content_hash,hash);assert.deepEqual(result.validated_citation_ids,["S1"]);assert.equal(result.claim_state,"REVIEW_REQUIRED");}
  console.log(JSON.stringify({marker:"REAL_SQL_PRODUCTION_EXECUTOR_PASS",questions:2,stored_answers:2,generation_calls:2,duplicate_replayed:false,
    current_source_hash:hash,node_version:process.version,quota_peer:"CONTROLLED_NOT_SQL_BUDGET_PROOF",provider_processing:false,hosted_acceptance:false}));
} finally {globalThis.fetch=ordinaryFetch;}
