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
  if(options.compare||options.contradiction) {
    run.mode=options.contradiction?"CONTRADICTION_ANALYSIS":"COMPARE";run.source_snapshot.push({document_id:token,version_id:id,index_generation:"generation-two",lifecycle_epoch:1});
    rows.push({...rows[0],id:token,document_id:token,version_id:id});
  }
  if(options.timeline){run.mode="TIMELINE";run.questions=["Build a chronology."];}
  if(options.deep) {
    run.mode="DEEP_RESEARCH";
    run.questions=[...Array.from({length:12},(_,i)=>`Synthetic retention criterion ${i+1}?`),"Synthesize the synthetic retention evidence."];
    run.results=[];
    run.deadline=new Date(Date.now()+600000).toISOString();
  }
  if(options.documentCount) {
    while(run.source_snapshot.length<options.documentCount) {
      const n=run.source_snapshot.length+1,document_id=`10000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
      const version_id=`20000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
      run.source_snapshot.push({document_id,version_id,index_generation:`generation-${n}`,lifecycle_epoch:1});
      const content=options.timeline?`Policy ${n} took effect on 2024-02-${String(n).padStart(2,"0")}.`:`Policy ${n} retention period is 30 days.`;
      rows.push({...rows[0],id:`30000000-0000-4000-8000-${String(n).padStart(12,"0")}`,document_id,version_id,content,original_text:content,original_content_hash:await sha256(content)});
    }
    rows[0].id="00000000-0000-4000-8000-000000000000";
  }
  if(options.chunkCount>1) {
    const filler="Unrelated appendix material.",fillerHash=await sha256(filler);
    for(let i=1;i<options.chunkCount;i++)rows.push({...rows[0],id:`00000000-0000-4000-8000-${String(i).padStart(12,"0")}`,
      chunk_index:i,content:filler,original_text:filler,original_content_hash:fillerHash});
    rows.sort((a,b)=>a.id.localeCompare(b.id));
  }
  if(Object.hasOwn(options,"pageNumber"))for(const row of rows)row.page_number=options.pageNumber;
  if(options.deepSynthesis) {
    run.position=12;
    run.results=Array.from({length:12},(_,index)=>({question:run.questions[index],answer:`Earlier derived analysis ${index} [S1].`,
      claim_state:"REVIEW_REQUIRED",abstained:false,sources:Array.from({length:12},(_,offset)=>{
        const row=rows[(index*12+offset)%rows.length];
        return {citation_id:`S${offset+1}`,document_id:row.document_id,version_id:row.version_id,chunk_id:row.id,
          content:row.original_text,original_content_hash:row.original_content_hash,chunk_index:row.chunk_index,page_number:row.page_number};
      }),deep:{limitations:["Earlier analysis is not evidence."],gaps:[]}}));
  }
  const db=async(_env,path,init={})=>{
    reads.push(path);
    if(path.startsWith("research_runs?"))return [run];
    if(path.startsWith("workspaces?"))return [{capability_revision:1,lifecycle_state:"active"}];
    if(path.startsWith("workspace_settings?"))return [{active_policy_id:token,policy_version:1,...options.settings}];
    if(path==="rpc/nexus_research_candidates") {
      const data=JSON.parse(init.body),selected=run.source_snapshot.filter(s=>data.p_document_ids.includes(s.document_id)),items=[];
      let read=0,limited=false;
      for(const [index,s] of selected.entries()) {
        const allowance=Math.floor(201/selected.length)+(index<201%selected.length?1:0);
        const batch=options.empty?[]:rows.filter(row=>row.version_id===s.version_id).slice(0,allowance);
        read+=batch.length;limited||=batch.length===allowance;items.push(...(batch.length===allowance?batch.slice(0,-1):batch));
      }
      return {schema_version:"research-candidates/1",run_id:run.id,generation:run.generation,position:run.position,items,lexical_rows_read:read,lexical_limit_reached:limited};
    }
    if(path==="rpc/nexus_research_deep_context") {
      const ids=new Set(run.results.flatMap(result=>result.sources.map(source=>source.chunk_id)));
      const items=rows.filter(row=>ids.has(row.id));
      return {schema_version:"research-deep-context/1",run_id:run.id,generation:run.generation,position:run.position,
        items:options.priorContextMissing?items.slice(1):items};
    }
    if(path==="rpc/nexus_research_step") {
      const data=JSON.parse(init.body);calls.push(data);
      if(data.p_operation==="claim")return options.noClaim?{claimed:false}:{claimed:true,token,run:{...run,deadline:options.expired?new Date(0).toISOString():run.deadline}};
      if(data.p_operation==="commit") {
        if(options.commitAmbiguous)throw Error("synthetic interrupted storage response");
        return {claimed:false,run:{...run,state:options.more?"queued":"completed",position:run.position+1,results:[...(run.results||[]),data.p_result]}};
      }
      return {claimed:false,run:{...run,state:"interrupted"}};
    }
    if(path.startsWith("documents?"))return run.source_snapshot.map((s,i)=>({id:s.document_id,workspace_id:ws,active_version_id:s.version_id,lifecycle_state:"active",filename:`Synthetic policy${i||""}.txt`,content_type:"text/plain"}))
      .slice(0,Number(new URL(`https://fixture.invalid/${path}`).searchParams.get("limit")));
    if(path.startsWith("document_versions?"))return run.source_snapshot.map(s=>({id:s.version_id,workspace_id:ws,document_id:s.document_id,publication_state:"ready",data_classification:"non_sensitive",index_generation:options.changed?"new-generation":s.index_generation,lifecycle_epoch:1}))
      .slice(0,Number(new URL(`https://fixture.invalid/${path}`).searchParams.get("limit")));
    if(path.startsWith("document_chunks?")) {
      const query=new URL(`https://fixture.invalid/${path}`).searchParams,ids=query.get("id")?.slice(4,-1).split(",");
      const versions=query.get("version_id")?.slice(4,-1).split(",");
      return options.empty?[]:rows.filter(row=>(!ids||ids.includes(row.id))&&(!versions||versions.includes(row.version_id))).slice(0,Number(query.get("limit")||rows.length));
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
      if(url.pathname.endsWith(":batchEmbedContents"))return json({embeddings:JSON.parse(init.body).requests.map(()=>({values:Array(8).fill(0.1)}))});
      if(options.providerError)return new Response("synthetic provider interruption",{status:503});
      const prompt=JSON.parse(init.body).contents[0].parts[0].text;
      if(prompt.startsWith("RESEARCH_QUERY_VARIANTS"))return json({candidates:[{finishReason:"STOP",content:{parts:[{text:JSON.stringify({queries:options.variantQueries||[]})}]}}]});
      const sources=options.documentCount||options.contradiction?JSON.parse(prompt.split("\nEVIDENCE:\n")[1]):null;
      const answer=options.deep?JSON.stringify({answer:"The synthetic retention period is30days [S1].",limitations:["Independent review is required."],gaps:[]}):options.contradiction?JSON.stringify({pairs:[{left:{citation_id:sources[0].citation_id,quote:sources[0].content},right:{citation_id:sources.at(-1).citation_id,quote:sources.at(-1).content},
        relationship:"INSUFFICIENT_CONTEXT",explanation:"Matching words alone do not establish shared context or a contradiction."}]}):options.documentCount?JSON.stringify(options.timeline?{documents:run.source_snapshot.map(s=>{
        const source=sources.find(item=>item.document_id===s.document_id),quote=source?.content.match(/[^.]*2024-02-\d{2}\./)?.[0]?.trim();
        return {document_id:s.document_id,events:quote?[{citation_id:source.citation_id,quote,date_text:quote.match(/2024-02-\d{2}/)[0],date_role:"EFFECTIVE"}]:[]};
      })}:{cells:run.source_snapshot.map(s=>({document_id:s.document_id,answer:sources.some(item=>item.document_id===s.document_id)?`30 days [${sources.find(item=>item.document_id===s.document_id).citation_id}].`:""}))}):options.timeline?JSON.stringify({documents:[{document_id:doc,events:[
        {citation_id:"S1",quote:"The synthetic policy took effect on 2024-02-29.",date_text:"2024-02-29",date_role:"EFFECTIVE"},
        {citation_id:"S1",quote:"It was published in 2024-02.",date_text:"2024-02",date_role:"PUBLISHED"}]}]}):options.compare?JSON.stringify({cells:[{document_id:doc,answer:"30 days [S1]."},{document_id:token,answer:"30 days [S2]."}]}):"The retention period is 30 days [S1].";
      return json({candidates:[{finishReason:options.incomplete?"MAX_TOKENS":"STOP",content:{parts:[{text:answer}]}}],usageMetadata:{promptTokenCount:20,candidatesTokenCount:12}});
    }
    if(url.hostname==="qdrant.invalid") {
      const points=options.noDense?[]:[{id:chunk,score:0.9,payload:{workspace_id:ws,document_id:doc,version_id:version,index_generation:"generation-one",chunk_id:chunk}}];
      if(url.pathname.endsWith("/points/query/batch"))return json({result:JSON.parse(init.body).searches.map((_,i,list)=>({points:options.lastVariantOnly&&i!==list.length-1?[]:points}))});
      return json(url.pathname.endsWith("/points/query")?{result:{points:options.lastVariantOnly?[]:points}}:{});
    }
    throw Error(`Unapproved fixture egress ${url.hostname}`);
  });
  const env={SUPABASE_URL:"https://supabase.invalid",SUPABASE_SERVICE_ROLE_KEY:"synthetic",GOOGLE_API_KEY:"synthetic-not-a-key",QDRANT_URL:"https://qdrant.invalid",QDRANT_API_KEY:"synthetic",
    INGESTION_QUEUE:{send:async value=>sent.push(value)}};
  return {env,db,run,calls,sent,provider,hash,reservations,reads};
}

