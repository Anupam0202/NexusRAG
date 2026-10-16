import test from "node:test";
import assert from "node:assert/strict";
import { processResearchMessage, sweepResearchRuns } from "../../apps/gateway/src/research-executor.js";
import { sha256 } from "../../apps/gateway/src/worker-pipeline.js";
const ws="11111111-1111-4111-8111-111111111111",user="22222222-2222-4222-8222-222222222222",id="33333333-3333-4333-8333-333333333333";
const doc="44444444-4444-4444-8444-444444444444",version="55555555-5555-4555-8555-555555555555",chunk="66666666-6666-4666-8666-666666666666";
const token="77777777-7777-4777-8777-777777777777",message={kind:"research",workspace_id:ws,run_id:id,generation:1,position:0};
async function fixture(t,options={}) {
  const text=options.timeline?"The synthetic policy took effect on 2024-02-29. It was published in 2024-02.":"The synthetic retention period is 30 days.",hash=await sha256(text),calls=[],sent=[],provider=[],reservations=[],reads=[];
  const run={id,workspace_id:ws,owner_id:user,generation:1,position:0,state:"running",source_state:"CURRENT",questions:["What is the synthetic retention period?"],
    source_snapshot:[{document_id:doc,version_id:version,index_generation:"generation-one",lifecycle_epoch:1}],deadline:new Date(Date.now()+30000).toISOString(),
    admission:{credential_mode:"platform_trial"}};
  const rows=[{id:chunk,workspace_id:ws,document_id:doc,version_id:version,chunk_index:0,page_number:2,content:text,original_text:text,original_content_hash:hash,location:{page:2}}];
  if(options.compare) {
    run.mode="COMPARE";run.source_snapshot.push({document_id:token,version_id:id,index_generation:"generation-two",lifecycle_epoch:1});
    rows.push({...rows[0],id:token,document_id:token,version_id:id});
  }
  if(options.timeline){run.mode="TIMELINE";run.questions=["Build a chronology."];}
  if(options.chunkCount>1) {
    const filler="Unrelated appendix material.",fillerHash=await sha256(filler);
    for(let i=1;i<options.chunkCount;i++)rows.push({...rows[0],id:`00000000-0000-4000-8000-${String(i).padStart(12,"0")}`,
      chunk_index:i,content:filler,original_text:filler,original_content_hash:fillerHash});
    rows.sort((a,b)=>a.id.localeCompare(b.id));
  }
  const db=async(_env,path,init={})=>{
    reads.push(path);
    if(path.startsWith("research_runs?"))return [run];
    if(path.startsWith("workspaces?"))return [{capability_revision:1,lifecycle_state:"active"}];
    if(path.startsWith("workspace_settings?"))return [{active_policy_id:token,policy_version:1,...options.settings}];
    if(path==="rpc/nexus_research_step") {
      const data=JSON.parse(init.body);calls.push(data);
      if(data.p_operation==="claim")return options.noClaim?{claimed:false}:{claimed:true,token,run:{...run,deadline:options.expired?new Date(0).toISOString():run.deadline}};
      if(data.p_operation==="commit") {
        if(options.commitAmbiguous)throw Error("synthetic interrupted storage response");
        return {claimed:false,run:{...run,state:options.more?"queued":"completed",position:1,results:[data.p_result]}};
      }
      return {claimed:false,run:{...run,state:"interrupted"}};
    }
    if(path.startsWith("documents?"))return run.source_snapshot.map((s,i)=>({id:s.document_id,workspace_id:ws,active_version_id:s.version_id,lifecycle_state:"active",filename:`Synthetic policy${i||""}.txt`,content_type:"text/plain"}));
    if(path.startsWith("document_versions?"))return run.source_snapshot.map(s=>({id:s.version_id,workspace_id:ws,document_id:s.document_id,publication_state:"ready",data_classification:"non_sensitive",index_generation:options.changed?"new-generation":s.index_generation,lifecycle_epoch:1}));
    if(path.startsWith("document_chunks?")) {
      const query=new URL(`https://fixture.invalid/${path}`).searchParams,ids=query.get("id")?.slice(4,-1).split(",");
      return options.empty?[]:rows.filter(row=>!ids||ids.includes(row.id)).slice(0,Number(query.get("limit")||rows.length));
    }
    throw Error(`Unexpected fixture DB path ${path}`);
  };
  t.mock.method(globalThis,"fetch",async(input,init={})=>{
    const url=new URL(input),json=value=>new Response(JSON.stringify(value));
    if(url.hostname==="supabase.invalid") {
      const data=JSON.parse(init.body);
      if(url.pathname.endsWith("/v6_reserve_many")){reservations.push(data.p_dimensions);return json({state:"READY",reservations:Object.entries(data.p_dimensions).map(([,amount])=>({id:token,amount,replayed:false}))});}
      if(url.pathname.endsWith("/v6_settle_many"))return json({state:"SETTLED"});
      throw Error(`Unexpected fixture RPC ${url.pathname}`);
    }
    provider.push({url:url.pathname,signal:init.signal,body:init.body});
    if(url.hostname==="generativelanguage.googleapis.com") {
      if(url.pathname.endsWith(":embedContent"))return json({embedding:{values:Array(8).fill(0.1)}});
      if(options.providerError)return new Response("synthetic provider interruption",{status:503});
      const answer=options.timeline?JSON.stringify({documents:[{document_id:doc,events:[
        {citation_id:"S1",quote:"The synthetic policy took effect on 2024-02-29.",date_text:"2024-02-29",date_role:"EFFECTIVE"},
        {citation_id:"S1",quote:"It was published in 2024-02.",date_text:"2024-02",date_role:"PUBLISHED"}]}]}):options.compare?JSON.stringify({cells:[{document_id:doc,answer:"30 days [S1]."},{document_id:token,answer:"30 days [S2]."}]}):"The retention period is 30 days [S1].";
      return json({candidates:[{finishReason:options.incomplete?"MAX_TOKENS":"STOP",content:{parts:[{text:answer}]}}],usageMetadata:{promptTokenCount:20,candidatesTokenCount:12}});
    }
    if(url.hostname==="qdrant.invalid")return json(url.pathname.endsWith("/points/query")?{result:{points:options.noDense?[]:[{id:chunk,score:0.9,payload:{workspace_id:ws,document_id:doc,version_id:version,index_generation:"generation-one",chunk_id:chunk}}]}}:{});
    throw Error(`Unapproved fixture egress ${url.hostname}`);
  });
  const env={SUPABASE_URL:"https://supabase.invalid",SUPABASE_SERVICE_ROLE_KEY:"synthetic",GOOGLE_API_KEY:"synthetic-not-a-key",QDRANT_URL:"https://qdrant.invalid",QDRANT_API_KEY:"synthetic",
    INGESTION_QUEUE:{send:async value=>sent.push(value)}};
  return {env,db,run,calls,sent,provider,hash,reservations,reads};
}

