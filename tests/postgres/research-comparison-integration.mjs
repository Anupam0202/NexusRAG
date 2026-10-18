// Actual comparison executor and Findings handler with owned disposable PostgreSQL.
// Provider/quota peers and REST transport are controlled, never real user/provider data.
import assert from "node:assert/strict";
import { execFile,execFileSync } from "node:child_process";
import { createHash,randomUUID } from "node:crypto";
import { processResearchMessage } from "../../apps/gateway/src/research-executor.js";
import { handleWorkbench } from "../../apps/gateway/src/workbench.js";
import { timelineDate } from "../../apps/gateway/src/research-timeline.js";
import { RESEARCH_MODE_LIMITS } from "../../apps/gateway/src/research-plans.js";
const mode=process.env.NEXUS_RESEARCH_MODE||"COMPARE",timelining=mode==="TIMELINE",contradicting=mode==="CONTRADICTION_ANALYSIS",deepening=mode==="DEEP_RESEARCH";
const deepBoundary=deepening&&process.env.NEXUS_DEEP_CONTEXT_BOUNDARY==="1",scenario=`${mode}${deepBoundary?"-context-boundary":""}`;
assert.ok(["COMPARE","TIMELINE","CONTRADICTION_ANALYSIS","DEEP_RESEARCH"].includes(mode));
assert.equal(process.env.NEXUS_DISPOSABLE_SQL,"1");assert.ok(process.env.PGHOST?.startsWith("/"));
const ws="11111111-1111-4111-8111-111111111111",actor=deepBoundary?"22222242-2222-4222-8222-222222222222":deepening?"22222241-2222-4222-8222-222222222222":"22222222-2222-4222-8222-222222222222";
function args(values){return ["-X","-qAt","-v","ON_ERROR_STOP=1",...Object.entries(values).flatMap(([key,v])=>["-v",`${key}=${typeof v==="string"?v:JSON.stringify(v)}`])];}
function sql(statement,values={}) {
  const value=execFileSync("psql",args(values),{input:`set request.jwt.claim.role='service_role';\n${statement}`,encoding:"utf8"}).trim();
  return value?JSON.parse(value):null;
}
function concurrently(statement,values) {return new Promise((resolve,reject)=>{
  const child=execFile("psql",args(values),{encoding:"utf8"},(error,out)=>{if(error)reject(error);else try{resolve(JSON.parse(out.trim()));}catch(error){reject(error);}});
  child.stdin.end(`set request.jwt.claim.role='service_role';\n${statement}`);
});}
// A fresh disposable local actor avoids consuming another scenario's five-query trial.
if(deepening)sql(`insert into auth.users(id,email,raw_user_meta_data) values(:'actor',:'email','{}');
  insert into public.workspace_members(workspace_id,user_id,role) values(:'ws',:'actor','editor');
  update public.workspace_settings set retrieval_top_k=12,hybrid_search_alpha=:'alpha'::numeric where workspace_id=:'ws';`,{actor,ws,email:`${scenario.toLowerCase()}@example.invalid`,alpha:deepBoundary?1:0.5});
