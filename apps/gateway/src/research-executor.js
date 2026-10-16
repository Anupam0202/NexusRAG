import { workbenchContext } from "./workbench.js";
import { researchMessage } from "./research-runs.js";
import { candidateChunkIds, rehydrateEvidence } from "./retrieval-authority.js";
import { resolveSummaryDocuments } from "./document-summary-scope.js";
import { hybridFuse } from "./worker-lifecycle.js";
import { generateAnswer, groundedPrompt, searchChunks } from "./worker-pipeline.js";
import { assessAnswer } from "./answer-evidence.js";
import { loadUserGeminiKey } from "./user-gemini-key.js";
import { persistedSetting } from "./runtime-options.js";
import { comparisonWork, sourceBatchWork, comparisonPrompt, comparisonResult } from "./research-comparison.js";
import { timelinePrompt, timelineResult } from "./research-timeline.js";

const uuid=/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const fail=(code,message)=>Object.assign(new Error(message),{code});
const columns="id,workspace_id,document_id,version_id,chunk_index,page_number,content,original_text,original_content_hash,location,metadata";
async function answerQuestion(env,run,db,signal) {
  const read=path=>db(env,path,{signal}), workspace=run.workspace_id;
  const comparing=run.mode==="COMPARE",timelining=run.mode==="TIMELINE",batched=comparing||timelining;
  const work=comparing?comparisonWork(run):timelining?sourceBatchWork(run):null;
  const scope=work?.snapshot||run.source_snapshot;
  const documentIds=scope.map(item=>item.document_id), versionIds=scope.map(item=>item.version_id);
  const load=async()=>{
    const documents=await read(`documents?workspace_id=eq.${workspace}&id=in.(${documentIds.join(",")})&lifecycle_state=eq.active&select=id,workspace_id,active_version_id,lifecycle_state,filename,content_type&limit=20`);
    const versions=await read(`document_versions?workspace_id=eq.${workspace}&id=in.(${versionIds.join(",")})&publication_state=eq.ready&data_classification=eq.non_sensitive&select=id,workspace_id,document_id,publication_state,data_classification,index_generation,lifecycle_epoch&limit=20`);
    if(scope.some(s=>!documents.some(d=>d.id===s.document_id&&d.active_version_id===s.version_id)
      || !versions.some(v=>v.id===s.version_id&&v.document_id===s.document_id&&v.index_generation===s.index_generation&&v.lifecycle_epoch===s.lifecycle_epoch)))
      throw fail("SOURCE_UNAVAILABLE","The selected evidence changed.");
    return {documents,versions};
  };
  const initial=await load(), question=work?.question||run.questions[run.position];
  const settings=(await read(`workspace_settings?workspace_id=eq.${workspace}&select=retrieval_top_k,hybrid_search_alpha,llm_temperature&limit=1`))?.[0];
  const runtimeOptions={retrieval_top_k:persistedSetting(settings,"retrieval_top_k",{min:1,max:12,integer:true}),
    hybrid_search_alpha:persistedSetting(settings,"hybrid_search_alpha",{min:0,max:1}),llm_temperature:persistedSetting(settings,"llm_temperature",{min:0,max:1})};
  const selection=batched?{documents:scope.map(s=>initial.documents.find(d=>d.id===s.document_id)),reason:comparing?"COMPARISON_ALL_BATCH_DOCUMENTS":"TIMELINE_ALL_BATCH_DOCUMENTS"}:resolveSummaryDocuments(question,initial.documents,false);
  const selectedDocuments=selection.documents.map(d=>d.id), selectedVersions=selection.documents.map(d=>d.active_version_id);
  const lexicalRows=await read(`document_chunks?workspace_id=eq.${workspace}&version_id=in.(${selectedVersions.join(",")})&select=${columns}&order=id.asc&limit=201`);
  const lexicalLimited=lexicalRows.length>200;
  let userApiKey;
  const credentialMode=run.admission?.credential_mode;
  if(credentialMode==="user_byok")userApiKey=await loadUserGeminiKey(env,run.owner_id);
  else if(credentialMode!=="platform_trial")throw fail("BYOK_REQUIRED","The run has no confirmed provider admission.");
  signal.throwIfAborted();
  const hits=lexicalRows.length?await searchChunks(env,{workspaceId:workspace,question,documentIds:selectedDocuments,versionIds:selectedVersions,
    indexGenerations:initial.versions.filter(v=>selectedVersions.includes(v.id)).map(v=>v.index_generation),
    limit:runtimeOptions.retrieval_top_k,dataClassification:"non_sensitive",actorId:run.owner_id,userApiKey,credentialMode,signal}):[];
  const ids=candidateChunkIds(hits), vector=ids.length?await read(`document_chunks?workspace_id=eq.${workspace}&id=in.(${ids.join(",")})&version_id=in.(${selectedVersions.join(",")})&select=${columns}&limit=12`):[];
  // Keep later dense hits without expanding the unique original-candidate budget.
  // The extra lexical row detects truncation; it is not a whole-document failure.
  const lexical=[...new Map([...vector,...lexicalRows].map(row=>[row.id,row])).values()].slice(0,200);
  const current=await load(), generation=new Map(current.versions.map(v=>[v.id,v.index_generation]));
  const dense=await rehydrateEvidence({workspaceId:workspace,candidates:hits,chunks:vector,...current});
  const sparse=await rehydrateEvidence({workspaceId:workspace,candidates:lexical.map(row=>({id:row.id,payload:{chunk_id:row.id,workspace_id:workspace,
    document_id:row.document_id,version_id:row.version_id,index_generation:generation.get(row.version_id)}})),chunks:lexical,...current});
  const sparseRows=sparse.map(hit=>({id:hit.id,...hit.payload,metadata:{filename:hit.payload.filename,
    workspace_id:workspace,index_generation:hit.payload.index_generation,original_content_hash:hit.payload.original_content_hash,location:hit.payload.location}}));
  const fuse=(ds,ss,limit)=>hybridFuse(question,ds,ss,limit,runtimeOptions.hybrid_search_alpha);
  // Comparisons reserve a context slot for each document rather than allowing a
  // globally high-ranked source to occupy every cell's evidence budget.
  const fused=batched?selectedDocuments.flatMap(id=>{
    const ranked=fuse(dense.filter(hit=>hit.payload.document_id===id),sparseRows.filter(hit=>hit.document_id===id),1);
    // An overview request need not repeat literal event wording. Its explicit
    // document scope still permits one current, hash-verified source excerpt.
    return ranked.length||!timelining?ranked:sparse.filter(hit=>hit.payload.document_id===id).slice(0,1);
  })
    :fuse(dense,sparseRows,runtimeOptions.retrieval_top_k);
  const sources=fused.map((hit,i)=>({citation_id:`S${i+1}`,document_id:hit.payload.document_id,version_id:hit.payload.version_id,
    chunk_id:hit.payload.chunk_id,filename:hit.payload.filename,content:batched?Array.from(hit.payload.content).slice(0,1200).join(""):hit.payload.content.slice(0,2400),
    excerpt:batched?Array.from(hit.payload.content).length>1200:hit.payload.content.length>2400,
    original_content_hash:hit.payload.original_content_hash,location:hit.payload.location,page_number:hit.payload.page_number,chunk_index:hit.payload.chunk_index}));
  let checked={answer:"The selected evidence does not provide enough information to answer reliably.",claim_state:"UNSUPPORTED",abstained:true,citations:[]}, generated=null;
  if(sources.length) {
    signal.throwIfAborted();
    generated=await generateAnswer(env,comparing?comparisonPrompt(work,selection.documents,sources):timelining?timelinePrompt(work,selection.documents,sources):groundedPrompt(question,fused),{workspaceId:workspace,priority:"interactive",dataClassification:"non_sensitive",
      actorId:run.owner_id,userApiKey,credentialMode,signal,requireComplete:true,temperature:runtimeOptions.llm_temperature,
      ...(batched?{outputTokens:4096}:{})});
    if(!batched)checked=assessAnswer(generated.answer,sources);
  }
  const comparison=comparing?comparisonResult(work,selection.documents,sources,generated):null;
  const timeline=timelining?timelineResult(work,selection.documents,sources,generated):null;
  if(timeline)checked={answer:timeline.events.length?timeline.events.map(event=>`${event.date_text||"Undated"} (${event.date_role}): ${event.quote} [${event.citation_id}]`).join("\n"):"No source-anchored events were returned from the bounded retrieved evidence.",
    claim_state:timeline.events.length?"REVIEW_REQUIRED":"UNSUPPORTED",abstained:!timeline.events.length,
    citations:[...new Set(timeline.events.map(event=>Number(event.citation_id.slice(1))))]};
  if(comparison) {
    const valid=comparison.cells.filter(cell=>!cell.abstained);
    checked={answer:comparison.cells.map(cell=>`${cell.document_id}: ${cell.answer}`).join("\n"),
      claim_state:valid.length?"REVIEW_REQUIRED":"UNSUPPORTED",abstained:!valid.length,
      citations:[...new Set(valid.flatMap(cell=>cell.validated_citation_ids.map(id=>Number(id.slice(1)))))]};
  }
  await load();
  signal.throwIfAborted();
  return {question,answer:checked.answer,claim_state:checked.claim_state,abstained:checked.abstained,sources,
    validated_citation_ids:checked.citations.map(index=>`S${index}`),model:generated?.model||null,usage:generated?.usage||{},
    selection:{reason:selection.reason,document_ids:selectedDocuments},coverage:{chunks_considered:lexical.length,lexical_limit_reached:lexicalLimited,
      retrieval:timelining?"BOUNDED_DENSE_LEXICAL_SCOPED_OVERVIEW":"BOUNDED_DENSE_LEXICAL",completeness:"NOT_EXHAUSTIVE",evidence_authority:"SUPABASE_HASH_VERIFIED"},
    ...(comparison?{comparison}:{}),...(timeline?{timeline}:{}),runtime_options:runtimeOptions,provider_cost_status:generated?"UNKNOWN":"NOT_CALLED",paid_fallback:false,review_state:"COMPLETION_CRITERIA_NOT_AUTOMATICALLY_VERIFIED"};
}