for(const chunkCount of [200,201,400])test(`research retrieves a current indexed answer beyond the lexical window in ${chunkCount} chunks`,async t=>{
  const {env,db,calls,reads,hash}=await fixture(t,{chunkCount});
  const result=await processResearchMessage(env,message,db);
  assert.equal(result?.state,"completed");
  const saved=calls.find(call=>call.p_operation==="commit").p_result;
  assert.equal(saved.sources[0].chunk_id,chunk);assert.equal(saved.sources[0].original_content_hash,hash);
  assert.equal(saved.coverage.chunks_considered,200);
  assert.equal(saved.coverage.lexical_limit_reached,chunkCount>200);
  assert.equal(saved.coverage.completeness,"NOT_EXHAUSTIVE");
  assert.ok(reads.filter(path=>path.startsWith("document_chunks?")).every(path=>Number(new URL(`https://fixture.invalid/${path}`).searchParams.get("limit"))<=201));
});

test("a large document with no ranked evidence abstains instead of failing on its total chunk count",async t=>{
  const {env,db,calls,provider}=await fixture(t,{chunkCount:400,noDense:true});
  const result=await processResearchMessage(env,message,db);
  assert.equal(result?.state,"completed");
  const saved=calls.find(call=>call.p_operation==="commit").p_result;
  assert.equal(saved.abstained,true);assert.deepEqual(saved.sources,[]);
  assert.equal(saved.coverage.lexical_limit_reached,true);
  assert.equal(provider.filter(call=>call.url.endsWith(":generateContent")).length,0);
});
test("actual research executor retrieves, rehydrates, generates and commits one grounded question",async t=>{
  const {env,db,calls,provider,hash}=await fixture(t);
  const result=await processResearchMessage(env,message,db);
  assert.equal(result.state,"completed");
  const saved=calls.find(c=>c.p_operation==="commit").p_result;
  assert.equal(saved.sources[0].original_content_hash,hash);assert.equal(saved.sources[0].chunk_id,chunk);
  assert.equal(saved.sources[0].page_number,2);assert.equal(saved.claim_state,"REVIEW_REQUIRED");
  assert.deepEqual(saved.validated_citation_ids,["S1"]);
  assert.equal(saved.review_state,"COMPLETION_CRITERIA_NOT_AUTOMATICALLY_VERIFIED");
  assert.equal(provider.filter(p=>p.url.endsWith(":generateContent")).length,1);
  assert.ok(provider.every(p=>p.signal instanceof AbortSignal));
});

