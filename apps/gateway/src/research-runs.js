import { readBoundedJsonObject } from "./request-body.js";
import { workbenchContext } from "./workbench.js";
import { confirmedPassportSubject } from "./research-passport.js";

const uuid=/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const states=new Set(["queued","running","interrupted","completed","cancelled"]);
const problem=(code,message,status=422)=>Object.assign(new Error(message),{code,status});
export const researchMessage = run => ({kind:"research",run_id:run.id,workspace_id:run.workspace_id,generation:run.generation,position:run.position});
export function confirmedRun(row,{workspace,user},plan) {
  const comparing=row?.mode==="COMPARE",contradicting=row?.mode==="CONTRADICTION_ANALYSIS",deepening=row?.mode==="DEEP_RESEARCH",obligating=row?.mode==="OBLIGATION_ANALYSIS",investigating=row?.mode==="ENTITY_INVESTIGATION",diligence=row?.mode==="DUE_DILIGENCE",passport=row?.mode==="PRODUCT_PASSPORT",batched=comparing||row?.mode==="TIMELINE",count=batched||contradicting||deepening||obligating||investigating||diligence||passport?row.source_snapshot?.length:0;
  const total=batched&&count>=(comparing?2:1)&&count<=40?row.questions?.length*Math.ceil(count/8):row?.questions?.length;
  return Boolean(row && uuid.test(row.id||"") && row.plan_id===plan && row.workspace_id===workspace && row.owner_id===user.id
    && row.schema_version==="research-run/1" && row.persistence_state==="PERSISTED" && states.has(row.state)
    && Number.isSafeInteger(row.generation) && row.generation>=1 && row.generation<=10
    && Number.isSafeInteger(row.position) && row.position>=0 && Array.isArray(row.questions) && row.questions.length>=1 && row.questions.length<=(deepening||diligence||passport?13:contradicting||obligating||investigating?11:batched?9:5)
    && (!batched||count>=(comparing?2:1)&&count<=40&&row.total_steps===total)
    && (!contradicting||Array.isArray(row.source_snapshot)&&count>=1&&count<=50&&row.total_steps===total)
    && (!obligating||Array.isArray(row.source_snapshot)&&count>=1&&count<=50&&row.total_steps===total)
    && (!(investigating||diligence)||Array.isArray(row.source_snapshot)&&count>=1&&count<=(diligence?60:50)&&row.total_steps===total&&Array.isArray(row.entity_scope)
      &&row.entity_scope.length<=100&&row.entity_scope.every(value=>typeof value==="string"&&value.trim()&&Array.from(value).length<=128))
    && (!deepening||Array.isArray(row.source_snapshot)&&count>=1&&count<=60&&row.total_steps===total)
    && (!passport||Array.isArray(row.source_snapshot)&&count>=1&&count<=60&&row.total_steps===total&&confirmedPassportSubject(row.passport_subject))
    && row.questions.every(q=>typeof q==="string" && q.length>0 && Array.from(q).length<=10000) && row.position<=total
    && Array.isArray(row.results) && ["CURRENT","UNAVAILABLE_OR_CHANGED"].includes(row.source_state)
    && (row.results_included===false?(batched||contradicting||deepening||obligating||investigating||diligence||passport)&&row.results.length===0:row.source_state!=="CURRENT" || row.results.length===row.position)
    && (row.state!=="completed" || row.position===total));
}
export async function handleResearchRuns(args) {
  const {request,env,member,serviceRequest,json}=args, url=new URL(request.url);
  const match=url.pathname.match(/^\/api\/v2\/research\/plans\/([0-9a-f-]{36})\/runs(?:\/([0-9a-f-]{36})(?:\/(cancel|resume))?)?$/i);
  if(!match)return null;
  const [,rawPlan,rawRun,action]=match,plan=rawPlan.toLowerCase(),run=rawRun?.toLowerCase();
  if(!uuid.test(plan)||(run&&!uuid.test(run)))throw problem("INVALID_SCOPE","Choose a valid research plan and run.");
  const reading=["GET","HEAD"].includes(request.method);
  if(!(reading&&!action || request.method==="POST"&&(!run||action)))throw problem("METHOD_NOT_ALLOWED","Use create, list, read, cancel or resume.",405);
  if(!reading&&!["editor","admin","owner"].includes(member.role))throw problem("FORBIDDEN","Running research requires editor access.",403);
  const operation=reading?(run?"read":"list"):action||"create";
  const command=reading?{}:await readBoundedJsonObject(request);
  if(["create","resume"].includes(operation)&&command.non_sensitive_attested!==true)
    throw problem("RIGHTS_BLOCKED","Confirm that these selected documents and all questions contain only non-sensitive information.",403);
  const key=operation==="create"?request.headers.get("idempotency-key"):null;
  if(operation==="create"&&(!key||key.length>128))throw problem("INVALID_SCOPE","A stable Idempotency-Key is required.");
  if(["create","resume"].includes(operation)&&!env.INGESTION_QUEUE?.send)throw problem("CONFIGURATION_ERROR","The research queue is not configured.",503);
  const limit=Number(url.searchParams.get("limit")||20), after=url.searchParams.get("after");
  if(!Number.isInteger(limit)||limit<1||limit>50||after&&!uuid.test(after))throw problem("INVALID_SCOPE","Choose a valid research run page.");
  let result;
  try {
    if(["create","resume"].includes(operation)&&command.execution_mode==="PRODUCT_PASSPORT") {
      const contract=await serviceRequest(env,"rpc/nexus_research_passport_contract",{method:"POST",body:"{}"});
      if(contract?.schema_version!=="research-passport/1"||contract.max_sources!==60||contract.max_subquestions!==12||contract.max_steps!==13
        ||contract.max_query_variants!==8||contract.runtime_seconds!==600||contract.max_claims!==12||contract.max_result_bytes!==1000000||contract.max_run_bytes!==13001000)
        throw problem("MIGRATION_REQUIRED","Product Passport requires the reviewed research_passport_execution migration.",503);
    }
    if(["create","resume"].includes(operation)&&command.execution_mode==="DUE_DILIGENCE") {
      const contract=await serviceRequest(env,"rpc/nexus_research_diligence_contract",{method:"POST",body:"{}"});
      if(contract?.schema_version!=="research-diligence/1"||contract.max_sources!==60||contract.max_subquestions!==12||contract.max_steps!==13
        ||contract.max_query_variants!==8||contract.runtime_seconds!==600||contract.max_observations!==12||contract.max_result_bytes!==1000000||contract.max_run_bytes!==13001000)
        throw problem("MIGRATION_REQUIRED","Due Diligence requires the reviewed research_diligence_execution migration.",503);
    }
    if(["create","resume"].includes(operation)&&command.execution_mode==="ENTITY_INVESTIGATION") {
      const contract=await serviceRequest(env,"rpc/nexus_research_entity_contract",{method:"POST",body:"{}"});
      if(contract?.schema_version!=="research-entities/1"||contract.max_sources!==50||contract.max_subquestions!==10||contract.max_steps!==11
        ||contract.max_query_variants!==8||contract.runtime_seconds!==420||contract.max_candidates!==12||contract.max_result_bytes!==1000000||contract.max_run_bytes!==11000000)
        throw problem("MIGRATION_REQUIRED","Entity Investigation requires the reviewed research_entity_execution migration.",503);
    }
    if(["create","resume"].includes(operation)&&command.execution_mode==="OBLIGATION_ANALYSIS") {
      const contract=await serviceRequest(env,"rpc/nexus_research_obligation_contract",{method:"POST",body:"{}"});
      if(contract?.schema_version!=="research-obligations/1"||contract.max_sources!==50||contract.max_subquestions!==10||contract.max_steps!==11
        ||contract.max_query_variants!==8||contract.runtime_seconds!==420||contract.max_candidates!==12||contract.max_result_bytes!==1000000||contract.max_run_bytes!==11000000)
        throw problem("MIGRATION_REQUIRED","Obligation Analysis requires the reviewed research_obligation_execution migration.",503);
    }
    if(["create","resume"].includes(operation)&&command.execution_mode==="DEEP_RESEARCH") {
      const contract=await serviceRequest(env,"rpc/nexus_research_deep_contract",{method:"POST",body:"{}"});
      if(contract?.schema_version!=="research-deep/1"||contract.max_sources!==60||contract.max_subquestions!==12||contract.max_steps!==13
        ||contract.max_query_variants!==8||contract.runtime_seconds!==600||contract.max_prior_originals!==144||contract.max_synthesis_sources!==156)
        throw problem("MIGRATION_REQUIRED","Deep Research requires the reviewed research_deep_execution migration.",503);
    }
    if(["create","resume"].includes(operation)&&command.execution_mode==="COMPARE") {
      const contract=await serviceRequest(env,"rpc/nexus_research_comparison_contract",{method:"POST",body:"{}"});
      if(contract?.schema_version!=="research-comparison/1"||contract.batch_size!==8||contract.max_steps!==45)
        throw problem("MIGRATION_REQUIRED","Comparison execution requires the reviewed research_comparison_execution migration.",503);
    }
    if(["create","resume"].includes(operation)&&command.execution_mode==="TIMELINE") {
      const contract=await serviceRequest(env,"rpc/nexus_research_timeline_contract",{method:"POST",body:"{}"});
      if(contract?.schema_version!=="research-timeline/1"||contract.batch_size!==8||contract.max_steps!==45)
        throw problem("MIGRATION_REQUIRED","Timeline execution requires the reviewed research_timeline_execution migration.",503);
    }
    if(["create","resume"].includes(operation)&&command.execution_mode==="CONTRADICTION_ANALYSIS") {
      const contract=await serviceRequest(env,"rpc/nexus_research_contradiction_contract",{method:"POST",body:"{}"});
      if(contract?.schema_version!=="research-contradiction/1"||contract.max_sources!==50||contract.max_steps!==11||contract.max_pairs!==6||contract.runtime_seconds!==420)
        throw problem("MIGRATION_REQUIRED","Contradiction execution requires the reviewed research_contradiction_execution migration.",503);
    }
    if(["create","resume"].includes(operation)) {
      let contract;
      try {contract=await serviceRequest(env,"rpc/nexus_research_candidates_contract",{method:"POST",body:"{}"});}
      catch(error) {if(!["PGRST202","42883"].includes(error.storageCode))throw error;}
      if(contract?.schema_version!=="research-candidates/1"||contract.max_rows!==201||contract.max_candidates!==200||contract.max_sources!==50)
        throw problem("MIGRATION_REQUIRED","Research retrieval requires the reviewed research_query_retrieval migration.",503);
    }
    result=await serviceRequest(env,"rpc/nexus_research_run",{method:"POST",body:JSON.stringify({p_context:await workbenchContext(args),
      p_operation:operation,p_plan:plan,p_id:run||null,p_key:key,p_command:{non_sensitive_attested:command.non_sensitive_attested===true},p_limit:limit,p_after:after?.toLowerCase()||null})});
  } catch(error) {
    if(["PGRST202","42883","42P01"].includes(error.storageCode))throw problem("MIGRATION_REQUIRED",
      command.execution_mode==="PRODUCT_PASSPORT"?"Product Passport requires the reviewed research_passport_execution migration.":
      command.execution_mode==="DUE_DILIGENCE"?"Due Diligence requires the reviewed research_diligence_execution migration.":
      command.execution_mode==="ENTITY_INVESTIGATION"?"Entity Investigation requires the reviewed research_entity_execution migration.":
      command.execution_mode==="OBLIGATION_ANALYSIS"?"Obligation Analysis requires the reviewed research_obligation_execution migration.":
      command.execution_mode==="DEEP_RESEARCH"?"Deep Research requires the reviewed research_deep_execution migration.":
      command.execution_mode==="CONTRADICTION_ANALYSIS"?"Contradiction execution requires the reviewed research_contradiction_execution migration.":
        command.execution_mode==="TIMELINE"?"Timeline execution requires the reviewed research_timeline_execution migration.":
        command.execution_mode==="COMPARE"?"Comparison execution requires the reviewed research_comparison_execution migration.":"Research execution requires the reviewed research_answer_execution migration.",503);
    const messages={MODE_NOT_EXECUTABLE:"This mode has no completed execution workflow yet. The saved plan is unchanged.",
      PASSPORT_SUBJECT_REQUIRED:"This legacy draft has no declared product. Copy it to a new plan with a complete product identifier, name, version and supplier before execution.",
      COMPARISON_SCOPE_REQUIRED:"A comparison requires between 2 and 40 distinct current documents.",
      PLAN_CONSTRAINTS_UNSUPPORTED:"Execution cannot yet honor the public providers, dates, jurisdiction, entities, rights constraints or calculations in this plan. Copy it to a new plan with a supported scope.",
      SOURCE_UNAVAILABLE:"Select current, ready, non-sensitive documents. The original run scope cannot be silently replaced.",
      BYOK_REQUIRED:"Research needs an available account query allowance or a configured, consented Gemini key.",
      TENANT_QUOTA_EXCEEDED:"Research run storage is full (10 runs per plan, 100 per workspace, including at most 20 each of comparisons, timelines, contradiction analyses, Deep Research, Obligation Analysis, Entity Investigation, Due Diligence and Product Passport runs).",
      NOT_FOUND:"This research plan or run is unavailable."};
    if(messages[error.code])throw problem(error.code,messages[error.code],error.code==="NOT_FOUND"?404:error.code==="TENANT_QUOTA_EXCEEDED"?429:error.code==="BYOK_REQUIRED"?402:422);
    throw error;
  }
  if(operation==="list") {
    if(!result||!Array.isArray(result.items)||result.items.some(row=>!confirmedRun(row,args,plan))||(result.next_after!==null&&!uuid.test(result.next_after||"")))
      throw problem("PERSISTENCE_UNCONFIRMED","Research run list could not be confirmed.",503);
  } else {
    if(!confirmedRun(result,args,plan)||result.results_included===false||(run&&result.id!==run))throw problem("PERSISTENCE_UNCONFIRMED","Research run persistence could not be confirmed. Refresh before retrying.",503);
    if(["create","resume"].includes(operation)&&result.state==="queued") {
      try {await env.INGESTION_QUEUE.send(researchMessage(result));result={...result,dispatch_state:"ENQUEUED"};}
      catch {result={...result,dispatch_state:"PENDING_RECOVERY"};}
    }
  }
  return json(request,env,result,operation==="create"?201:200);
}
