// Actual comparison executor and Findings handler with owned disposable PostgreSQL.
// Provider/quota peers and REST transport are controlled, never real user/provider data.
import assert from "node:assert/strict";
import { execFile,execFileSync } from "node:child_process";
import { createHash,randomUUID } from "node:crypto";
import { processResearchMessage } from "../../apps/gateway/src/research-executor.js";
import { handleWorkbench } from "../../apps/gateway/src/workbench.js";
import { handleResearchRuns } from "../../apps/gateway/src/research-runs.js";
import { timelineDate } from "../../apps/gateway/src/research-timeline.js";
import { RESEARCH_MODE_LIMITS } from "../../apps/gateway/src/research-plans.js";
import {obligationCapacity,obligationWire} from "../fixtures/research-obligation-capacity.mjs";
const mode=process.env.NEXUS_RESEARCH_MODE||"COMPARE",timelining=mode==="TIMELINE",contradicting=mode==="CONTRADICTION_ANALYSIS",deepening=mode==="DEEP_RESEARCH",obligating=mode==="OBLIGATION_ANALYSIS";
const deepBoundary=deepening&&process.env.NEXUS_DEEP_CONTEXT_BOUNDARY==="1",scenario=`${mode}${deepBoundary?"-context-boundary":""}`;
assert.ok(["COMPARE","TIMELINE","CONTRADICTION_ANALYSIS","DEEP_RESEARCH","OBLIGATION_ANALYSIS"].includes(mode));
assert.equal(process.env.NEXUS_DISPOSABLE_SQL,"1");assert.ok(process.env.PGHOST?.startsWith("/"));
const ws="11111111-1111-4111-8111-111111111111",actor=obligating?"22222244-2222-4222-8222-222222222222":deepBoundary?"22222242-2222-4222-8222-222222222222":deepening?"22222241-2222-4222-8222-222222222222":"22222222-2222-4222-8222-222222222222";
const args=["-X","-qAt","-v","ON_ERROR_STOP=1"];
function sqlInput(statement,values) {
  const keys=Object.keys(values);assert.ok(keys.every(key=>/^[a-z_]+$/.test(key)));
  const parameters=JSON.stringify(Object.fromEntries(Object.entries(values).map(([key,value])=>[key,typeof value==="string"?value:JSON.stringify(value)])));
  // stdin avoids OS argument-size limits for actual multi-megabyte result RPCs.
  return `set request.jwt.claim.role='service_role';\n${keys.length?`select ${keys.map(key=>`params->>'${key}' as "${key}"`).join(",")} from (select '${parameters.replaceAll("'","''")}'::jsonb params) input\n\\gset\n`:""}${statement}`;
}
function sql(statement,values={}) {
  const value=execFileSync("psql",args,{input:sqlInput(statement,values),encoding:"utf8",maxBuffer:32*1024*1024}).trim();
  return value?JSON.parse(value):null;
}
function concurrently(statement,values) {return new Promise((resolve,reject)=>{
  const child=execFile("psql",args,{encoding:"utf8",maxBuffer:32*1024*1024},(error,out)=>{if(error)reject(error);else try{resolve(JSON.parse(out.trim()));}catch(error){reject(error);}});
  child.stdin.end(sqlInput(statement,values));
});}
// A fresh disposable local actor avoids consuming another scenario's five-query trial.
if(deepening||obligating)sql(`insert into auth.users(id,email,raw_user_meta_data) values(:'actor',:'email','{}');
  insert into public.workspace_members(workspace_id,user_id,role) values(:'ws',:'actor','editor');
  update public.workspace_settings set retrieval_top_k=12,hybrid_search_alpha=:'alpha'::numeric where workspace_id=:'ws';`,{actor,ws,email:`${scenario.toLowerCase()}@example.invalid`,alpha:deepBoundary?1:0.5});
const documents=[],locations=new Map();
for(let i=1;i<=(deepening?60:contradicting||obligating?50:9);i++) {
  const prefix=obligating?"044":deepBoundary?"042":deepening?"041":contradicting?"038":timelining?"033":"031";
  const doc=`d${prefix}0000-0000-4000-8100-${String(i).padStart(12,"0")}`,version=`e${prefix}0000-0000-4000-8100-${String(i).padStart(12,"0")}`;
  const chunk=i===1?`000000${obligating?"44":deepBoundary?"42":deepening?"41":contradicting?"38":timelining?"33":"31"}-0000-4000-8100-000000000000`:`f${prefix}0000-0000-4000-8100-${String(i).padStart(12,"0")}`;
  const text=obligating?`\u{1F4CA} Synthetic operator ${i} must retain reports for 30 days, except public summaries.`:contradicting?`\u{1F4CA} Synthetic source ${i} reports mass ${i}.005 kg.`:timelining?`Synthetic document ${i} took effect on 2024-02-${String(10-i).padStart(2,"0")}.`:`Synthetic document ${i} reports retention ${30+i} days.`,hash=createHash("sha256").update(text).digest("hex");documents.push(doc);
  const page=(contradicting||deepening||obligating)&&i<=2?(i===1?null:0):2,location=page===null||page===0?{char_start:0,char_end:Array.from(text).length}:{page};locations.set(doc,location);
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
    from generate_series(1,399) n;`,{prefix:obligating?"44":deepBoundary?"42":deepening?"41":contradicting?"38":timelining?"33":"31",ws,doc,version});
}
const ctx=sql(`select jsonb_build_object('workspace_id',w.id,'user_id',:'actor','membership_revision',w.capability_revision,'policy_id',s.active_policy_id,
  'policy_version',s.policy_version,'deadline',clock_timestamp()+interval '15 minutes') from public.workspaces w join public.workspace_settings s on s.workspace_id=w.id where w.id=:'ws';`,{actor,ws});
const base=sql("select plan from public.research_plans where plan->>'plan_id'='mode-COMPARE';");
const plan=sql("select public.nexus_research_plan(:'ctx'::jsonb,'create',p_plan=>:'plan'::jsonb,p_key=>:'key');",{ctx,key:`actual-${scenario}-plan`,plan:{...base,
  plan_id:`actual-${scenario}-plan`,mode,question:obligating?"Which synthetic obligations need review?":deepening?"Synthesize synthetic retention evidence.":contradicting?"Inspect conflicting synthetic mass statements.":timelining?"Timeline of synthetic policy changes.":"Compare retention periods.",
  subquestions:deepening?Array.from({length:12},(_,i)=>`Research synthetic retention dimension ${i+1}.`):contradicting||obligating?Array.from({length:10},(_,i)=>`Inspect synthetic ${obligating?"duty":"mass"} context ${i+1}.`):timelining?["Create chronology.","List events."]:["Compare retention duration.","Compare reported days."],
  private_source_ids:documents,public_provider_ids:[],entity_scope:[],rights_constraints:[],expected_calculations:[],date_from:null,date_to:null,jurisdiction:null}});
const start="select public.nexus_research_run(:'ctx'::jsonb,'create',:'plan'::uuid,p_key=>:'key',p_command=>'{\"non_sensitive_attested\":true}');";
const starts=await Promise.all([concurrently(start,{ctx,plan:plan.id,key:`actual-${scenario}-start`}),concurrently(start,{ctx,plan:plan.id,key:`actual-${scenario}-start`})]);
assert.equal(starts[0].id,starts[1].id);let run=starts[0];const steps=deepening?13:contradicting||obligating?11:6;assert.equal(run.total_steps,steps);
if(deepening||obligating){assert.equal(run.admission.credential_mode,"platform_trial");assert.equal(sql("select free_chat_queries from public.nexus_account_usage where user_id=:'actor';",{actor}),1);}
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
  if(table==="rpc/nexus_research_obligation_contract")return sql("select public.nexus_research_obligation_contract();");
  if(table==="rpc/nexus_research_candidates_contract")return sql("select public.nexus_research_candidates_contract();");
  if(table==="rpc/nexus_research_run")return sql("select public.nexus_research_run(:'ctx'::jsonb,:'op',:'plan'::uuid,nullif(:'id','')::uuid,nullif(:'key',''),:'command'::jsonb,:'limit'::integer,nullif(:'after','')::uuid);",
    {ctx:p.p_context,op:p.p_operation,plan:p.p_plan,id:p.p_id||"",key:p.p_key||"",command:p.p_command,limit:p.p_limit,after:p.p_after||""});
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
let generations=0,expansions=0,peerFailure=null,nextGenerationFailure=null,nextEmptyObligations=false,capacityScenario=null;const ordinaryFetch=globalThis.fetch;
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
      return json({candidates:[{finishReason:"STOP",content:{parts:[{text:JSON.stringify({queries:words.slice(0,RESEARCH_MODE_LIMITS[mode].max_query_variants-1).map(word=>capacityScenario?`${question.split(" ")[0]} Synthetic obligation ${word}`:`${question} ${word}`)})}]}}]});
    }
    generations++;
    if(nextGenerationFailure) {
      const failure=nextGenerationFailure;nextGenerationFailure=null;
      if(failure==="unavailable")return new Response("Synthetic ordinary provider interruption",{status:503});
      if(failure==="incomplete")return json({candidates:[{finishReason:"MAX_TOKENS",content:{parts:[{text:'{"candidates":[]'}]}}]});
    }
    const docs=deepening?null:JSON.parse(prompt.split(obligating?"OBLIGATION_DOCUMENTS:\n":contradicting?"CONTRADICTION_DOCUMENTS:\n":timelining?"TIMELINE_DOCUMENTS:\n":"COMPARISON_DOCUMENTS:\n")[1].split("\nEVIDENCE:\n")[0]);
    const sources=JSON.parse(prompt.split("\nEVIDENCE:\n")[1]);
    if(capacityScenario) {
      assert.equal(sources.length,50);assert.ok(sources.every(source=>Array.from(source.content).length===1200));
      assert.equal(JSON.parse(init.body).generationConfig.maxOutputTokens,4096);
      return json({candidates:[{finishReason:"STOP",content:{parts:[{text:JSON.stringify(obligationWire(capacityScenario.candidates,sources))}]}}]});
    }
    if(deepening&&prompt.startsWith("DEEP_RESEARCH_SYNTHESIS"))assert.equal(JSON.parse(prompt.split("PREVIOUS_ANALYSES_NOT_EVIDENCE:\n")[1].split("\nEVIDENCE:\n")[0]).length,12);
    const output=obligating?{candidates:(nextEmptyObligations?[]:[sources[0],sources.at(-1)]).map(source=>({provision:{citation_id:source.citation_id,quote:source.content.slice(3)},
      authority:null,jurisdiction:null,actor:null,action:{citation_id:source.citation_id,quote:"retain reports"},applicability:null,
      deadline:{citation_id:source.citation_id,quote:"30 days"},valid_from:null,valid_to:null,definitions:[],
      exceptions:[{citation_id:source.citation_id,quote:"except public summaries"}],amendments:[],supersedes:[],
      control_candidate:"Propose retention review; exceptions and applicability remain unconfirmed.",limitations:["Independent review required."]}))}:
      deepening?{answer:`The original reports ${sources[0].content} [S1].`,limitations:["Bounded selected-source research; independent review required."],gaps:[]}:contradicting?{pairs:[{left:{citation_id:sources[0].citation_id,quote:sources[0].content.slice(3)},
      right:{citation_id:sources.at(-1).citation_id,quote:sources.at(-1).content.slice(3)},relationship:"INSUFFICIENT_CONTEXT",
      explanation:"The measurements have different reported values; their context and equivalence still require review."}]}:timelining?{documents:docs.map(d=>{const s=sources.find(s=>s.document_id===d.document_id);return {document_id:d.document_id,events:[{citation_id:s.citation_id,
      quote:s.content,date_text:s.content.match(/\d{4}-\d{2}-\d{2}/)[0],date_role:"EFFECTIVE"}]};})}:
      {cells:docs.map(d=>{const s=sources.find(s=>s.document_id===d.document_id);return {document_id:d.document_id,answer:`Retention ${s.content.match(/retention (\d+) days/)[1]} days [${s.citation_id}].`};})};
    nextEmptyObligations=false;
    return json({candidates:[{finishReason:"STOP",content:{parts:[{text:JSON.stringify(obligating?obligationWire(output.candidates,sources):output)}]}}]});
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
  assert.equal(new Set(run.results[0].sources.map(source=>source.document_id)).size,deepBoundary?1:deepening?12:contradicting||obligating?2:8);
  assert.equal(lexicalReads.length,steps);
  assert.ok(lexicalReads.every(read=>read.rows<=201));
  assert.equal(lexicalReads[0].documents,deepening?60:contradicting||obligating?50:8);
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
  } else if(obligating) {
    assert.equal(run.results.flatMap(result=>result.obligations.documents).length,550);
    assert.ok(run.results.every((result,index)=>result.obligations.criterion_index===index&&result.obligations.candidates.length===2&&result.obligations.documents.length===50
      &&result.obligations.documents.every(document=>document.consulted_sources.length===1)
      &&result.obligations.candidates[0].provision.document_id===documents[0]&&result.obligations.candidates[1].provision.document_id===documents[49]
      &&result.obligations.candidates[0].provision.quote_start===2&&result.obligations.candidates[0].exceptions[0].quote==="except public summaries"
      &&result.obligations.candidates.every(candidate=>candidate.applicability_state==="NOT_DETERMINED"&&candidate.control_state==="PROPOSED_NOT_IMPLEMENTED")
      &&result.obligations.documents[0].consulted_sources[0].page_number===null&&result.obligations.documents[1].consulted_sources[0].page_number===0));
    assert.deepEqual(sql("select public.nexus_research_run(:'ctx'::jsonb,'read',:'plan'::uuid,:'id'::uuid);",{ctx,plan:plan.id,id:run.id}).results,run.results);
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
  const findingPosition=deepening?12:contradicting||obligating?10:5;
  const request=new Request("https://gateway.invalid/api/v2/findings",{method:"POST",headers:{"Idempotency-Key":`${scenario}-finding-later-batch`},
    body:JSON.stringify({title:"Later scoped analysis",research_run_id:run.id,result_index:findingPosition})});
  const response=await handleWorkbench({request,env,user:{id:actor},workspace:ws,member:{role:deepening||obligating?"editor":"owner"},serviceRequest:db,
    json:(_request,_env,value,status=200)=>new Response(JSON.stringify(value),{status})});
  assert.equal(response.status,201);const finding=await response.json();
  assert.equal(finding.source_research_position,findingPosition);assert.equal(finding.research_origin[obligating?"obligations":deepening?"deep":contradicting?"contradiction":timelining?"timeline":"comparison"].criterion_index,deepening?12:contradicting||obligating?10:2);
  if(!contradicting&&!deepening&&!obligating)assert.equal(finding.research_origin[timelining?"timeline":"comparison"].batch_index,1);
  assert.equal(finding.evidence.length,contradicting||obligating?2:1);
  assert.equal(finding.evidence[0].document_id,deepening?run.results[12].sources[0].document_id:documents[contradicting||obligating?0:8]);assert.deepEqual(finding.evidence[0].location,deepBoundary?{page:3}:locations.get(finding.evidence[0].document_id));
  assert.deepEqual(finding.research_origin.query_retrieval,run.results[findingPosition].query_retrieval);
  console.log(`RESEARCH_QUERY_RETRIEVAL_SQL_PASS mode=${mode} queries=${RESEARCH_MODE_LIMITS[mode].max_query_variants} steps=${steps} lexical_rpc_per_step=1 original_row_budget=201 outbound_per_step_below=50`);
  console.log(JSON.stringify({marker:obligating?"REAL_SQL_PRODUCTION_OBLIGATION_EXECUTOR_PASS":deepening?"REAL_SQL_PRODUCTION_DEEP_EXECUTOR_PASS":contradicting?"REAL_SQL_PRODUCTION_CONTRADICTION_EXECUTOR_PASS":timelining?"REAL_SQL_PRODUCTION_TIMELINE_EXECUTOR_PASS":"REAL_SQL_PRODUCTION_COMPARISON_EXECUTOR_PASS",
    documents:deepening?60:contradicting||obligating?50:9,criteria:deepening?13:contradicting||obligating?11:3,steps,cells_events_or_consulted_receipts:deepening?780:contradicting||obligating?550:27,
    independently_concurrent_start_connections:2,starts_saved:1,generation_calls:generations,last_finding_position:findingPosition,exact_original_hash: finding.evidence[0].original_content_hash,
    first_document_chunks:400,first_step_paired_or_cited_sources:deepBoundary?1:deepening?12:contradicting||obligating?2:8,first_step_lexical_rows_read:lexicalReads[0].rows,
    ...(deepBoundary?{max_context_boundary:true,unique_prior_originals:144,final_original_contexts:156}:{}),
    ...((deepening||contradicting||obligating)?{original_null_zero_positive_page_receipts:true}:{}),
    quota_provider_peers:"CONTROLLED_NOT_LIVE_QUALITY_OR_SQL_BUDGET_PROOF",provider_processing:false,hosted_acceptance:false}));
  if(obligating) {
    const reviewer="33333333-3333-4333-8333-333333333333";
    sql("insert into public.workspace_members(workspace_id,user_id,role) values(:'ws',:'reviewer','editor') on conflict(workspace_id,user_id) do update set role='editor';",{ws,reviewer});
    const operateFinding=async(who,operation,body,method="POST")=>{
      const suffix=operation?`/${operation}`:"";
      const response=await handleWorkbench({request:new Request(`https://gateway.invalid/api/v2/findings/${finding.id}${suffix}`,{method,body:JSON.stringify(body)}),
        env,user:{id:who},workspace:ws,member:{role:"editor"},serviceRequest:db,json:(_request,_env,value,status=200)=>new Response(JSON.stringify(value),{status})});
      assert.equal(response.status,200);return response.json();
    };
    await operateFinding(actor,"share",{user_id:reviewer,permission:"contribute"});
    let reviewed=await operateFinding(reviewer,"review",{decision:"changes_requested",comment:"Check the exact exception and definition wording.",revision:1});
    assert.equal(reviewed.reviews.length,1);assert.equal(reviewed.reviews[0].reviewer_id,reviewer);
    const revised=await operateFinding(actor,"",{title:"Reviewed synthetic obligation candidates",authored_markdown:"Exceptions and applicability still require qualified review.",revision:1},"PATCH");
    assert.equal(revised.revision,2);assert.equal(revised.reviews.length,0);assert.equal(revised.generated_markdown,finding.generated_markdown);
    assert.deepEqual(revised.research_origin.obligations,finding.research_origin.obligations);
    reviewed=await operateFinding(reviewer,"review",{decision:"approved",comment:"Inspected the synthetic original clauses and retained the limitations.",revision:2});
    assert.equal(reviewed.reviews[0].revision,2);assert.equal(reviewed.reviews[0].reviewer_id,reviewer);
    assert.ok(reviewed.research_origin.obligations.candidates.every(candidate=>candidate.applicability_state==="NOT_DETERMINED"&&candidate.control_state==="PROPOSED_NOT_IMPLEMENTED"));
    const runCommand=async(operation,id=null,key=null)=>{
      const reading=operation==="read",suffix=id?`/${id}${["cancel","resume"].includes(operation)?`/${operation}`:""}`:"";
      const response=await handleResearchRuns({request:new Request(`https://gateway.invalid/api/v2/research/plans/${plan.id}/runs${suffix}`,{
        method:reading?"GET":"POST",headers:key?{"Idempotency-Key":key}:undefined,body:reading?undefined:JSON.stringify({execution_mode:"OBLIGATION_ANALYSIS",non_sensitive_attested:true})}),
        env,user:{id:actor},workspace:ws,member:{role:"editor"},serviceRequest:db,json:(_request,_env,value,status=200)=>new Response(JSON.stringify(value),{status})});
      assert.equal(response.status,operation==="create"?201:200);return response.json();
    };
    const messageFor=value=>({kind:"research",workspace_id:ws,run_id:value.id,generation:value.generation,position:value.position});
    let lifecycle=await runCommand("create",null,"obligation-lifecycle");
    assert.equal((await runCommand("create",null,"obligation-lifecycle")).id,lifecycle.id);
    lifecycle=await processResearchMessage(env,messageFor(lifecycle),db);assert.equal(lifecycle.position,1);
    const firstSaved=structuredClone(lifecycle.results[0]);
    lifecycle=await runCommand("cancel",lifecycle.id);assert.equal(lifecycle.state,"cancelled");assert.equal(lifecycle.position,1);
    lifecycle=await runCommand("resume",lifecycle.id);assert.equal(lifecycle.generation,2);assert.equal(lifecycle.position,1);
    const beforeFailureSends=sent.length;
    nextGenerationFailure="unavailable";await processResearchMessage(env,messageFor(lifecycle),db);
    lifecycle=await runCommand("read",lifecycle.id);assert.equal(lifecycle.state,"interrupted");assert.equal(lifecycle.error_code,"PROVIDER_UNAVAILABLE");
    assert.equal(lifecycle.position,1);assert.equal(sent.length,beforeFailureSends);assert.deepEqual(lifecycle.results[0],firstSaved);
    lifecycle=await runCommand("resume",lifecycle.id);assert.equal(lifecycle.generation,3);
    lifecycle=await processResearchMessage(env,messageFor(lifecycle),db);assert.equal(lifecycle.position,2);
    nextGenerationFailure="incomplete";await processResearchMessage(env,messageFor(lifecycle),db);
    lifecycle=await runCommand("read",lifecycle.id);assert.equal(lifecycle.state,"interrupted");assert.equal(lifecycle.position,2);
    assert.equal(lifecycle.results.length,2);assert.match(lifecycle.error_code,/PROVIDER_.*INCOMPLETE|PROVIDER_INVALID_RESPONSE/);
    lifecycle=await runCommand("resume",lifecycle.id);assert.equal(lifecycle.generation,4);
    sql("update public.research_runs set deadline=clock_timestamp()-interval '1 second' where id=:'id';",{id:lifecycle.id});
    const beforeExpiry=generations;await processResearchMessage(env,messageFor(lifecycle),db);
    lifecycle=await runCommand("read",lifecycle.id);assert.equal(lifecycle.error_code,"RUN_DEADLINE");assert.equal(generations,beforeExpiry);
    lifecycle=await runCommand("resume",lifecycle.id);assert.equal(lifecycle.generation,5);
    const remaining=sql("select extract(epoch from deadline-clock_timestamp()) from public.research_runs where id=:'id';",{id:lifecycle.id});
    assert.ok(remaining>415&&remaining<=420,`Unexpected resumed mode deadline ${remaining}`);
    while(lifecycle.state==="queued")lifecycle=await processResearchMessage(env,messageFor(lifecycle),db);
    assert.equal(lifecycle.state,"completed");assert.equal(lifecycle.results.length,11);assert.deepEqual(lifecycle.results[0],firstSaved);

    let uncertain=await runCommand("create",null,"obligation-post-commit-response-loss"),lost=false;
    const originalMessage=messageFor(uncertain);
    const interruptedTransport=async(_env,path,init={})=>{
      const result=await db(_env,path,init);
      if(path==="rpc/nexus_research_step"&&JSON.parse(init.body).p_operation==="commit"&&!lost){lost=true;throw Error("Synthetic response lost after durable commit");}
      return result;
    };
    assert.equal(await processResearchMessage(env,originalMessage,interruptedTransport),null);
    uncertain=await runCommand("read",uncertain.id);assert.equal(uncertain.position,1);assert.equal(uncertain.results.length,1);
    const afterLostCommit=generations;await processResearchMessage(env,originalMessage,db);assert.equal(generations,afterLostCommit);
    uncertain=await runCommand("resume",uncertain.id);assert.equal(uncertain.generation,1);
    nextEmptyObligations=true;uncertain=await processResearchMessage(env,messageFor(uncertain),db);
    assert.equal(uncertain.position,2);assert.equal(uncertain.results[1].abstained,true);assert.equal(uncertain.results[1].claim_state,"UNSUPPORTED");
    assert.equal(uncertain.results[1].sources.length,0);assert.equal(uncertain.results[1].obligations.documents.length,50);
    assert.ok(uncertain.results[1].answer.includes("does not establish"));
    assert.equal(sql("select free_chat_queries from public.nexus_account_usage where user_id=:'actor';",{actor}),3);
    console.log(JSON.stringify({marker:"REAL_SQL_OBLIGATION_ORDINARY_RECOVERY_REVIEW_PASS",completed_results:11,cancel_resume_same_run:true,
      provider503_and_incomplete_preserve_progress:true,expiry_resets_mode420seconds:true,post_commit_response_loss_readback_and_no_duplicate_provider_call:true,
      empty_candidates_abstain_without_false_compliance:true,independent_review_revision:2,reviewer_is_original_author:false,
      proposal_and_applicability_states_preserved:true,account_admissions:3,hosted_acceptance:false,provider_processing:false}));
    capacityScenario=obligationCapacity();
    for(const [index,original] of capacityScenario.originals.entries()) {
      sql(`insert into public.documents(id,workspace_id,uploaded_by,filename,original_filename,status) values(:'doc',:'ws',:'actor',:'name',:'name','ready');
        insert into public.document_versions(id,workspace_id,document_id,original_bucket,original_key,original_hash,original_bytes,original_verified_at,parser_version,chunker_version,lifecycle_epoch,
          publication_state,index_generation,data_classification,classification_declared_by,classification_declared_at)
          values(:'version',:'ws',:'doc','documents',:'doc',:'hash',32768,now(),'synthetic','synthetic',1,'ready','synthetic-capacity','non_sensitive',:'actor',now());
        update public.documents set active_version_id=:'version' where id=:'doc';
        insert into public.document_chunks(id,workspace_id,document_id,version_id,chunk_index,content,original_text,original_content_hash,page_number,location,embedding_space_id)
          values(:'chunk',:'ws',:'doc',:'version',0,:'text',:'text',:'hash',nullif(:'page','')::integer,:'location'::jsonb,'synthetic-space');`,
        {doc:original.document_id,ws,actor,name:capacityScenario.documents[index].filename,version:original.version_id,hash:original.original_content_hash,
          chunk:original.id,text:original.original_text,page:original.page_number??"",location:original.location});
    }
    const capacityContext=sql(`select jsonb_build_object('workspace_id',w.id,'user_id',:'actor','membership_revision',w.capability_revision,'policy_id',s.active_policy_id,
      'policy_version',s.policy_version,'deadline',clock_timestamp()+interval '15 minutes') from public.workspaces w join public.workspace_settings s on s.workspace_id=w.id where w.id=:'ws';`,{actor,ws});
    const capacityPlan=sql("select public.nexus_research_plan(:'ctx'::jsonb,'create',p_plan=>:'plan'::jsonb,p_key=>:'key');",
      {ctx:capacityContext,key:"obligation-capacity-plan",plan:{...plan.plan,plan_id:"obligation-capacity-plan",question:capacityScenario.run.questions[0],subquestions:capacityScenario.run.questions.slice(1),
        private_source_ids:capacityScenario.documents.map(document=>document.id)}});
    let capacityRun=sql(start,{ctx:capacityContext,plan:capacityPlan.id,key:"obligation-capacity-start"});const generationStart=generations;
    for(let index=0;index<11;index++) {
      const before=outbound;capacityRun=await processResearchMessage(env,messageFor(capacityRun),db);
      assert.ok(capacityRun,`Actual maximum-field obligation executor interrupted at ${index}; controlled peer ${peerFailure||"none"}`);
      assert.equal(capacityRun.position,index+1);assert.ok(outbound-before<50);
      const result=capacityRun.results[index];assert.equal(result.obligations.candidates.length,12);assert.equal(result.sources.length,50);
      assert.equal(result.query_retrieval.completed_queries,8);assert.equal(result.obligations.documents.length,50);
      assert.ok(result.obligations.candidates.every(candidate=>candidate.definitions.length===4&&candidate.exceptions.length===4&&candidate.amendments.length===4&&candidate.supersedes.length===4));
      assert.ok(result.answer.length>16000);assert.ok(Array.from(result.answer).length<=16000);
    }
    assert.equal(capacityRun.state,"completed");assert.equal(generations-generationStart,11);
    const capacityRead=sql("select public.nexus_research_run(:'ctx'::jsonb,'read',:'plan'::uuid,:'id'::uuid);",{ctx:capacityContext,plan:capacityPlan.id,id:capacityRun.id});
    assert.deepEqual(capacityRead.results,capacityRun.results);
    const capacityRequest=()=>new Request("https://gateway.invalid/api/v2/findings",{
      method:"POST",headers:{"content-type":"application/json","idempotency-key":"obligation-capacity-finding"},
      body:JSON.stringify({title:"Maximum-field synthetic obligation Finding",research_run_id:capacityRun.id,result_index:10})});
    const createCapacityFinding=()=>handleWorkbench({request:capacityRequest(),env,user:{id:actor},workspace:ws,member:{role:"editor"},serviceRequest:db,
      json:(_request,_env,value,status=200)=>new Response(JSON.stringify(value),{status})});
    const capacityResponse=await createCapacityFinding();
    assert.equal(capacityResponse.status,201);const capacityFinding=await capacityResponse.json();
    assert.deepEqual(capacityFinding.research_origin.obligations,capacityRead.results[10].obligations);assert.equal(capacityFinding.evidence.length,50);
    const countCreationEvents=()=>sql("select count(*) from public.audit_events where workspace_id=:'ws' and user_id=:'actor' and action='finding.create' and resource_id=:'id';",{ws,actor,id:capacityFinding.id});
    assert.equal(countCreationEvents(),1);
    const replayFinding=await createCapacityFinding();assert.equal(replayFinding.status,201);assert.equal((await replayFinding.json()).id,capacityFinding.id);
    assert.equal(countCreationEvents(),1,"Retry must retain one truthful Finding creation audit event");
    const sizes=sql("select jsonb_build_object('jsonb_result_bytes',octet_length((results->0)::text),'jsonb_run_bytes',octet_length(results::text)) from public.research_runs where id=:'id';",{id:capacityRun.id});
    console.log(JSON.stringify({marker:"REAL_SQL_OBLIGATION_COMBINED_CAPACITY_PASS",documents:50,original_bytes_each:32768,questions:11,candidates_each:12,
      quote_codepoints:300,control_codepoints:240,limitations_each:4,qualifying_anchors_each:25,query_variants_each:8,
      result_answer_code_units:capacityRead.results[0].answer.length,result_answer_codepoints:Array.from(capacityRead.results[0].answer).length,
      ...sizes,reread_exact:true,finding_position:10,finding_sources:50,replayed_finding_single_creation_audit:true,postgres_stdin_transport:true,
      hosted_cpu_memory_or_budget_acceptance:false,provider_processing:false}));
  }
} finally {globalThis.fetch=ordinaryFetch;}