test("comparison execution persists one separately cited cell for every selected document",async t=>{
  const {env,db,calls,provider,reservations}=await fixture(t,{compare:true});
  await processResearchMessage(env,message,db);
  const saved=calls.find(c=>c.p_operation==="commit").p_result;
  assert.equal(saved.comparison?.schema_version,"research-comparison/1");
  assert.deepEqual(saved.comparison.cells.map(cell=>[cell.document_id,cell.validated_citation_ids]),[[doc,["S1"]],[token,["S2"]]]);
  assert.equal(saved.comparison.criterion_index,0);assert.equal(saved.comparison.batch_index,0);
  assert.equal(provider.filter(p=>p.url.endsWith(":generateContent")).length,1);
  assert.equal(JSON.parse(provider.find(p=>p.url.endsWith(":generateContent")).body).generationConfig.maxOutputTokens,4096);
  assert.equal(reservations.find(value=>value.output_tokens).output_tokens,4096);
});

test("timeline execution persists source-anchored dates instead of an ordinary answer",async t=>{
  const {env,db,calls,hash,reservations}=await fixture(t,{timeline:true,noDense:true});
  await processResearchMessage(env,message,db);
  const saved=calls.find(c=>c.p_operation==="commit").p_result;
  assert.equal(saved.timeline?.schema_version,"research-timeline/1");
  assert.equal(saved.timeline.events.length,2);
  assert.deepEqual(saved.timeline.events.map(event=>[event.date_text,event.date_role,event.date.precision]),
    [["2024-02","PUBLISHED","MONTH"],["2024-02-29","EFFECTIVE","DAY"]]);
  assert.equal(saved.sources[0].original_content_hash,hash);
  assert.deepEqual(saved.validated_citation_ids,["S1"]);
  assert.equal(saved.timeline.events[1].quote_start,0);
  assert.equal(reservations.find(value=>value.output_tokens).output_tokens,4096);
});
test("a durable next-question cursor is sent only after its result commits",async t=>{
  const {env,db,sent}=await fixture(t,{more:true});
  await processResearchMessage(env,message,db);
  assert.deepEqual(sent,[{...message,position:1}]);
});
for(const [name,options,code] of [["expired deadline",{expired:true},"RUN_DEADLINE"],["source changed",{changed:true},"SOURCE_UNAVAILABLE"],
  ["provider interruption",{providerError:true},"PROVIDER_UNAVAILABLE"],["truncated provider output",{incomplete:true},"PROVIDER_INCOMPLETE"],
  ["ambiguous result persistence",{commitAmbiguous:true},"EXECUTION_UNCONFIRMED"]])
test(`${name} is durably interrupted without automatic provider replay`,async t=>{
  const {env,db,calls,sent,provider}=await fixture(t,options);
  assert.equal(await processResearchMessage(env,message,db),null);
  assert.equal(calls.at(-1).p_operation,"interrupt");assert.equal(calls.at(-1).p_error,code);assert.equal(sent.length,0);
  if(options.expired||options.changed)assert.equal(provider.length,0);
});
test("duplicate delivery with no claim performs no retrieval or generation",async t=>{
  const {env,db,calls,provider}=await fixture(t,{noClaim:true});
  await processResearchMessage(env,message,db);assert.equal(calls.length,1);assert.equal(provider.length,0);
});
test("empty stored scope abstains without any provider call",async t=>{
  const {env,db,provider,calls}=await fixture(t,{empty:true});
  await processResearchMessage(env,message,db);
  assert.equal(provider.length,0);assert.equal(calls.at(-1).p_result.abstained,true);assert.equal(calls.at(-1).p_result.claim_state,"UNSUPPORTED");
});
test("ordinary scheduled dispatch recovers queued saved cursors",async t=>{
  const {env,db,sent}=await fixture(t);
  assert.equal(await sweepResearchRuns(env,db),1);assert.deepEqual(sent,[message]);
});
test("research applies and records current supported workspace runtime settings",async t=>{
  const settings={retrieval_top_k:3,hybrid_search_alpha:0.2,llm_temperature:0.7};
  const {env,db,calls,provider}=await fixture(t,{settings});
  await processResearchMessage(env,message,db);
  assert.deepEqual(calls.find(c=>c.p_operation==="commit").p_result.runtime_options,settings);
  assert.equal(JSON.parse(provider.find(p=>p.url.endsWith("/points/query")).body).limit,3);
  assert.equal(JSON.parse(provider.find(p=>p.url.endsWith(":generateContent")).body).generationConfig.temperature,0.7);
});
