import test from "node:test";
import assert from "node:assert/strict";
import { processResearchMessage, sweepResearchRuns } from "../../apps/gateway/src/research-executor.js";
import { sha256 } from "../../apps/gateway/src/worker-pipeline.js";
const ws="11111111-1111-4111-8111-111111111111",user="22222222-2222-4222-8222-222222222222",id="33333333-3333-4333-8333-333333333333";
const doc="44444444-4444-4444-8444-444444444444",version="55555555-5555-4555-8555-555555555555",chunk="66666666-6666-4666-8666-666666666666";
const token="77777777-7777-4777-8777-777777777777",message={kind:"research",workspace_id:ws,run_id:id,generation:1,position:0};
async function fixture(t,options={}) {
  const text="The synthetic retention period is 30 days.",hash=await sha256(text),calls=[],sent=[],provider=[];
  const run={id,workspace_id:ws,owner_id:user,generation:1,position:0,state:"running",source_state:"CURRENT",questions:["What is the synthetic retention period?"],
    source_snapshot:[{document_id:doc,version_id:version,index_generation:"generation-one",lifecycle_epoch:1}],deadline:new Date(Date.now()+30000).toISOString(),
    admission:{credential_mode:"platform_trial"}};
  const rows=[{id:chunk,workspace_id:ws,document_id:doc,version_id:version,chunk_index:0,page_number:2,content:text,original_text:text,original_content_hash:hash,location:{page:2}}];
  const db=async(_env,path,init={})=>{
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
    if(path.startsWith("documents?"))return [{id:doc,workspace_id:ws,active_version_id:version,lifecycle_state:"active",filename:"Synthetic policy.txt",content_type:"text/plain"}];
    if(path.startsWith("document_versions?"))return [{id:version,workspace_id:ws,document_id:doc,publication_state:"ready",data_classification:"non_sensitive",index_generation:options.changed?"new-generation":"generation-one",lifecycle_epoch:1}];
    if(path.startsWith("document_chunks?"))return options.empty?[]:rows;
    throw Error(`Unexpected fixture DB path ${path}`);
  };
  t.mock.method(globalThis,"fetch",async(input,init={})=>{
    const url=new URL(input),json=value=>new Response(JSON.stringify(value));
    if(url.hostname==="supabase.invalid") {
      const data=JSON.parse(init.body);
      if(url.pathname.endsWith("/v6_reserve_many"))return json({state:"READY",reservations:Object.entries(data.p_dimensions).map(([,amount])=>({id:token,amount,replayed:false}))});
      if(url.pathname.endsWith("/v6_settle_many"))return json({state:"SETTLED"});
      throw Error(`Unexpected fixture RPC ${url.pathname}`);
    }
    provider.push({url:url.pathname,signal:init.signal,body:init.body});
    if(url.hostname==="generativelanguage.googleapis.com") {
      if(url.pathname.endsWith(":embedContent"))return json({embedding:{values:Array(8).fill(0.1)}});
      if(options.providerError)return new Response("synthetic provider interruption",{status:503});
      return json({candidates:[{finishReason:options.incomplete?"MAX_TOKENS":"STOP",content:{parts:[{text:"The retention period is 30 days [S1]."}]}}],usageMetadata:{promptTokenCount:20,candidatesTokenCount:12}});
    }
    if(url.hostname==="qdrant.invalid")return json(url.pathname.endsWith("/points/query")?{result:{points:[{id:chunk,score:0.9,payload:{workspace_id:ws,document_id:doc,version_id:version,index_generation:"generation-one",chunk_id:chunk}}]}}:{});
    throw Error(`Unapproved fixture egress ${url.hostname}`);
  });
  const env={SUPABASE_URL:"https://supabase.invalid",SUPABASE_SERVICE_ROLE_KEY:"synthetic",GOOGLE_API_KEY:"synthetic-not-a-key",QDRANT_URL:"https://qdrant.invalid",QDRANT_API_KEY:"synthetic",
    INGESTION_QUEUE:{send:async value=>sent.push(value)}};
  return {env,db,run,calls,sent,provider,hash};
}
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