test("Deep Research executes the full60source13question plan with explicit source coverage and resumable progress",async t=>{
  const {env,db,calls,sent}=await fixture(t,{deep:true,documentCount:60,more:true,noDense:true});
  const result=await processResearchMessage(env,message,db);
  assert.equal(result?.state,"queued");assert.equal(result.position,1);
  const saved=calls.find(call=>call.p_operation==="commit")?.p_result;
  assert.equal(saved.deep.schema_version,"research-deep/1");
  assert.equal(saved.deep.phase,"SUBQUESTION");assert.equal(saved.deep.criterion_index,0);
  assert.equal(saved.deep.question_count,13);assert.equal(saved.deep.documents.length,60);
  assert.equal(saved.query_retrieval.max_queries,8);
  assert.equal(sent.length,1);assert.equal(sent[0].position,1);
});

test("actual Deep synthesis rehydrates every prior original and preserves12subquestion outcomes before saving result13",async t=>{
  const {env,db,calls,provider,reads}=await fixture(t,{deep:true,deepSynthesis:true,documentCount:60,noDense:true});
  const result=await processResearchMessage(env,{...message,position:12},db);
  assert.equal(result?.state,"completed");assert.equal(result.position,13);assert.equal(result.results.length,13);
  const saved=calls.find(call=>call.p_operation==="commit")?.p_result;
  assert.equal(saved.deep.phase,"SYNTHESIS");assert.equal(saved.deep.prior_results.length,12);
  assert.equal(saved.sources.length,60);assert.equal(saved.deep.documents.length,60);
  assert.equal(reads.filter(path=>path==="rpc/nexus_research_deep_context").length,1);
  const prompt=provider.filter(call=>call.url.endsWith(":generateContent")).map(call=>JSON.parse(call.body).contents[0].parts[0].text).find(text=>text.startsWith("DEEP_RESEARCH_SYNTHESIS"));
  const notes=JSON.parse(prompt.split("PREVIOUS_ANALYSES_NOT_EVIDENCE:\n")[1].split("\nEVIDENCE:\n")[0]);
  assert.equal(notes.length,12);assert.match(notes.at(-1).answer,/Earlier derived analysis 11/);
  assert.equal(JSON.parse(prompt.split("\nEVIDENCE:\n")[1]).length,60);
});

