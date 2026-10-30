// Combined valid bounds through the actual Worker queue; all peers are local synthetic data.
import assert from "node:assert/strict";
import {startLocalWorker} from "./local-worker-harness.mjs";
import {createHash,randomUUID} from "node:crypto";
import {mkdtemp,writeFile} from "node:fs/promises";
import {createServer} from "node:http";
import {tmpdir} from "node:os";
import {dirname,join,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {obligationCapacity,obligationWire} from "../../tests/fixtures/research-obligation-capacity.mjs";
import {entityCapacity,entityWire} from "../../tests/fixtures/research-entity-data.mjs";
import {diligenceCapacity,diligenceWire} from "../../tests/fixtures/research-diligence-data.mjs";
import {passportCapacity,passportWire} from "../../tests/fixtures/research-passport-data.mjs";
import {procurementCapacity,procurementWire} from "../../tests/fixtures/research-procurement-data.mjs";

const investigating=process.env.NEXUS_NATIVE_RESEARCH_MODE==="ENTITY_INVESTIGATION";
const diligence=process.env.NEXUS_NATIVE_RESEARCH_MODE==="DUE_DILIGENCE";
const passport=process.env.NEXUS_NATIVE_RESEARCH_MODE==="PRODUCT_PASSPORT";
const procurement=process.env.NEXUS_NATIVE_RESEARCH_MODE==="PROCUREMENT_RESEARCH";
const label=investigating?"ENTITY":diligence?"DILIGENCE":passport?"PASSPORT":procurement?"PROCUREMENT":"OBLIGATION",sourceCount=diligence||passport?60:50,questionCount=diligence||passport?13:11;
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../.."),fixture=investigating?entityCapacity():diligence?diligenceCapacity():passport?passportCapacity():procurement?procurementCapacity():obligationCapacity();
const wire=passport?passportWire(fixture.sources):procurement?procurementWire(fixture.sources):diligence?diligenceWire(fixture.sources,{capacity:true}):(investigating?entityWire:obligationWire)(fixture.candidates,fixture.sources),wireText=JSON.stringify(wire);
const ws="11111111-1111-4111-8111-111111111111",actor="22222222-2222-4222-8222-222222222222";
const runId="33333333-3333-4333-8333-333333333333",policy="88888888-8888-4888-8888-888888888888",token="77777777-7777-4777-8777-777777777777";
const documents=fixture.documents.map((doc,i)=>({...doc,workspace_id:ws,active_version_id:fixture.originals[i].version_id,lifecycle_state:"active"}));
const versions=fixture.originals.map(row=>({id:row.version_id,document_id:row.document_id,workspace_id:ws,publication_state:"ready",
  data_classification:"non_sensitive",index_generation:"synthetic-capacity",lifecycle_epoch:1}));
const originals=fixture.originals.map(row=>({...row,workspace_id:ws,content:row.original_text}));
const chunks=[...originals,...Array.from({length:200-sourceCount},(_,i)=>{
  const prefix=`Unrelated appendix ${i}. `,room=32768-Buffer.byteLength(prefix),text=prefix+"x".repeat(room);
  return {...originals[i%sourceCount],id:`ff444400-0000-4000-8100-${String(i+1).padStart(12,"0")}`,chunk_index:Math.floor(i/sourceCount)+1,
    content:text,original_text:text,original_content_hash:createHash("sha256").update(text).digest("hex"),location:{char_start:0,char_end:text.length}};
})];
let run={...fixture.run,id:runId,plan_id:"44444444-4444-4444-8444-444444444444",workspace_id:ws,owner_id:actor,generation:1,state:"queued",source_state:"CURRENT",
  results:[],deadline:new Date(Date.now()+(diligence||passport?600000:420000)).toISOString(),admission:{credential_mode:"platform_trial"}};
let stepCalls=[],requests=[],prompts=[],peerErrors=[],maxResultBytes=0,maxPromptBytes=0,failProvider=false,interrupted=null;
const peer=createServer(async(request,response)=>{
  const json=(value,status=200)=>{response.writeHead(status,{"content-type":"application/json"});response.end(JSON.stringify(value));};
  try {
    const parts=[];for await(const part of request)parts.push(part);
    const body=JSON.parse(Buffer.concat(parts).toString("utf8")||"{}"),url=new URL(request.url,"http://localhost");requests.push(url.pathname);
    if(url.pathname.endsWith("/v6_reserve_many"))return json({state:"READY",reservations:Object.values(body.p_dimensions).map(amount=>({id:randomUUID(),amount,replayed:false}))});
    if(url.pathname.endsWith("/v6_settle_many"))return json({state:"SETTLED"});
    if(url.pathname==="/synthetic-gemini") {
      if(body.requests)return json({embeddings:body.requests.map(()=>({values:Array(768).fill(0.01)}))});
      if(body.content)return json({embedding:{values:Array(768).fill(0.01)}});
      const prompt=body.contents[0].parts[0].text;prompts.push(prompt);maxPromptBytes=Math.max(maxPromptBytes,Buffer.byteLength(prompt));
      if(failProvider&&!prompt.startsWith("RESEARCH_QUERY_VARIANTS"))return json({message:"Ordinary controlled provider outage."},503);
      const output=prompt.startsWith("RESEARCH_QUERY_VARIANTS")?{queries:["duration","interval","policy","schedule","rule","period","context"].map(word=>`${prompt.split("QUESTION:\n")[1].split(" ")[0]} Synthetic obligation ${word}`)}:wire;
      if(!prompt.startsWith("RESEARCH_QUERY_VARIANTS")){
        assert.equal(JSON.parse(prompt.split("\nEVIDENCE:\n")[1]).length,sourceCount);assert.equal(body.generationConfig.maxOutputTokens,4096);
        assert.ok(prompt.includes(investigating?"research-entity-wire/1":diligence?"research-diligence-wire/1":passport?"research-passport-wire/1":procurement?"research-procurement-wire/1":"research-obligation-wire/1"));
        if(investigating||diligence)assert.ok(prompt.includes(JSON.stringify(fixture.targets)));
        if(passport)assert.ok(prompt.includes(JSON.stringify(fixture.subject)));
      }
      return json({candidates:[{finishReason:"STOP",content:{parts:[{text:JSON.stringify(output)}]}}]});
    }
    if(url.pathname.endsWith("/points/query/batch"))return json({result:body.searches.map(()=>({points:[]}))});
    if(url.pathname.startsWith("/collections/"))return json({result:{config:{params:{vectors:{size:768,distance:"Cosine"}}}}});
    if(url.pathname==="/rest/v1/research_runs")return json([run]);
    if(url.pathname==="/rest/v1/workspaces")return json([{capability_revision:1,lifecycle_state:"active"}]);
    if(url.pathname==="/rest/v1/workspace_settings")return json([{active_policy_id:policy,policy_version:1,retrieval_top_k:12,hybrid_search_alpha:0.5,llm_temperature:0}]);
    if(url.pathname==="/rest/v1/documents")return json(documents);
    if(url.pathname==="/rest/v1/document_versions")return json(versions);
    if(url.pathname==="/rest/v1/document_chunks"){
      const ids=new Set(url.searchParams.get("id").slice(4,-1).split(","));return json(chunks.filter(row=>ids.has(row.id)));
    }
    if(url.pathname==="/rest/v1/rpc/nexus_research_candidates")return json({schema_version:"research-candidates/1",run_id:runId,generation:1,position:run.position,
      items:chunks,lexical_rows_read:201,lexical_limit_reached:true});
    if(url.pathname==="/rest/v1/rpc/nexus_research_step") {
      stepCalls.push({operation:body.p_operation,error:body.p_error});
      if(body.p_operation==="claim"){run={...run,state:"running"};return json({claimed:true,token,run});}
      if(body.p_operation==="commit") {
        maxResultBytes=Math.max(maxResultBytes,Buffer.byteLength(JSON.stringify(body.p_result)));
        run={...run,position:run.position+1,state:run.position===questionCount-1?"completed":"queued",results:[...run.results,body.p_result]};
        return json({claimed:false,run});
      }
      interrupted=body.p_error;run={...run,state:"interrupted",error_code:body.p_error};return json({claimed:false,run});
    }
    throw Error(`Unexpected controlled peer path ${url.pathname}`);
  }catch(error){peerErrors.push(String(error));json({message:"Controlled peer failure."},500);}
});
await new Promise(resolve=>peer.listen(0,"127.0.0.1",resolve));
let runtime,port;
const directory=await mkdtemp(join(tmpdir(),"nexusrag-obligation-workerd-")),base=`http://127.0.0.1:${peer.address().port}`;
const entry=join(directory,"obligation-entry.mjs"),config=join(directory,"wrangler.json");
await writeFile(entry,`import worker from ${JSON.stringify(join(root,"apps/gateway/src/preview-worker.js").replaceAll("\\","/"))};
const ordinary=globalThis.fetch;globalThis.fetch=(input,init)=>{const url=new URL(input instanceof Request?input.url:input);
 if(url.hostname==="generativelanguage.googleapis.com")return ordinary(${JSON.stringify(base+"/synthetic-gemini")},init);
 if(url.origin!==${JSON.stringify(base)})throw Error("Only the explicit local synthetic peer is configured.");return ordinary(input,init);};
export default {async fetch(request,env){if(new URL(request.url).pathname==="/health")return new Response("OK");
 const {position}=await request.json(),sent=[];let ack=0,retry=0;const start=performance.now();
 await worker.queue({messages:[{body:{kind:"research",workspace_id:${JSON.stringify(ws)},run_id:${JSON.stringify(runId)},generation:1,position},ack(){ack++},retry(){retry++}}]},
 {...env,INGESTION_QUEUE:{send:async body=>{sent.push(body)}}});return Response.json({ack,retry,sent,wall_ms:performance.now()-start});}};`);
await writeFile(config,JSON.stringify({name:"nexusrag-synthetic-obligation-worker",main:entry,compatibility_date:"2026-09-20",vars:{SUPABASE_URL:base,
  SUPABASE_SERVICE_ROLE_KEY:"synthetic-service",GOOGLE_API_KEY:"synthetic-not-live",QDRANT_URL:base,QDRANT_API_KEY:"synthetic-not-live"}}));
let output="";
try {
  runtime=await startLocalWorker({frontend:join(root,"frontend"),directory,configPath:config});
  port=runtime.port;
  let maxRequests=0,maxWall=0;
  for(let position=0;position<questionCount;position++) {
    const before=requests.length,response=await fetch(`http://127.0.0.1:${port}/execute`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({position}),signal:AbortSignal.timeout(90000)});
    const receipt=await response.json();assert.equal(response.status,200);assert.deepEqual(peerErrors,[]);assert.equal(interrupted,null,JSON.stringify({stepCalls,output}));
    assert.equal(run.position,position+1);assert.equal(receipt.ack,1);assert.equal(receipt.retry,0);assert.equal(receipt.sent.length,position===questionCount-1?0:1);
    const result=run.results[position],analysis=investigating?result.entities:diligence?result.diligence:passport?result.passport:procurement?result.procurement:result.obligations;
    assert.equal((diligence?analysis.observations:passport?analysis.claims:procurement?analysis.records:analysis.candidates).length,12);assert.equal(result.sources.length,investigating||procurement?12:diligence||passport?48:50);assert.equal(result.query_retrieval.completed_queries,8);
    assert.equal(analysis.documents.length,sourceCount);assert.equal(analysis.documents.flatMap(doc=>doc.consulted_sources).length,sourceCount);
    if(investigating) {
      assert.deepEqual(analysis.requested_targets,fixture.targets);
      for(const candidate of analysis.candidates) {
        assert.equal(candidate.relationships.length,4);assert.equal(candidate.limitations.length,4);
        assert.equal(candidate.identity_state,"NOT_RESOLVED");assert.equal(candidate.decision_state,"NO_AUTOMATIC_ADVERSE_DECISION");
        for(const field of ["identifiers","aliases","filings"])assert.equal(candidate[field].length,4);
        for(const row of candidate.relationships)for(const field of ["statement","subject","predicate","object","valid_from","valid_to"])
          assert.equal(Array.from(row[field].quote).length,300);
        assert.ok(candidate.limitations.every(text=>Array.from(text).length===240));
      }
    }else if(diligence) {
      assert.deepEqual(analysis.requested_targets,fixture.targets);assert.equal(analysis.gaps.length,12);
      for(const observation of analysis.observations) {
        assert.equal(observation.evidence.length,4);assert.equal(observation.limitations.length,4);
        assert.equal(observation.identity_state,"NOT_RESOLVED");assert.equal(observation.decision_state,"NO_AUTOMATIC_ADVERSE_DECISION");
        assert.equal(Array.from(observation.summary).length,240);assert.ok(observation.evidence.every(anchor=>Array.from(anchor.quote).length===300));
        assert.ok(observation.limitations.every(text=>Array.from(text).length===240));
      }
    }else if(passport) {
      assert.deepEqual(analysis.subject,fixture.subject);assert.equal(analysis.gaps.length,12);
      for(const claim of analysis.claims){
        assert.equal(claim.evidence.length,4);assert.equal(claim.qualifications.length,4);
        assert.equal(claim.claim_state,"REVIEW_REQUIRED");assert.equal(claim.status_state,"PROPOSED_NOT_VERIFIED");
        assert.equal(claim.subject_match,"NOT_VERIFIED");assert.equal(Array.from(claim.property).length,128);
        assert.equal(Array.from(claim.value).length,240);assert.ok(claim.evidence.every(anchor=>Array.from(anchor.quote).length===300));
        assert.ok(claim.qualifications.every(value=>Array.from(value).length===240));
      }
    }else if(procurement) {
      assert.equal(analysis.gaps.length,12);assert.equal(analysis.records.at(-1).source_document_id,documents.at(-1).id);
      for(const record of analysis.records){
        assert.equal(Object.keys(record.fields).length,13);assert.equal(record.limitations.length,4);
        assert.ok(Object.values(record.fields).every(anchor=>Array.from(anchor.quote).length===300));
        assert.ok(record.limitations.every(value=>Array.from(value).length===240));
        assert.equal(record.record_state,"PROPOSED_NOT_VERIFIED");assert.equal(record.decision_state,"NO_AUTOMATIC_ELIGIBILITY_AWARD_OR_RANKING");
      }
    }else assert.ok(result.answer.length>16000);
    assert.ok(Array.from(result.answer).length<=16000);
    for(const source of result.sources){const original=originals.find(row=>row.id===source.chunk_id);
      assert.ok(original);assert.equal(source.original_content_hash,original.original_content_hash);assert.equal(source.page_number,original.page_number);
      assert.equal(source.content,Array.from(original.original_text).slice(0,1200).join(""));}
    maxRequests=Math.max(maxRequests,requests.length-before);maxWall=Math.max(maxWall,receipt.wall_ms);assert.ok(requests.length-before<50);
  }
  assert.equal(run.state,"completed");assert.equal(prompts.filter(prompt=>!prompt.startsWith("RESEARCH_QUERY_VARIANTS")).length,questionCount);
  console.log(JSON.stringify({marker:`ACTUAL_WORKER_${label}_COMBINED_CAPACITY_PASS`,documents:sourceCount,questions:questionCount,...(diligence?{observations_each:12}:passport?{claims_each:12}:procurement?{records_each:12}:{candidates_each:12}),query_variants_each:8,
    ...(investigating?{targets:100,anchors_each:40,relationships_each:4,limitations_each:4,identity_resolved:false}:{}),
    ...(diligence?{targets:100,evidence_anchors_each:4,limitations_each:4,gaps_each:12,identity_resolved:false,summary_codepoints:240}:{}),
    ...(passport?{declared_product:fixture.subject,evidence_anchors_each:4,qualifications_each:4,gaps_each:12,property_codepoints:128,value_codepoints:240,product_match_verified:false}:{}),
    ...(procurement?{fields_each:13,field_anchors_total:156,limitations_each:4,gaps_each:12,record_identity_verified:false}:{}),
    candidate_rows:200,original_bytes_each:32768,quote_codepoints:300,
    ...(investigating||diligence||procurement?{limitation_codepoints:240}:passport?{qualification_codepoints:240}:{control_codepoints:240,qualifying_anchors_each:25}),
    result_json_bytes:maxResultBytes,run_results_json_bytes:Buffer.byteLength(JSON.stringify(run.results)),max_prompt_utf8_bytes:maxPromptBytes,
    max_controlled_http_requests_per_step:maxRequests,max_wall_ms:maxWall,production_queue_and_http_storage_adapter:true,
    provider_wire_bytes:Buffer.byteLength(wireText),provider_wire_sha256:createHash("sha256").update(wireText).digest("hex"),configured_output_tokens:4096,
    sql_and_provider_peers:"CONTROLLED_NOT_HOSTED",hosted_cpu_memory_or_budget_acceptance:false,real_provider_token_or_quality_acceptance:false,provider_processing:false}));
  run={...run,position:0,results:[],state:"queued"};failProvider=true;const before=stepCalls.length,priorGeneration=prompts.length;
  const response=await fetch(`http://127.0.0.1:${port}/execute`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({position:0}),signal:AbortSignal.timeout(90000)});
  const receipt=await response.json();assert.equal(response.status,200);assert.equal(interrupted,"PROVIDER_UNAVAILABLE");assert.equal(run.results.length,0);
  assert.equal(stepCalls.slice(before).filter(call=>call.operation==="commit").length,0);assert.equal(prompts.slice(priorGeneration).filter(prompt=>!prompt.startsWith("RESEARCH_QUERY_VARIANTS")).length,1);
  assert.equal(receipt.ack,1);assert.equal(receipt.retry,0);assert.equal(receipt.sent.length,0);
  console.log(`ACTUAL_WORKER_${label}_ORDINARY_OUTAGE_PASS: no commit or automatic provider/queue repeat; controlled peers only`);
}finally{
  try{if(runtime)await runtime.close();}finally{
    await new Promise(resolve=>peer.close(resolve));
  }
}
const released=createServer();await new Promise((resolve,reject)=>{released.once("error",reject);released.listen(port,"127.0.0.1",resolve);});await new Promise(resolve=>released.close(resolve));
console.log(`ACTUAL_WORKER_${label}_OWNED_LISTENER_RELEASED`);
