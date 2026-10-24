// Valid supported Deep Research boundaries through the production Worker queue.
import assert from "node:assert/strict";
import {startLocalWorker} from "./local-worker-harness.mjs";
import {createHash,randomUUID} from "node:crypto";
import {mkdtemp,writeFile} from "node:fs/promises";
import {createServer} from "node:http";
import {tmpdir} from "node:os";
import {dirname,join,resolve} from "node:path";
import {fileURLToPath} from "node:url";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"../.."),ws="11111111-1111-4111-8111-111111111111";
const actor="22222222-2222-4222-8222-222222222222",runId="33333333-3333-4333-8333-333333333333",token="77777777-7777-4777-8777-777777777777";
const policy="88888888-8888-4888-8888-888888888888",identity=(prefix,n)=>`${prefix}-0000-4000-8000-${String(n).padStart(12,"0")}`;
const variants=["alpha","beta","gamma","delta","epsilon","zeta","eta"].map(word=>`Native retention evidence ${word}`);
const documents=Array.from({length:60},(_,i)=>({id:identity("43000000",i),workspace_id:ws,active_version_id:identity("44000000",i),
  filename:`Native synthetic source ${i}.txt`,lifecycle_state:"active",content_type:"text/plain"}));
const versions=documents.map(d=>({id:d.active_version_id,workspace_id:ws,document_id:d.id,publication_state:"ready",
  data_classification:"non_sensitive",index_generation:"native-synthetic-generation",lifecycle_epoch:1}));
const snapshot=versions.map(v=>({document_id:v.document_id,version_id:v.id,index_generation:v.index_generation,lifecycle_epoch:1}));
const chunks=Array.from({length:345},(_,i)=>{
  const prefix=`Native retention original ${i}. `,room=32768-Buffer.byteLength(prefix),original=prefix+"\u{1F4CA}".repeat(Math.floor(room/4))+"x".repeat(room%4);
  assert.equal(Buffer.byteLength(original),32768);
  return {id:identity("45000000",i),workspace_id:ws,document_id:documents[i%60].id,version_id:versions[i%60].id,
    chunk_index:Math.floor(i/60),page_number:[null,0,2][i%3],content:original,original_text:original,
    original_content_hash:createHash("sha256").update(original).digest("hex"),location:{char_start:0,char_end:Array.from(original).length},metadata:{}};
});
const source=(row,i)=>({citation_id:`S${i+1}`,document_id:row.document_id,version_id:row.version_id,chunk_id:row.id,
  filename:documents.find(d=>d.id===row.document_id).filename,content:Array.from(row.original_text).slice(0,1200).join(""),
  original_content_hash:row.original_content_hash,chunk_index:row.chunk_index,page_number:row.page_number,location:row.location,excerpt:true});
const consulted=rows=>rows.map(row=>({version_id:row.version_id,chunk_id:row.id,original_content_hash:row.original_content_hash,
  chunk_index:row.chunk_index,page_number:row.page_number}));
const questions=[...Array.from({length:12},(_,i)=>`Native retention subquestion ${String.fromCharCode(97+i)}?`),
  ("Native retention context "+"context ".repeat(1250)).slice(0,10000)];