export async function processResearchMessage(env,message,db) {
  if(!uuid.test(message?.run_id||"")||!uuid.test(message?.workspace_id||"")||!Number.isSafeInteger(message.generation)||message.generation<1
    ||!Number.isSafeInteger(message.position)||message.position<0||message.position>44)throw fail("INVALID_SCOPE","Invalid research delivery.");
  const rows=await db(env,`research_runs?id=eq.${message.run_id}&workspace_id=eq.${message.workspace_id}&select=*&limit=1`), record=rows?.[0];
  if(!record||!uuid.test(record.owner_id||""))return;
  const args={env,workspace:record.workspace_id,user:{id:record.owner_id},serviceRequest:(_env,path,init)=>db(env,path,init)};
  const step=async(operation,extra={})=>db(env,"rpc/nexus_research_step",{method:"POST",body:JSON.stringify({
    p_context:await workbenchContext(args),p_operation:operation,p_id:record.id,p_generation:message.generation,p_position:message.position,...extra})});
  const claimed=await step("claim");
  if(claimed?.claimed!==true)return;
  const run=claimed.run,token=claimed.token;
  if(!uuid.test(token||"")||run?.id!==record.id||run.generation!==message.generation||run.position!==message.position||run.source_state!=="CURRENT"
    ||!Array.isArray(run.source_snapshot)||!run.source_snapshot.length||!Array.isArray(run.questions)||!run.questions[["COMPARE","TIMELINE"].includes(run.mode)?Math.floor(run.position/Math.ceil(run.source_snapshot.length/8)):run.position])
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
