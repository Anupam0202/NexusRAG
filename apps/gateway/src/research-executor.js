import { workbenchContext } from "./workbench.js";
import { researchMessage } from "./research-runs.js";
import { candidateChunkIds, rehydrateEvidence } from "./retrieval-authority.js";
import { resolveSummaryDocuments } from "./document-summary-scope.js";
import { generateAnswer, groundedPrompt, searchChunkVariants } from "./worker-pipeline.js";
import { queryVariantPrompt,queryVariants,fuseQueryVariants } from "./research-query-retrieval.js";
import { assessAnswer } from "./answer-evidence.js";
import { loadUserGeminiKey } from "./user-gemini-key.js";
import { persistedSetting } from "./runtime-options.js";
import { comparisonWork, sourceBatchWork, comparisonPrompt, comparisonResult } from "./research-comparison.js";
import { timelinePrompt, timelineResult } from "./research-timeline.js";
import { contradictionWork, contradictionPrompt, contradictionResult } from "./research-contradiction.js";
import { deepWork, deepSources, deepPrompt, deepResult } from "./research-deep.js";
import { obligationWork, obligationPrompt, obligationResult } from "./research-obligations.js";
import { entityWork,entityPrompt,entityResult } from "./research-entities.js";
import { diligenceWork,diligencePrompt,diligenceResult } from "./research-diligence.js";
import { passportWork,passportPrompt,passportResult } from "./research-passport.js";
import { procurementWork,procurementPrompt,procurementResult } from "./research-procurement.js";