const documents=[],locations=new Map();
for(let i=1;i<=(deepening?60:contradicting?50:9);i++) {
  const prefix=deepBoundary?"042":deepening?"041":contradicting?"038":timelining?"033":"031";
  const doc=`d${prefix}0000-0000-4000-8100-${String(i).padStart(12,"0")}`,version=`e${prefix}0000-0000-4000-8100-${String(i).padStart(12,"0")}`;
  const chunk=i===1?`000000${deepBoundary?"42":deepening?"41":contradicting?"38":timelining?"33":"31"}-0000-4000-8100-000000000000`:`f${prefix}0000-0000-4000-8100-${String(i).padStart(12,"0")}`;
  const text=contradicting?`\u{1F4CA} Synthetic source ${i} reports mass ${i}.005 kg.`:timelining?`Synthetic document ${i} took effect on 2024-02-${String(10-i).padStart(2,"0")}.`:`Synthetic document ${i} reports retention ${30+i} days.`,hash=createHash("sha256").update(text).digest("hex");documents.push(doc);
  const page=(contradicting||deepening)&&i<=2?(i===1?null:0):2,location=page===null||page===0?{char_start:0,char_end:Array.from(text).length}:{page};locations.set(doc,location);
  sql(`insert into public.documents(id,workspace_id,uploaded_by,filename,original_filename,status) values(:'doc',:'ws',:'actor',:'name',:'name','ready');
    insert into public.document_versions(id,workspace_id,document_id,original_bucket,original_key,original_hash,original_bytes,original_verified_at,parser_version,chunker_version,lifecycle_epoch,
      publication_state,index_generation,data_classification,classification_declared_by,classification_declared_at)
      values(:'version',:'ws',:'doc','documents',:'doc',repeat('a',64),1,now(),'synthetic','synthetic',1,'ready','comparison-generation','non_sensitive',:'actor',now());
    update public.documents set active_version_id=:'version' where id=:'doc';
    insert into public.document_chunks(id,workspace_id,document_id,version_id,chunk_index,content,original_text,original_content_hash,page_number,location,embedding_space_id)
      values(:'chunk',:'ws',:'doc',:'version',0,:'text',:'text',:'hash',nullif(:'page','')::integer,:'location'::jsonb,'synthetic-space');`,{doc,ws,actor,name:`Comparison ${i}.txt`,version,chunk,text,hash,page:page??"",location});
  if(i===1)sql(`insert into public.document_chunks(id,workspace_id,document_id,version_id,chunk_index,content,original_text,original_content_hash,page_number,location,embedding_space_id)
    select ('000000'||:'prefix'||'-0000-4000-8100-'||lpad(n::text,12,'0'))::uuid,:'ws',:'doc',:'version',n,
      'Unrelated appendix material.','Unrelated appendix material.',encode(sha256(convert_to('Unrelated appendix material.','UTF8')),'hex'),3,'{"page":3}','synthetic-space'
    from generate_series(1,399) n;`,{prefix:deepBoundary?"42":deepening?"41":contradicting?"38":timelining?"33":"31",ws,doc,version});
}
const ctx=sql(`select jsonb_build_object('workspace_id',w.id,'user_id',:'actor','membership_revision',w.capability_revision,'policy_id',s.active_policy_id,
  'policy_version',s.policy_version,'deadline',clock_timestamp()+interval '15 minutes') from public.workspaces w join public.workspace_settings s on s.workspace_id=w.id where w.id=:'ws';`,{actor,ws});
const base=sql("select plan from public.research_plans where plan->>'plan_id'='mode-COMPARE';");
const plan=sql("select public.nexus_research_plan(:'ctx'::jsonb,'create',p_plan=>:'plan'::jsonb,p_key=>:'key');",{ctx,key:`actual-${scenario}-plan`,plan:{...base,
  plan_id:`actual-${scenario}-plan`,mode,question:deepening?"Synthesize synthetic retention evidence.":contradicting?"Inspect conflicting synthetic mass statements.":timelining?"Timeline of synthetic policy changes.":"Compare retention periods.",
  subquestions:deepening?Array.from({length:12},(_,i)=>`Research synthetic retention dimension ${i+1}.`):contradicting?Array.from({length:10},(_,i)=>`Inspect synthetic mass context ${i+1}.`):timelining?["Create chronology.","List events."]:["Compare retention duration.","Compare reported days."],
  private_source_ids:documents,public_provider_ids:[],entity_scope:[],rights_constraints:[],expected_calculations:[],date_from:null,date_to:null,jurisdiction:null}});