test("an unavailable prior original interrupts synthesis without substituting generated notes or committing a report",async t=>{
  const {env,db,calls,provider}=await fixture(t,{deep:true,deepSynthesis:true,documentCount:60,noDense:true,priorContextMissing:true});
  assert.equal(await processResearchMessage(env,{...message,position:12},db),null);
  assert.equal(calls.some(call=>call.p_operation==="commit"),false);
  assert.equal(calls.find(call=>call.p_operation==="interrupt").p_error,"SOURCE_UNAVAILABLE");
  const prompts=provider.filter(call=>call.url.endsWith(":generateContent")).map(call=>JSON.parse(call.body).contents[0].parts[0].text);
  assert.equal(prompts.some(prompt=>prompt.startsWith("DEEP_RESEARCH_SYNTHESIS")),false);
});

test("actual executor never embeds a changed quantity and persists the rejected-alternative receipt",async t=>{
  const question="Is the retention period 30 days?",alternative="Is the retention period 130 days?";
  const {env,db,run,calls,provider}=await fixture(t,{variantQueries:[alternative]});
  run.questions=[question];
  assert.equal((await processResearchMessage(env,message,db))?.state,"completed");
  const receipt=calls.find(call=>call.p_operation==="commit").p_result.query_retrieval;
  assert.deepEqual(receipt.queries,[question]);assert.equal(receipt.rejected_queries,1);
  assert.equal(receipt.completed_queries,1);assert.equal(receipt.expansion_status,"ORIGINAL_ONLY");
  assert.equal(provider.filter(call=>call.url.endsWith(":batchEmbedContents")).length,0);
  const embedding=provider.find(call=>call.url.endsWith(":embedContent"));
  assert.equal(JSON.parse(embedding.body).content.parts[0].text,question);
});