const uuid=/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const fail=(code,message)=>Object.assign(new Error(message),{code});
const columns="id,workspace_id,document_id,version_id,chunk_index,page_number,content,original_text,original_content_hash,location,metadata";
async function answerQuestion(env,run,db,signal,context) {
  const read=path=>db(env,path,{signal}), workspace=run.workspace_id;
  const comparing=run.mode==="COMPARE",timelining=run.mode==="TIMELINE",contradicting=run.mode==="CONTRADICTION_ANALYSIS",deepening=run.mode==="DEEP_RESEARCH",obligating=run.mode==="OBLIGATION_ANALYSIS",investigating=run.mode==="ENTITY_INVESTIGATION",diligence=run.mode==="DUE_DILIGENCE",passport=run.mode==="PRODUCT_PASSPORT",procurement=run.mode==="PROCUREMENT_RESEARCH",batched=comparing||timelining,scoped=batched||contradicting||obligating||investigating||diligence||passport||procurement;
  const work=comparing?comparisonWork(run):timelining?sourceBatchWork(run):contradicting?contradictionWork(run):deepening?deepWork(run):obligating?obligationWork(run):investigating?entityWork(run):diligence?diligenceWork(run):passport?passportWork(run):procurement?procurementWork(run):null;
  const scope=work?.snapshot||run.source_snapshot;
  const sourceLimit=scoped||deepening?scope.length:20;
  const documentIds=scope.map(item=>item.document_id), versionIds=scope.map(item=>item.version_id);
  const load=async()=>{
    const documents=await read(`documents?workspace_id=eq.${workspace}&id=in.(${documentIds.join(",")})&lifecycle_state=eq.active&select=id,workspace_id,active_version_id,lifecycle_state,filename,content_type&limit=${sourceLimit}`);
    const versions=await read(`document_versions?workspace_id=eq.${workspace}&id=in.(${versionIds.join(",")})&publication_state=eq.ready&data_classification=eq.non_sensitive&select=id,workspace_id,document_id,publication_state,data_classification,index_generation,lifecycle_epoch&limit=${sourceLimit}`);
    if(scope.some(s=>!documents.some(d=>d.id===s.document_id&&d.active_version_id===s.version_id)
      || !versions.some(v=>v.id===s.version_id&&v.document_id===s.document_id&&v.index_generation===s.index_generation&&v.lifecycle_epoch===s.lifecycle_epoch)))
      throw fail("SOURCE_UNAVAILABLE","The selected evidence changed.");
    return {documents,versions};
  };
  const initial=await load(), question=work?.question||run.questions[run.position];
  const settings=(await read(`workspace_settings?workspace_id=eq.${workspace}&select=retrieval_top_k,hybrid_search_alpha,llm_temperature&limit=1`))?.[0];
  const runtimeOptions={retrieval_top_k:persistedSetting(settings,"retrieval_top_k",{min:1,max:12,integer:true}),
    hybrid_search_alpha:persistedSetting(settings,"hybrid_search_alpha",{min:0,max:1}),llm_temperature:persistedSetting(settings,"llm_temperature",{min:0,max:1})};
  const selection=scoped||deepening?{documents:scope.map(s=>initial.documents.find(d=>d.id===s.document_id)),reason:comparing?"COMPARISON_ALL_BATCH_DOCUMENTS":timelining?"TIMELINE_ALL_BATCH_DOCUMENTS":deepening?"DEEP_RESEARCH_ALL_DOCUMENTS":obligating?"OBLIGATION_ALL_DOCUMENTS":investigating?"ENTITY_ALL_DOCUMENTS":diligence?"DILIGENCE_ALL_DOCUMENTS":passport?"PASSPORT_ALL_DOCUMENTS":procurement?"PROCUREMENT_ALL_DOCUMENTS":"CONTRADICTION_ALL_DOCUMENTS"}:resolveSummaryDocuments(question,initial.documents,false);
  const selectedDocuments=selection.documents.map(d=>d.id), selectedVersions=selection.documents.map(d=>d.active_version_id);
  let candidates;
  try {candidates=await db(env,"rpc/nexus_research_candidates",{method:"POST",signal,body:JSON.stringify({p_context:context,p_id:run.id,
    p_generation:run.generation,p_position:run.position,p_document_ids:selectedDocuments})});}
  catch(error) {if(["PGRST202","42883"].includes(error.storageCode))throw fail("MIGRATION_REQUIRED","Research retrieval requires the reviewed research_query_retrieval migration.");throw error;}
  if(candidates?.schema_version!=="research-candidates/1"||candidates.run_id!==run.id||candidates.generation!==run.generation||candidates.position!==run.position
    ||!Array.isArray(candidates.items)||candidates.items.length>200||!Number.isSafeInteger(candidates.lexical_rows_read)||candidates.lexical_rows_read<0||candidates.lexical_rows_read>201
    ||typeof candidates.lexical_limit_reached!=="boolean")throw fail("PERSISTENCE_UNCONFIRMED","The bounded candidate read was not confirmed.");
  const lexicalRows=candidates.items,lexicalLimited=candidates.lexical_limit_reached;
  let userApiKey;
  const credentialMode=run.admission?.credential_mode;
  if(credentialMode==="user_byok")userApiKey=await loadUserGeminiKey(env,run.owner_id);
  else if(credentialMode!=="platform_trial")throw fail("BYOK_REQUIRED","The run has no confirmed provider admission.");
  signal.throwIfAborted();
  const providerContext={workspaceId:workspace,priority:"interactive",dataClassification:"non_sensitive",actorId:run.owner_id,userApiKey,credentialMode,signal};
  const expansion=lexicalRows.length?await generateAnswer(env,queryVariantPrompt(question,run.mode||"QUICK_LOOKUP",investigating||diligence?work.targets:[],passport?work.subject:undefined),{...providerContext,requireComplete:true,temperature:0}):null;
  const queryRetrieval=expansion?queryVariants(question,run.mode||"QUICK_LOOKUP",expansion):null;
  const queries=queryRetrieval?.queries||[question];
  const hitLists=lexicalRows.length?await searchChunkVariants(env,{workspaceId:workspace,queries,documentIds:selectedDocuments,versionIds:selectedVersions,
    indexGenerations:initial.versions.filter(v=>selectedVersions.includes(v.id)).map(v=>v.index_generation),
    limit:runtimeOptions.retrieval_top_k,...providerContext}):[];
  if(queryRetrieval)queryRetrieval.completed_queries=hitLists.length;
  const ids=[...new Set(hitLists.flatMap(list=>candidateChunkIds(list)))];
  const vector=ids.length?await read(`document_chunks?workspace_id=eq.${workspace}&id=in.(${ids.join(",")})&version_id=in.(${selectedVersions.join(",")})&select=${columns}&limit=${Math.max(12,ids.length)}`):[];
  // Keep later dense hits without expanding the unique original-candidate budget.
  // The extra lexical row detects truncation; it is not a whole-document failure.
  const seenDocuments=new Set(),firstByDocument=scoped?lexicalRows.filter(row=>!seenDocuments.has(row.document_id)&&seenDocuments.add(row.document_id)):[];
  const seenChunks=new Set(),lexical=[...firstByDocument,...vector,...lexicalRows].filter(row=>!seenChunks.has(row.id)&&seenChunks.add(row.id)).slice(0,200);
  const current=await load(), generation=new Map(current.versions.map(v=>[v.id,v.index_generation]));
  const denseLists=[];
  for(const candidates of hitLists)denseLists.push(await rehydrateEvidence({workspaceId:workspace,candidates,chunks:vector,...current}));
  const sparse=await rehydrateEvidence({workspaceId:workspace,candidates:lexical.map(row=>({id:row.id,payload:{chunk_id:row.id,workspace_id:workspace,
    document_id:row.document_id,version_id:row.version_id,index_generation:generation.get(row.version_id)}})),chunks:lexical,...current});
  const sparseRows=sparse.map(hit=>({id:hit.id,...hit.payload,metadata:{filename:hit.payload.filename,
    workspace_id:workspace,index_generation:hit.payload.index_generation,original_content_hash:hit.payload.original_content_hash,location:hit.payload.location}}));
  const fuse=(ds,ss,limit)=>fuseQueryVariants(queries,ds,ss,limit,runtimeOptions.hybrid_search_alpha);
  // Comparisons reserve a context slot for each document rather than allowing a
  // globally high-ranked source to occupy every cell's evidence budget.
  const fused=scoped?selectedDocuments.flatMap(id=>{
    const ranked=fuse(denseLists.map(list=>list.filter(hit=>hit.payload.document_id===id)),sparseRows.filter(hit=>hit.document_id===id),1);
    // An overview request need not repeat literal event wording. Its explicit
    // document scope still permits one current, hash-verified source excerpt.
    return ranked.length||!(timelining||contradicting||obligating||investigating||diligence||passport||procurement)?ranked:sparse.filter(hit=>hit.payload.document_id===id).slice(0,1);
  })
    :fuse(denseLists,sparseRows,runtimeOptions.retrieval_top_k);
  // Durable receipts keep storage metadata, not retrieval's page0 display sentinel.
  const originals=new Map([...lexical,...vector].map(row=>[row.id,row]));
  const sourceFrom=(hit,i)=>{
    const original=originals.get(hit.payload.chunk_id);
    if(!original)throw fail("SOURCE_UNAVAILABLE","The original research locator is unavailable.");
    return {citation_id:`S${i+1}`,document_id:hit.payload.document_id,version_id:hit.payload.version_id,
    chunk_id:hit.payload.chunk_id,filename:hit.payload.filename,content:scoped||deepening?Array.from(hit.payload.content).slice(0,1200).join(""):hit.payload.content.slice(0,2400),
    excerpt:scoped||deepening?Array.from(hit.payload.content).length>1200:hit.payload.content.length>2400,
    original_content_hash:hit.payload.original_content_hash,location:hit.payload.location,page_number:original.page_number??null,chunk_index:hit.payload.chunk_index};
  };
  let sources=fused.map(sourceFrom),priorSources=[];
  if(deepening&&work.phase==="SYNTHESIS"&&work.prior_results.length) {
    let receipt;
    try {receipt=await db(env,"rpc/nexus_research_deep_context",{method:"POST",signal,body:JSON.stringify({p_context:context,p_id:run.id,
      p_generation:run.generation,p_position:run.position})});}
    catch(error){if(["PGRST202","42883"].includes(error.storageCode))throw fail("MIGRATION_REQUIRED","Deep Research synthesis requires the reviewed research_deep_execution migration.");throw error;}
    if(receipt?.schema_version!=="research-deep-context/1"||receipt.run_id!==run.id||receipt.generation!==run.generation||receipt.position!==run.position
      ||!Array.isArray(receipt.items)||receipt.items.length>144)throw fail("PERSISTENCE_UNCONFIRMED","Prior research originals were not confirmed.");
    const expected=new Map(work.prior_results.flatMap(result=>result.sources).map(source=>[source.chunk_id,source]));
    const candidates=receipt.items.map(row=>({id:row.id,payload:{chunk_id:row.id,workspace_id:workspace,
      document_id:row.document_id,version_id:row.version_id,index_generation:generation.get(row.version_id)}}));
    const hydrated=await rehydrateEvidence({workspaceId:workspace,candidates,chunks:receipt.items,...current});
    for(const row of receipt.items)originals.set(row.id,row);
    priorSources=hydrated.map(sourceFrom);
    if(priorSources.length!==expected.size||priorSources.some(source=>{
      const original=expected.get(source.chunk_id);
      return !original||source.document_id!==original.document_id||source.version_id!==original.version_id||source.original_content_hash!==original.original_content_hash;
    }))throw fail("SOURCE_UNAVAILABLE","A prior research original changed or is unavailable.");
  }
  if(deepening)sources=deepSources(sources,priorSources);
  let checked={answer:"The selected evidence does not provide enough information to answer reliably.",claim_state:"UNSUPPORTED",abstained:true,citations:[]}, generated=null;
  if(sources.length) {
    signal.throwIfAborted();
    generated=await generateAnswer(env,comparing?comparisonPrompt(work,selection.documents,sources):timelining?timelinePrompt(work,selection.documents,sources):contradicting?contradictionPrompt(work,selection.documents,sources):deepening?deepPrompt(work,sources):obligating?obligationPrompt(work,selection.documents,sources):investigating?entityPrompt(work,selection.documents,sources):diligence?diligencePrompt(work,selection.documents,sources):passport?passportPrompt(work,selection.documents,sources):procurement?procurementPrompt(work,selection.documents,sources):groundedPrompt(question,fused),{workspaceId:workspace,priority:"interactive",dataClassification:"non_sensitive",
      actorId:run.owner_id,userApiKey,credentialMode,signal,requireComplete:true,temperature:runtimeOptions.llm_temperature,
      ...(scoped||deepening?{outputTokens:4096}:{})});
    if(!scoped&&!deepening)checked=assessAnswer(generated.answer,sources);
  }
  const comparison=comparing?comparisonResult(work,selection.documents,sources,generated):null;
  const timeline=timelining?timelineResult(work,selection.documents,sources,generated):null;
  const contradiction=contradicting?contradictionResult(work,selection.documents,sources,generated):null;
  const deep=deepening?deepResult(work,selection.documents,sources,[...sparse.map(sourceFrom),...priorSources],generated):null;
  const obligations=obligating?obligationResult(work,selection.documents,sources,generated):null;
  const entities=investigating?entityResult(work,selection.documents,sources,generated):null;
  const diligenceAnalysis=diligence?diligenceResult(work,selection.documents,sources,generated):null;
  const passportAnalysis=passport?passportResult(work,selection.documents,sources,generated):null;
  const procurementAnalysis=procurement?procurementResult(work,selection.documents,sources,generated):null;
  if(deep)checked=deep.checked;
  if(contradiction){sources=contradiction.sources;checked=contradiction.checked;}
  if(obligations){sources=obligations.sources;checked=obligations.checked;}
  if(entities){sources=entities.sources;checked=entities.checked;}
  if(diligenceAnalysis){sources=diligenceAnalysis.sources;checked=diligenceAnalysis.checked;}
  if(passportAnalysis){sources=passportAnalysis.sources;checked=passportAnalysis.checked;}
  if(procurementAnalysis){sources=procurementAnalysis.sources;checked=procurementAnalysis.checked;}
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
      retrieval:timelining||contradicting||obligating||investigating||diligence||passport||procurement?"BOUNDED_DENSE_LEXICAL_SCOPED_OVERVIEW":"BOUNDED_DENSE_LEXICAL",completeness:"NOT_EXHAUSTIVE",evidence_authority:"SUPABASE_HASH_VERIFIED"},
    ...(queryRetrieval?{query_retrieval:queryRetrieval}:{}),...(comparison?{comparison}:{}),...(timeline?{timeline}:{}),...(contradiction?{contradiction:contradiction.analysis}:{}),...(deep?{deep:deep.analysis}:{}),...(obligations?{obligations:obligations.analysis}:{}),...(entities?{entities:entities.analysis}:{}),...(diligenceAnalysis?{diligence:diligenceAnalysis.analysis}:{}),...(passportAnalysis?{passport:passportAnalysis.analysis}:{}),...(procurementAnalysis?{procurement:procurementAnalysis.analysis}:{}),runtime_options:runtimeOptions,provider_cost_status:generated||expansion?"UNKNOWN":"NOT_CALLED",paid_fallback:false,review_state:"COMPLETION_CRITERIA_NOT_AUTOMATICALLY_VERIFIED"};
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
    const result=await answerQuestion(env,run,db,signal,await workbenchContext(args));
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
