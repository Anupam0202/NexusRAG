import { workbenchContext } from "./workbench.js";
import { researchMessage } from "./research-runs.js";
import { candidateChunkIds, rehydrateEvidence } from "./retrieval-authority.js";
import { resolveSummaryDocuments } from "./document-summary-scope.js";
import { hybridFuse } from "./worker-lifecycle.js";
import { generateAnswer, groundedPrompt, searchChunks } from "./worker-pipeline.js";
import { assessAnswer } from "./answer-evidence.js";
import { loadUserGeminiKey } from "./user-gemini-key.js";
import { persistedSetting } from "./runtime-options.js";

const uuid=/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const fail=(code,message)=>Object.assign(new Error(message),{code});
const columns="id,workspace_id,document_id,version_id,chunk_index,page_number,content,original_text,original_content_hash,location,metadata";
async function answerQuestion(env,run,db,signal) {
  const read=path=>db(env,path,{signal}), workspace=run.workspace_id;
  const documentIds=run.source_snapshot.map(item=>item.document_id), versionIds=run.source_snapshot.map(item=>item.version_id);
  const load=async()=>{
    const documents=await read(`documents?workspace_id=eq.${workspace}&id=in.(${documentIds.join(",")})&lifecycle_state=eq.active&select=id,workspace_id,active_version_id,lifecycle_state,filename,content_type&limit=20`);
    const versions=await read(`document_versions?workspace_id=eq.${workspace}&id=in.(${versionIds.join(",")})&publication_state=eq.ready&data_classification=eq.non_sensitive&select=id,workspace_id,document_id,publication_state,data_classification,index_generation,lifecycle_epoch&limit=20`);
    if(run.source_snapshot.some(s=>!documents.some(d=>d.id===s.document_id&&d.active_version_id===s.version_id)
      || !versions.some(v=>v.id===s.version_id&&v.document_id===s.document_id&&v.index_generation===s.index_generation&&v.lifecycle_epoch===s.lifecycle_epoch)))
      throw fail("SOURCE_UNAVAILABLE","The selected evidence changed.");
    return {documents,versions};
  };
  const initial=await load(), question=run.questions[run.position];
  const settings=(await read(`workspace_settings?workspace_id=eq.${workspace}&select=retrieval_top_k,hybrid_search_alpha,llm_temperature&limit=1`))?.[0];
  const runtimeOptions={retrieval_top_k:persistedSetting(settings,"retrieval_top_k",{min:1,max:12,integer:true}),
    hybrid_search_alpha:persistedSetting(settings,"hybrid_search_alpha",{min:0,max:1}),llm_temperature:persistedSetting(settings,"llm_temperature",{min:0,max:1})};
  const selection=resolveSummaryDocuments(question,initial.documents,false);
  const selectedDocuments=selection.documents.map(d=>d.id), selectedVersions=selection.documents.map(d=>d.active_version_id);
  const lexical=await read(`document_chunks?workspace_id=eq.${workspace}&version_id=in.(${selectedVersions.join(",")})&select=${columns}&order=id.asc&limit=201`);
  if(lexical.length>200)throw fail("CAPACITY_REACHED","Narrow this research plan to at most 200 source chunks.");
  let userApiKey;
  const credentialMode=run.admission?.credential_mode;
  if(credentialMode==="user_byok")userApiKey=await loadUserGeminiKey(env,run.owner_id);
  else if(credentialMode!=="platform_trial")throw fail("BYOK_REQUIRED","The run has no confirmed provider admission.");
  signal.throwIfAborted();
  const hits=lexical.length?await searchChunks(env,{workspaceId:workspace,question,documentIds:selectedDocuments,versionIds:selectedVersions,
    indexGenerations:initial.versions.filter(v=>selectedVersions.includes(v.id)).map(v=>v.index_generation),
    limit:runtimeOptions.retrieval_top_k,dataClassification:"non_sensitive",actorId:run.owner_id,userApiKey,credentialMode,signal}):[];
  const ids=candidateChunkIds(hits), vector=ids.length?await read(`document_chunks?workspace_id=eq.${workspace}&id=in.(${ids.join(",")})&version_id=in.(${selectedVersions.join(",")})&select=${columns}&limit=12`):[];
  const current=await load(), generation=new Map(current.versions.map(v=>[v.id,v.index_generation]));
  const dense=await rehydrateEvidence({workspaceId:workspace,candidates:hits,chunks:vector,...current});
  const sparse=await rehydrateEvidence({workspaceId:workspace,candidates:lexical.map(row=>({id:row.id,payload:{chunk_id:row.id,workspace_id:workspace,
    document_id:row.document_id,version_id:row.version_id,index_generation:generation.get(row.version_id)}})),chunks:lexical,...current});
  const fused=hybridFuse(question,dense,sparse.map(hit=>({id:hit.id,...hit.payload,metadata:{filename:hit.payload.filename,
    workspace_id:workspace,index_generation:hit.payload.index_generation,original_content_hash:hit.payload.original_content_hash,location:hit.payload.location}})),runtimeOptions.retrieval_top_k,runtimeOptions.hybrid_search_alpha);
  const sources=fused.map((hit,i)=>({citation_id:`S${i+1}`,document_id:hit.payload.document_id,version_id:hit.payload.version_id,
    chunk_id:hit.payload.chunk_id,filename:hit.payload.filename,content:hit.payload.content.slice(0,2400),excerpt:hit.payload.content.length>2400,
    original_content_hash:hit.payload.original_content_hash,location:hit.payload.location,page_number:hit.payload.page_number,chunk_index:hit.payload.chunk_index}));
  let checked={answer:"The selected evidence does not provide enough information to answer reliably.",claim_state:"UNSUPPORTED",abstained:true,citations:[]}, generated=null;
  if(sources.length) {
    signal.throwIfAborted();
    generated=await generateAnswer(env,groundedPrompt(question,fused),{workspaceId:workspace,priority:"interactive",dataClassification:"non_sensitive",
      actorId:run.owner_id,userApiKey,credentialMode,signal,requireComplete:true,temperature:runtimeOptions.llm_temperature});
    checked=assessAnswer(generated.answer,sources);
  }
  await load();
  signal.throwIfAborted();
  return {question,answer:checked.answer,claim_state:checked.claim_state,abstained:checked.abstained,sources,
    validated_citation_ids:checked.citations.map(index=>`S${index}`),model:generated?.model||null,usage:generated?.usage||{},
    selection:{reason:selection.reason,document_ids:selectedDocuments},coverage:{chunks_considered:lexical.length,
      retrieval:"BOUNDED_DENSE_LEXICAL",completeness:"NOT_EXHAUSTIVE",evidence_authority:"SUPABASE_HASH_VERIFIED"},
    runtime_options:runtimeOptions,provider_cost_status:generated?"UNKNOWN":"NOT_CALLED",paid_fallback:false,review_state:"COMPLETION_CRITERIA_NOT_AUTOMATICALLY_VERIFIED"};
}