assert.equal(questions[12].length,10000);
const prior=Array.from({length:12},(_,index)=>{
  const sources=chunks.slice(index*12,index*12+12).map(source),begin=`Native derived note ${index}. `,tail=" [S1]";
  return {question:questions[index],answer:begin+"a".repeat(16000-begin.length-tail.length)+tail,claim_state:"REVIEW_REQUIRED",abstained:false,
    sources,validated_citation_ids:["S1"],model:"synthetic-not-live",usage:{},provider_cost_status:"UNKNOWN",paid_fallback:false,
    review_state:"COMPLETION_CRITERIA_NOT_AUTOMATICALLY_VERIFIED",runtime_options:{retrieval_top_k:12,hybrid_search_alpha:1,llm_temperature:0},
    selection:{reason:"DEEP_RESEARCH_ALL_DOCUMENTS",document_ids:documents.map(d=>d.id)},
    coverage:{chunks_considered:200,lexical_limit_reached:true,retrieval:"BOUNDED_DENSE_LEXICAL",completeness:"NOT_EXHAUSTIVE",evidence_authority:"SUPABASE_HASH_VERIFIED"},
    deep:{schema_version:"research-deep/1",phase:"SUBQUESTION",criterion_index:index,question_count:13,
      documents:documents.map(d=>({document_id:d.id,filename:d.filename,evidence_state:sources.some(s=>s.document_id===d.id)?sources[0].document_id===d.id?"CITED":"IN_CONTEXT":"CANDIDATES_ONLY",
        context_citation_ids:sources.filter(s=>s.document_id===d.id).map(s=>s.citation_id),consulted_sources:consulted(chunks.slice(0,200).filter(c=>c.document_id===d.id))})),
      prior_results:[],limitations:["Synthetic derived notes require independent review."],gaps:[],
      interpretation:"REVIEW_REQUIRED_CITATIONS_NOT_ENTAILMENT",coverage:"BOUNDED_CANDIDATES_AND_CONTEXT_NOT_EXHAUSTIVE"}};
});
let state;
function reset(position,providerUnavailable=false){
  state={position,providerUnavailable,requests:[],calls:[],prompts:[],reservations:[],peer_errors:[],committed:null,interrupted:null,
    run:{id:runId,workspace_id:ws,owner_id:actor,mode:"DEEP_RESEARCH",generation:1,position,state:"running",source_state:"CURRENT",
      questions,results:position===12?prior:[],source_snapshot:snapshot,deadline:new Date(Date.now()+600000).toISOString(),admission:{credential_mode:"platform_trial"}}};
}
const authority=createServer(async(request,response)=>{
  const json=(value,status=200)=>{response.writeHead(status,{"content-type":"application/json"});response.end(JSON.stringify(value));};
  try {
    const parts=[];for await(const part of request)parts.push(part);
    const body=JSON.parse(Buffer.concat(parts).toString("utf8")||"{}"),url=new URL(request.url,"http://localhost");state.requests.push({path:url.pathname,method:request.method});
    if(url.pathname.endsWith("/v6_reserve_many")){
      state.reservations.push(body);return json({state:"READY",reservations:Object.values(body.p_dimensions).map(amount=>({id:randomUUID(),amount,replayed:false}))});
    }
    if(url.pathname.endsWith("/v6_settle_many"))return json({state:"SETTLED"});
    if(url.pathname==="/synthetic-gemini"){
      if(body.requests)return json({embeddings:body.requests.map(()=>({values:Array(768).fill(0.01)}))});
      const prompt=body.contents[0].parts[0].text;state.prompts.push(prompt);
      if(state.providerUnavailable&&prompt.startsWith("DEEP_RESEARCH_"))return json({message:"Ordinary synthetic provider outage."},503);
      const answer=prompt.startsWith("RESEARCH_QUERY_VARIANTS")?{queries:variants}:
        {answer:"The native synthetic originals require independent review [S1].",limitations:["Controlled peers, not live quality."],gaps:[]};
      return json({candidates:[{finishReason:"STOP",content:{parts:[{text:JSON.stringify(answer)}]}}],usageMetadata:{promptTokenCount:100,candidatesTokenCount:20}});
    }
    if(url.pathname.endsWith("/points/query/batch"))return json({result:body.searches.map(()=>({points:chunks.slice(144,156).map(row=>({id:row.id,score:0.9,
      payload:{workspace_id:ws,document_id:row.document_id,version_id:row.version_id,index_generation:"native-synthetic-generation",chunk_id:row.id}}))}))});
    if(url.pathname.startsWith("/collections/"))return json({result:{config:{params:{vectors:{size:768,distance:"Cosine"}}}}});
    if(url.pathname==="/rest/v1/research_runs")return json([state.run]);
    if(url.pathname==="/rest/v1/workspaces")return json([{capability_revision:1,lifecycle_state:"active"}]);
    if(url.pathname==="/rest/v1/workspace_settings")return json([{active_policy_id:policy,policy_version:1,retrieval_top_k:12,hybrid_search_alpha:1,llm_temperature:0}]);
    if(url.pathname==="/rest/v1/documents")return json(documents.slice(0,Number(url.searchParams.get("limit"))));
    if(url.pathname==="/rest/v1/document_versions")return json(versions.slice(0,Number(url.searchParams.get("limit"))));
    if(url.pathname==="/rest/v1/document_chunks"){
      const ids=new Set(url.searchParams.get("id").slice(4,-1).split(","));return json(chunks.filter(row=>ids.has(row.id)));
    }
    if(url.pathname==="/rest/v1/rpc/nexus_research_candidates")return json({schema_version:"research-candidates/1",run_id:runId,generation:1,position:state.position,
      items:chunks.slice(144,344),lexical_rows_read:201,lexical_limit_reached:true});
    if(url.pathname==="/rest/v1/rpc/nexus_research_deep_context")return json({schema_version:"research-deep-context/1",run_id:runId,generation:1,position:state.position,items:chunks.slice(0,144)});
    if(url.pathname==="/rest/v1/rpc/nexus_research_step"){
      state.calls.push(body);
      if(body.p_operation==="claim")return json({claimed:true,token,run:state.run});
      if(body.p_operation==="commit"){
        state.committed=body.p_result;return json({claimed:false,run:{...state.run,state:state.position===12?"completed":"queued",position:state.position+1,results:[...state.run.results,body.p_result]}});
      }
      state.interrupted=body.p_error;return json({claimed:false,run:{...state.run,state:"interrupted",error_code:body.p_error}});
    }
    throw Error(`Unexpected synthetic peer path ${url.pathname}`);
  }catch(error){state.peer_errors.push(String(error));json({message:"Synthetic peer failed."},500);}
});
await new Promise(resolve=>authority.listen(0,"127.0.0.1",resolve));
let runtime,port;
const directory=await mkdtemp(join(tmpdir(),"nexusrag-deep-workerd-")),base=`http://127.0.0.1:${authority.address().port}`;
const entry=join(directory,"deep-entry.mjs"),config=join(directory,"wrangler.json");
await writeFile(entry,`import worker from ${JSON.stringify(join(root,"apps/gateway/src/preview-worker.js").replaceAll("\\","/"))};
const ordinary=globalThis.fetch;
globalThis.fetch=(input,init)=>{const url=new URL(input instanceof Request?input.url:input);
 if(url.hostname==="generativelanguage.googleapis.com")return ordinary(${JSON.stringify(base+"/synthetic-gemini")},init);
 if(url.origin!==${JSON.stringify(base)})throw Error("Only the explicit local synthetic peer is configured.");return ordinary(input,init);};
export default {async fetch(request,env){if(new URL(request.url).pathname==="/health")return new Response("OK");
 const {position}=await request.json(),sent=[];let ack=0,retry=0;const start=performance.now();
 await worker.queue({messages:[{body:{kind:"research",workspace_id:${JSON.stringify(ws)},run_id:${JSON.stringify(runId)},generation:1,position},ack(){ack++},retry(){retry++}}]},
 {...env,INGESTION_QUEUE:{send:async body=>{sent.push(body)}}});
 return Response.json({ack,retry,sent,wall_ms:performance.now()-start,hosted_cpu_acceptance:false});}};`);