test("actual contradiction executor searches all eight query variants and durably records their coverage",async t=>{
  const alternatives=["duration","interval","limit","policy","schedule","rule","period"].map(term=>`Synthetic retention ${term}`);
  const {env,db,calls,provider}=await fixture(t,{contradiction:true,variantQueries:alternatives,lastVariantOnly:true,chunkCount:400});
  const result=await processResearchMessage(env,message,db);
  assert.equal(result?.state,"completed");
  const saved=calls.find(call=>call.p_operation==="commit")?.p_result;
  assert.equal(saved?.query_retrieval?.queries.length,8);
  assert.equal(saved.query_retrieval.queries[0],saved.question);
  assert.deepEqual(saved.query_retrieval.queries.slice(1),alternatives);
  assert.equal(saved.query_retrieval.completed_queries,8);
  assert.equal(provider.filter(call=>call.url.endsWith(":batchEmbedContents")).length,1);
  assert.equal(provider.filter(call=>call.url.endsWith("/points/query/batch")).length,1);
  assert.ok(saved.sources.some(source=>source.chunk_id===chunk));
  assert.ok(saved.coverage.chunks_considered<=200);
});

test("full fifty-source research retrieval fits the free Worker subrequest bound without reducing scope",async t=>{
  const {env,db,calls,reads,provider}=await fixture(t,{contradiction:true,noDense:true,documentCount:50});
  const run=await processResearchMessage(env,message,db);
  assert.equal(run?.state,"completed");
  const saved=calls.find(call=>call.p_operation==="commit")?.p_result;
  assert.equal(saved.contradiction.documents.length,50);
  assert.ok(reads.length+provider.length<50,`${reads.length+provider.length} reads/provider requests before quota calls`);
});

for(const mode of ["COMPARE","TIMELINE"])for(const count of [2,3,7,8])test(`${mode} retains all ${count} selected documents when the first source fills the lexical window`,async t=>{
  const {env,db,calls,reads}=await fixture(t,{compare:mode==="COMPARE",timeline:mode==="TIMELINE",documentCount:count,chunkCount:400,noDense:true});
  const run=await processResearchMessage(env,message,db);
  assert.equal(run?.state,"completed");
  const saved=calls.find(call=>call.p_operation==="commit").p_result;
  assert.equal(new Set(saved.sources.map(s=>s.document_id)).size,count);
  if(mode==="COMPARE")assert.ok(saved.comparison.cells.every(cell=>!cell.abstained));
  else assert.equal(saved.timeline.events.length,count);
  assert.equal(reads.filter(path=>path==="rpc/nexus_research_candidates").length,1);
  assert.ok(saved.coverage.chunks_considered<=200);assert.equal(saved.coverage.lexical_limit_reached,true);
});

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
  assert.equal(provider.filter(call=>call.url.endsWith(":generateContent")&&!JSON.parse(call.body).contents[0].parts[0].text.startsWith("RESEARCH_QUERY_VARIANTS")).length,0);
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
  assert.equal(provider.filter(p=>p.url.endsWith(":generateContent")&&!JSON.parse(p.body).contents[0].parts[0].text.startsWith("RESEARCH_QUERY_VARIANTS")).length,1);
  assert.ok(provider.every(p=>p.signal instanceof AbortSignal));
});