export async function processResearchMessage(env,message,db) {
  if(!uuid.test(message?.run_id||"")||!uuid.test(message?.workspace_id||"")||!Number.isSafeInteger(message.generation)||message.generation<1
    ||!Number.isSafeInteger(message.position)||message.position<0||message.position>4)throw fail("INVALID_SCOPE","Invalid research delivery.");
  const rows=await db(env,`research_runs?id=eq.${message.run_id}&workspace_id=eq.${message.workspace_id}&select=*&limit=1`), record=rows?.[0];
  if(!record||!uuid.test(record.owner_id||""))return;
  const args={env,workspace:record.workspace_id,user:{id:record.owner_id},serviceRequest:(_env,path,init)=>db(env,path,init)};
  const step=async(operation,extra={})=>db(env,"rpc/nexus_research_step",{method:"POST",body:JSON.stringify({
    p_context:await workbenchContext(args),p_operation:operation,p_id:record.id,p_generation:message.generation,p_position:message.position,...extra})});
  const claimed=await step("claim");
  if(claimed?.claimed!==true)return;
  const run=claimed.run,token=claimed.token;
  if(!uuid.test(token||"")||run?.id!==record.id||run.generation!==message.generation||run.position!==message.position||run.source_state!=="CURRENT"
    ||!Array.isArray(run.source_snapshot)||!run.source_snapshot.length||!Array.isArray(run.questions)||!run.questions[run.position])
    throw fail("PERSISTENCE_UNCONFIRMED","Run claim was not confirmed.");
  try {
    const remaining=Date.parse(run.deadline)-Date.now();
    if(!Number.isFinite(remaining)||remaining<=0)throw fail("RUN_DEADLINE","The run deadline elapsed.");
    const signal=AbortSignal.timeout(Math.min(90000,Math.ceil(remaining)));
    const result=await answerQuestion(env,run,db,signal);
    const saved=await step("commit",{p_token:token,p_result:result});
    if(saved?.run?.id!==run.id||saved.run.position!==run.position+1)
      throw fail("PERSISTENCE_UNCONFIRMED","The answer was not confirmed; refresh before resuming.");
    if(saved.run.state==="queued")await env.INGESTION_QUEUE.send(researchMessage(saved.run));
    return saved.run;
  } catch(error) {
    const code=/^[A-Z_]{1,64}$/.test(error.code||"")?error.code:error.name==="TimeoutError"?"RUN_DEADLINE":"EXECUTION_UNCONFIRMED";
    await step("interrupt",{p_token:token,p_error:code});
    // The run owns the durable failure. Never automatically repeat a provider call.
    return null;
  }
}

export async function sweepResearchRuns(env,db) {
  const rows=await db(env,`research_runs?state=eq.queued&deadline=gt.${encodeURIComponent(new Date().toISOString())}&select=id,workspace_id,generation,position&order=updated_at.asc&limit=25`);
  for(const row of rows||[])await env.INGESTION_QUEUE.send(researchMessage(row));
  return rows?.length||0;
}