await writeFile(config,JSON.stringify({name:"nexusrag-synthetic-deep-worker",main:entry,compatibility_date:"2026-09-20",vars:{SUPABASE_URL:base,
  SUPABASE_SERVICE_ROLE_KEY:"synthetic-service",GOOGLE_API_KEY:"synthetic-not-live",QDRANT_URL:base,QDRANT_API_KEY:"synthetic-not-live"}}));
let output="";
try {
  runtime=await startLocalWorker({frontend:join(root,"frontend"),directory,configPath:config});
  port=runtime.port;
  for(const [position,providerUnavailable] of [[0,false],[12,false],[12,true]]){
    reset(position,providerUnavailable);
    const response=await fetch(`http://127.0.0.1:${port}/execute`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({position}),signal:AbortSignal.timeout(90000)});
    const receipt=await response.json();assert.equal(response.status,200);assert.deepEqual(state.peer_errors,[]);
    if(providerUnavailable){
      assert.equal(state.committed,null);assert.equal(state.interrupted,"PROVIDER_UNAVAILABLE");
      assert.equal(state.calls.filter(call=>call.p_operation==="interrupt").length,1);
      assert.equal(state.prompts.filter(prompt=>prompt.startsWith("DEEP_RESEARCH_SYNTHESIS")).length,1);
      assert.equal(receipt.ack,1);assert.equal(receipt.retry,0);assert.equal(receipt.sent.length,0);
      assert.equal(state.requests.filter(request=>request.path.endsWith("/v6_settle_many")).length,state.reservations.length);
      assert.ok(state.requests.length<50);
      console.log(JSON.stringify({marker:"ACTUAL_WORKER_DEEP_ORDINARY_OUTAGE_PASS",automatic_provider_repeat:false,committed_result:false,
        interruption:"PROVIDER_UNAVAILABLE",delivered_message_acknowledged:true,automatic_queue_retry:false,
        controlled_http_requests:state.requests.length,
        production_worker_queue_and_storage_adapter:true,sql_and_provider_peers:"CONTROLLED_NOT_HOSTED",provider_processing:false}));
      continue;
    }
    assert.ok(state.committed,JSON.stringify({receipt,calls:state.calls.map(c=>({operation:c.p_operation,error:c.p_error})),output}));
    assert.equal(receipt.ack,1);assert.equal(receipt.retry,0);assert.equal(receipt.sent.length,position===12?0:1);
    const saved=state.committed,prompt=state.prompts.find(value=>value.startsWith(`DEEP_RESEARCH_${position===12?"SYNTHESIS":"SUBQUESTION"}`));
    assert.ok(prompt);assert.equal(saved.deep.documents.length,60);assert.equal(saved.deep.criterion_index,position);
    assert.equal(saved.sources.length,position===12?156:12);assert.equal(saved.query_retrieval.queries.length,8);
    assert.equal(saved.query_retrieval.completed_queries,8);assert.equal(saved.deep.prior_results.length,position===12?12:0);
    assert.equal(saved.deep.documents.flatMap(d=>d.consulted_sources).length,position===12?344:200);
    for(const item of saved.sources){const original=chunks.find(row=>row.id===item.chunk_id);
      assert.equal(Array.from(item.content).length,1200);assert.equal(item.content,Array.from(original.original_text).slice(0,1200).join(""));
      assert.equal(item.page_number,original.page_number);assert.deepEqual(item.location,original.location);
      assert.equal(item.original_content_hash,original.original_content_hash);assert.equal(item.excerpt,true);
    }
    const contexts=JSON.parse(prompt.split("\nEVIDENCE:\n")[1]);assert.equal(contexts.length,saved.sources.length);
    if(position===12){const notes=JSON.parse(prompt.split("PREVIOUS_ANALYSES_NOT_EVIDENCE:\n")[1].split("\nEVIDENCE:\n")[0]);
      assert.equal(notes.length,12);assert.ok(notes.every(note=>note.answer.startsWith("Native derived note ")));
      assert.ok(contexts.every(context=>context.content.startsWith("Native retention original ")));assert.equal(saved.question.length,10000);
    }
    const promptBytes=Buffer.byteLength(prompt);
    assert.ok(state.reservations.some(r=>r.p_dimensions.input_tokens===promptBytes));
    assert.ok(state.requests.length<50);
    console.log(JSON.stringify({marker:"ACTUAL_WORKER_DEEP_BOUNDARY_PASS",phase:saved.deep.phase,documents:60,queries:8,original_chunk_bytes:32768,
      prior_originals:position===12?144:0,synthesis_or_subquestion_contexts:saved.sources.length,consulted_originals:saved.deep.documents.flatMap(d=>d.consulted_sources).length,
      prompt_utf8_bytes:promptBytes,controlled_http_requests:state.requests.length,wall_ms:receipt.wall_ms,
      production_worker_queue_and_storage_adapter:true,sql_and_provider_peers:"CONTROLLED_NOT_HOSTED",actual_hosted_cpu_memory_latency_acceptance:false,
      real_rights_budget_or_model_quality_acceptance:false,provider_processing:false}));
  }
}finally{
  try{if(runtime)await runtime.close();}finally{
    await new Promise(resolve=>authority.close(resolve));
  }
}
const released=createServer();
await new Promise((resolve,reject)=>{released.once("error",reject);released.listen(port,"127.0.0.1",resolve);});
await new Promise(resolve=>released.close(resolve));
console.log("ACTUAL_WORKER_DEEP_OWNED_LISTENER_RELEASED");