const start="select public.nexus_research_run(:'ctx'::jsonb,'create',:'plan'::uuid,p_key=>:'key',p_command=>'{\"non_sensitive_attested\":true}');";
const starts=await Promise.all([concurrently(start,{ctx,plan:plan.id,key:`actual-${scenario}-start`}),concurrently(start,{ctx,plan:plan.id,key:`actual-${scenario}-start`})]);
assert.equal(starts[0].id,starts[1].id);let run=starts[0];const steps=deepening?13:contradicting?11:6;assert.equal(run.total_steps,steps);
if(deepening){assert.equal(run.admission.credential_mode,"platform_trial");assert.equal(sql("select free_chat_queries from public.nexus_account_usage where user_id=:'actor';",{actor}),1);}
const tables=new Set(["workspaces","workspace_settings","documents","document_versions","document_chunks","research_runs","finding_versions"]),sent=[],lexicalReads=[];
let outbound=0;
async function db(_env,path,init={}) {
  outbound++;
  const url=new URL(`https://local.invalid/${path}`),table=url.pathname.slice(1),p=init.body?JSON.parse(init.body):{};
  if(table==="rpc/nexus_research_candidates") {
    const result=sql("select public.nexus_research_candidates(:'ctx'::jsonb,:'id'::uuid,:'generation'::integer,:'position'::integer,array(select jsonb_array_elements_text(:'ids'::jsonb)::uuid));",
      {ctx:p.p_context,id:p.p_id,generation:p.p_generation,position:p.p_position,ids:p.p_document_ids});
    lexicalReads.push({rows:result.lexical_rows_read,documents:p.p_document_ids.length});return result;
  }
  if(table==="rpc/nexus_research_step")return sql("select public.nexus_research_step(:'ctx'::jsonb,:'op',:'id'::uuid,:'generation'::integer,:'position'::integer,nullif(:'token','')::uuid,nullif(:'result','')::jsonb,nullif(:'error',''));",
    {ctx:p.p_context,op:p.p_operation,id:p.p_id,generation:p.p_generation,position:p.p_position,token:p.p_token||"",result:p.p_result?JSON.stringify(p.p_result):"",error:p.p_error||""});
  if(table==="rpc/nexus_research_deep_context")return sql("select public.nexus_research_deep_context(:'ctx'::jsonb,:'id'::uuid,:'generation'::integer,:'position'::integer);",
    {ctx:p.p_context,id:p.p_id,generation:p.p_generation,position:p.p_position});
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
let generations=0,expansions=0,peerFailure=null;const ordinaryFetch=globalThis.fetch;
const controlledFetch=async(input,init={})=>{
  outbound++;
  const url=new URL(input),json=value=>new Response(JSON.stringify(value));
  if(url.hostname==="comparison-peer.invalid") {
    const p=JSON.parse(init.body);
    if(url.pathname.endsWith("v6_reserve_many"))return json({state:"READY",reservations:Object.entries(p.p_dimensions).map(([,amount])=>({id:randomUUID(),amount,replayed:false}))});
    if(url.pathname.endsWith("v6_settle_many"))return json({state:"SETTLED"});
  }
  if(url.hostname==="generativelanguage.googleapis.com") {
    if(url.pathname.endsWith(":embedContent"))return json({embedding:{values:Array(8).fill(0.1)}});
    if(url.pathname.endsWith(":batchEmbedContents"))return json({embeddings:JSON.parse(init.body).requests.map(()=>({values:Array(8).fill(0.1)}))});
    const prompt=JSON.parse(init.body).contents[0].parts[0].text;
    if(prompt.startsWith("RESEARCH_QUERY_VARIANTS")) {
      expansions++;const question=prompt.split("QUESTION:\n")[1];
      const words=["duration","interval","policy","schedule","rule","period","context"];
      return json({candidates:[{finishReason:"STOP",content:{parts:[{text:JSON.stringify({queries:words.slice(0,RESEARCH_MODE_LIMITS[mode].max_query_variants-1).map(word=>`${question} ${word}`)})}]}}]});
    }
    generations++;
    const docs=deepening?null:JSON.parse(prompt.split(contradicting?"CONTRADICTION_DOCUMENTS:\n":timelining?"TIMELINE_DOCUMENTS:\n":"COMPARISON_DOCUMENTS:\n")[1].split("\nEVIDENCE:\n")[0]);
    const sources=JSON.parse(prompt.split("\nEVIDENCE:\n")[1]);
    if(deepening&&prompt.startsWith("DEEP_RESEARCH_SYNTHESIS"))assert.equal(JSON.parse(prompt.split("PREVIOUS_ANALYSES_NOT_EVIDENCE:\n")[1].split("\nEVIDENCE:\n")[0]).length,12);
    const output=deepening?{answer:`The original reports ${sources[0].content} [S1].`,limitations:["Bounded selected-source research; independent review required."],gaps:[]}:contradicting?{pairs:[{left:{citation_id:sources[0].citation_id,quote:sources[0].content.slice(3)},
      right:{citation_id:sources.at(-1).citation_id,quote:sources.at(-1).content.slice(3)},relationship:"INSUFFICIENT_CONTEXT",
      explanation:"The measurements have different reported values; their context and equivalence still require review."}]}:timelining?{documents:docs.map(d=>{const s=sources.find(s=>s.document_id===d.document_id);return {document_id:d.document_id,events:[{citation_id:s.citation_id,
      quote:s.content,date_text:s.content.match(/\d{4}-\d{2}-\d{2}/)[0],date_role:"EFFECTIVE"}]};})}:
      {cells:docs.map(d=>{const s=sources.find(s=>s.document_id===d.document_id);return {document_id:d.document_id,answer:`Retention ${s.content.match(/retention (\d+) days/)[1]} days [${s.citation_id}].`};})};
    return json({candidates:[{finishReason:"STOP",content:{parts:[{text:JSON.stringify(output)}]}}]});
  }
  if(url.hostname==="comparison-qdrant.invalid") {
    const points=deepBoundary?Array.from({length:12},(_,i)=>({id:`00000042-0000-4000-8100-${String(generations*12+i+1).padStart(12,"0")}`,score:1-i/100,
      payload:{workspace_id:ws,document_id:documents[0],version_id:"e0420000-0000-4000-8100-000000000001",index_generation:"comparison-generation",
        chunk_id:`00000042-0000-4000-8100-${String(generations*12+i+1).padStart(12,"0")}`}})):[];
    return json(url.pathname.endsWith("/points/query/batch")?{result:JSON.parse(init.body).searches.map(()=>({points}))}:{result:{points}});
  }
  throw Error(`Unexpected local fixture egress ${url.hostname}`);
};
globalThis.fetch=async(...args)=>{try{return await controlledFetch(...args);}catch(error){peerFailure=error.stack;throw error;}};
try {
  const env={SUPABASE_URL:"https://comparison-peer.invalid",SUPABASE_SERVICE_ROLE_KEY:"synthetic",GOOGLE_API_KEY:"synthetic-no-live-key",
    QDRANT_URL:"https://comparison-qdrant.invalid",QDRANT_API_KEY:"synthetic",INGESTION_QUEUE:{send:async message=>sent.push(message)}};
  let message={kind:"research",run_id:run.id,workspace_id:ws,generation:1,position:0};
  for(let i=0;i<steps;i++) {
    const before=outbound;
    run=await processResearchMessage(env,message,db);
    assert.ok(run,`Actual ${mode} executor interrupted at step ${i}: ${JSON.stringify(sql("select jsonb_build_object('state',state,'error_code',error_code,'position',position) from public.research_runs where id=:'id';",{id:message.run_id}))}; controlled peer: ${peerFailure||'no peer exception'}`);
    assert.equal(run.position,i+1);
    assert.ok(outbound-before<50,`Actual executor needs ${outbound-before} transport requests`);
    assert.equal(run.results[i].query_retrieval.completed_queries,RESEARCH_MODE_LIMITS[mode].max_query_variants);
    assert.equal(run.results[i].query_retrieval.queries[0],run.results[i].question);
    if(i<steps-1){message=sent.shift();assert.equal(message.position,i+1);}
  }
  assert.equal(run.state,"completed");assert.equal(generations,steps);assert.equal(expansions,steps);
  assert.ok(run.results[0].coverage.lexical_limit_reached);
  assert.equal(new Set(run.results[0].sources.map(source=>source.document_id)).size,deepBoundary?1:deepening?12:contradicting?2:8);
  assert.equal(lexicalReads.length,steps);
  assert.ok(lexicalReads.every(read=>read.rows<=201));
  assert.equal(lexicalReads[0].documents,deepening?60:contradicting?50:8);
  if(deepening) {
    assert.ok(run.results.every(result=>result.deep.documents.slice(0,2).every((document,index)=>
      document.consulted_sources.find(source=>source.chunk_index===0)?.page_number===(index===0?null:0))));
    assert.ok(run.results.every(result=>result.runtime_options.retrieval_top_k===12));
    assert.equal(run.results.flatMap(result=>result.deep.documents).length,780);
    assert.equal(run.results[12].deep.phase,"SYNTHESIS");assert.equal(run.results[12].deep.prior_results.length,12);
    assert.ok(run.results[12].sources.length>=12&&run.results[12].sources.length<=156);
    if(deepBoundary) {
      assert.equal(new Set(run.results.slice(0,12).flatMap(result=>result.sources.map(source=>source.chunk_id))).size,144);
      assert.equal(run.results[12].sources.length,156);
      assert.equal(new Set(run.results[12].sources.map(source=>source.chunk_id)).size,156);
      assert.ok(run.results.every(result=>result.runtime_options.hybrid_search_alpha===1));
    }
    assert.ok(run.results.every((result,index)=>result.deep.criterion_index===index&&result.deep.documents.length===60
      &&result.deep.documents.every(document=>document.consulted_sources.length>=1)));
    const reread=sql("select public.nexus_research_run(:'ctx'::jsonb,'read',:'plan'::uuid,:'id'::uuid);",{ctx,plan:plan.id,id:run.id});
    assert.deepEqual(reread.results,run.results);
  } else if(contradicting) {
    assert.ok(run.results.every(result=>result.contradiction.documents.slice(0,2).every((document,index)=>
      document.consulted_sources.find(source=>source.chunk_index===0)?.page_number===(index===0?null:0))));
    assert.equal(run.results.flatMap(r=>r.contradiction.documents).length,550);
    assert.ok(run.results.every((r,i)=>r.contradiction.criterion_index===i&&r.contradiction.pairs.length===1&&r.contradiction.documents.length===50
      &&r.contradiction.documents.every(d=>d.consulted_sources.length===1)&&r.contradiction.pairs[0].left.document_id===documents[0]
      &&r.contradiction.pairs[0].right.document_id===documents[49]&&r.contradiction.pairs[0].left.quote_start===2));
    const reread=sql("select public.nexus_research_run(:'ctx'::jsonb,'read',:'plan'::uuid,:'id'::uuid);",{ctx,plan:plan.id,id:run.id});
    assert.deepEqual(reread.results,run.results);
  } else if(timelining) {
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
  await processResearchMessage(env,message,db);assert.equal(generations,steps);assert.equal(expansions,steps);
  const findingPosition=deepening?12:contradicting?10:5;
  const request=new Request("https://gateway.invalid/api/v2/findings",{method:"POST",headers:{"Idempotency-Key":`${scenario}-finding-later-batch`},
    body:JSON.stringify({title:"Later scoped analysis",research_run_id:run.id,result_index:findingPosition})});
  const response=await handleWorkbench({request,env,user:{id:actor},workspace:ws,member:{role:deepening?"editor":"owner"},serviceRequest:db,
    json:(_request,_env,value,status=200)=>new Response(JSON.stringify(value),{status})});
  assert.equal(response.status,201);const finding=await response.json();
  assert.equal(finding.source_research_position,findingPosition);assert.equal(finding.research_origin[deepening?"deep":contradicting?"contradiction":timelining?"timeline":"comparison"].criterion_index,deepening?12:contradicting?10:2);
  if(!contradicting&&!deepening)assert.equal(finding.research_origin[timelining?"timeline":"comparison"].batch_index,1);
  assert.equal(finding.evidence.length,contradicting?2:1);
  assert.equal(finding.evidence[0].document_id,deepening?run.results[12].sources[0].document_id:documents[contradicting?0:8]);assert.deepEqual(finding.evidence[0].location,deepBoundary?{page:3}:locations.get(finding.evidence[0].document_id));
  assert.deepEqual(finding.research_origin.query_retrieval,run.results[findingPosition].query_retrieval);
  console.log(`RESEARCH_QUERY_RETRIEVAL_SQL_PASS mode=${mode} queries=${RESEARCH_MODE_LIMITS[mode].max_query_variants} steps=${steps} lexical_rpc_per_step=1 original_row_budget=201 outbound_per_step_below=50`);
  console.log(JSON.stringify({marker:deepening?"REAL_SQL_PRODUCTION_DEEP_EXECUTOR_PASS":contradicting?"REAL_SQL_PRODUCTION_CONTRADICTION_EXECUTOR_PASS":timelining?"REAL_SQL_PRODUCTION_TIMELINE_EXECUTOR_PASS":"REAL_SQL_PRODUCTION_COMPARISON_EXECUTOR_PASS",
    documents:deepening?60:contradicting?50:9,criteria:deepening?13:contradicting?11:3,steps,cells_events_or_consulted_receipts:deepening?780:contradicting?550:27,
    independently_concurrent_start_connections:2,starts_saved:1,generation_calls:generations,last_finding_position:findingPosition,exact_original_hash: finding.evidence[0].original_content_hash,
    first_document_chunks:400,first_step_paired_or_cited_sources:deepBoundary?1:deepening?12:contradicting?2:8,first_step_lexical_rows_read:lexicalReads[0].rows,
    ...(deepBoundary?{max_context_boundary:true,unique_prior_originals:144,final_original_contexts:156}:{}),
    ...((deepening||contradicting)?{original_null_zero_positive_page_receipts:true}:{}),
    quota_provider_peers:"CONTROLLED_NOT_LIVE_QUALITY_OR_SQL_BUDGET_PROOF",provider_processing:false,hosted_acceptance:false}));
} finally {globalThis.fetch=ordinaryFetch;}