test("comparison execution persists one separately cited cell for every selected document",async t=>{
  const {env,db,calls,provider,reservations}=await fixture(t,{compare:true});
  await processResearchMessage(env,message,db);
  const saved=calls.find(c=>c.p_operation==="commit").p_result;
  assert.equal(saved.comparison?.schema_version,"research-comparison/1");
  assert.deepEqual(saved.comparison.cells.map(cell=>[cell.document_id,cell.validated_citation_ids]),[[doc,["S1"]],[token,["S2"]]]);
  assert.equal(saved.comparison.criterion_index,0);assert.equal(saved.comparison.batch_index,0);
  const answer=provider.filter(p=>p.url.endsWith(":generateContent")&&!JSON.parse(p.body).contents[0].parts[0].text.startsWith("RESEARCH_QUERY_VARIANTS"));
  assert.equal(answer.length,1);
  assert.equal(JSON.parse(answer[0].body).generationConfig.maxOutputTokens,4096);
  assert.equal(reservations.filter(value=>value.output_tokens).at(-1).output_tokens,4096);
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
  assert.equal(reservations.filter(value=>value.output_tokens).at(-1).output_tokens,4096);
});
test("contradiction execution retains paired literal evidence and provisional context instead of an ordinary answer",async t=>{
  const {env,db,calls,hash}=await fixture(t,{contradiction:true,noDense:true});
  await processResearchMessage(env,message,db);
  const saved=calls.find(c=>c.p_operation==="commit")?.p_result;
  assert.equal(saved?.contradiction?.schema_version,"research-contradiction/1");
  assert.equal(saved.contradiction.pairs[0].relationship,"INSUFFICIENT_CONTEXT");
  assert.equal(saved.claim_state,"REVIEW_REQUIRED");
  assert.deepEqual(saved.validated_citation_ids,["S1","S2"]);
  for(const side of ["left","right"]) {
    const quote=saved.contradiction.pairs[0][side],source=saved.sources.find(s=>s.citation_id===quote.citation_id);
    assert.equal(source.original_content_hash,hash);
    assert.equal(Array.from(source.content).slice(quote.quote_start,quote.quote_end).join(""),quote.quote);
  }
  assert.equal(saved.contradiction.documents.length,2);
  assert.equal(saved.contradiction.interpretation,"REVIEW_REQUIRED_NO_AUTOMATIC_CONFLICT_VERDICT");
});
test("actual contradiction executor retains all50sources and pairs the first with the last without a40source cutoff",async t=>{
  const {env,db,calls,reads,run}=await fixture(t,{contradiction:true,noDense:true,documentCount:50});
  await processResearchMessage(env,message,db);
  const saved=calls.find(c=>c.p_operation==="commit")?.p_result;
  assert.equal(saved?.contradiction?.total_documents,50);
  assert.equal(saved.contradiction.documents.length,50);
  assert.deepEqual(saved.sources.map(s=>s.document_id),[run.source_snapshot[0].document_id,run.source_snapshot[49].document_id]);
  for(const source of saved.sources)assert.equal(source.original_content_hash,await sha256(source.content));
  assert.equal(reads.filter(path=>path==="rpc/nexus_research_candidates").length,1);
  assert.ok(saved.contradiction.documents.every(d=>d.consulted_sources.length===1));
});

for(const [mode,options] of [["Deep Research",{deep:true,documentCount:60}],["Deep synthesis",{deep:true,deepSynthesis:true,documentCount:60}],["Contradiction",{contradiction:true}]])
test(`${mode} preserves unknown original page metadata rather than inventing page0`,async t=>{
  const {env,db,calls}=await fixture(t,{...options,pageNumber:null});
  await processResearchMessage(env,{...message,position:options.deepSynthesis?12:0},db);
  const saved=calls.find(call=>call.p_operation==="commit")?.p_result;
  assert.ok(saved);
  assert.ok(saved.sources.length>0);
  assert.ok(saved.sources.every(source=>source.page_number===null));
  const documents=(saved.deep||saved.contradiction).documents;
  assert.ok(documents.every(document=>document.consulted_sources.length>0&&document.consulted_sources.every(source=>source.page_number===null)));
});
for(const pageNumber of [0,2])for(const [mode,options] of [["Deep Research",{deep:true,documentCount:60}],["Deep synthesis",{deep:true,deepSynthesis:true,documentCount:60}],["Contradiction",{contradiction:true}]])
test(`${mode} preserves the distinct original page value ${pageNumber}`,async t=>{
  const {env,db,calls}=await fixture(t,{...options,pageNumber});
  await processResearchMessage(env,{...message,position:options.deepSynthesis?12:0},db);
  const saved=calls.find(call=>call.p_operation==="commit")?.p_result;
  assert.ok(saved?.sources.length>0);
  assert.ok(saved.sources.every(source=>source.page_number===pageNumber));
  assert.ok((saved.deep||saved.contradiction).documents.every(document=>document.consulted_sources.every(source=>source.page_number===pageNumber)));
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
  assert.equal(JSON.parse(provider.filter(p=>p.url.endsWith(":generateContent")).at(-1).body).generationConfig.temperature,0.7);
});
