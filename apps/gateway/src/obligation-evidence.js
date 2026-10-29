// Typed domain reads use SQL authority. API and MCP serving decisions are
// separate; a list never rehydrates source content or aliases generic Findings.
import {readBoundedJsonObject} from "./request-body.js";
import {workbenchContext} from "./workbench.js";
import {servingIntentHash,servingIntentSerialization} from "./serving-intent.js";

const UUID=/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i,HASH=/^[a-f0-9]{64}$/;
const actions=["SERVE_API","SERVE_MCP"],states=["READY","SOURCE_UNAVAILABLE","REVIEW_REQUIRED","RIGHTS_BLOCKED"];
const sourceStates=["CURRENT","UNAVAILABLE_OR_CHANGED"],reviewStates=["APPROVED","REVIEW_REQUIRED","CHANGES_REQUESTED"];
const rightStates=["ALLOWED","UNKNOWN","DENIED","REVIEW_REQUIRED","REVOKED","EXPIRED","HASH_MISMATCH","SOURCE_UNAVAILABLE"];
const issue=(code,message,status=422)=>Object.assign(new Error(message),{code,status});
const object=value=>value!==null&&typeof value==="object"&&!Array.isArray(value);
const text=(value,max,min=0)=>typeof value==="string"&&!value.includes("\0")&&Array.from(value).length<=max&&value.trim().length>=min;
const uuid=value=>typeof value==="string"&&UUID.test(value);
const integer=(value,min=0,max=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(value)&&value>=min&&value<=max;
const date=value=>typeof value==="string"&&Number.isFinite(Date.parse(value));
const bytes=value=>new TextEncoder().encode(value).length;
const rpc=(args,name,values)=>args.serviceRequest(args.env,`rpc/${name}`,{method:"POST",body:JSON.stringify(values)});
const same=(left,right)=>{
  if(Object.is(left,right))return true;
  if(Array.isArray(left)||Array.isArray(right))return Array.isArray(left)&&Array.isArray(right)&&left.length===right.length&&left.every((value,index)=>same(value,right[index]));
  return object(left)&&object(right)&&Object.keys(left).length===Object.keys(right).length&&Object.keys(left).every(key=>Object.hasOwn(right,key)&&same(left[key],right[key]));
};
function confirmed(value){if(!value)throw issue("PERSISTENCE_UNCONFIRMED","Obligation evidence storage did not confirm the requested state. Refresh before retrying.",503);}
function id(value){if(!uuid(value))throw issue("INVALID_SCOPE","Choose a valid Finding or page identifier.");return value.toLowerCase();}
function servingAction(value){if(!actions.includes(value))throw issue("INVALID_SCOPE","Choose API or MCP serving rights explicitly.");return value;}
function pageLimit(value){if(!integer(value,1,50))throw issue("INVALID_SCOPE","Choose a page of one to fifty records.");return value;}
function requiredRevision(value){if(!integer(value,1))throw issue("INVALID_SCOPE","The exact current Finding revision is required.");return value;}
function translate(error){
  if(["PGRST202","42883","42P01"].includes(error.storageCode))return issue("MIGRATION_REQUIRED","Obligation evidence requires the reviewed obligation_evidence_serving storage contract.",503);
  const messages={SOURCE_UNAVAILABLE:[409,"Original evidence changed or is unavailable. Retained metadata remains inspectable."],
    RIGHTS_BLOCKED:[403,"The requested serving action is withheld by current source rights."],REVIEW_REQUIRED:[409,"This exact Finding revision needs independent review."],
    VERSION_CONFLICT:[409,"The Finding or serving decision changed. Refresh before retrying."],RESOURCE_LIMIT_EXCEEDED:[413,"This request or new review metadata exceeds its documented bound."],
    NOT_FOUND:[404,"This Obligation Finding is unavailable."]};
  return messages[error.code]?issue(error.code,messages[error.code][1],messages[error.code][0]):error;
}
async function contract(args){
  try{
    const value=await rpc(args,"nexus_obligation_evidence_contract",{});
    if(value?.schema_version!=="obligation-evidence/1"||value.list_schema!=="obligation-evidence-list/1"||value.detail_schema!=="obligation-evidence-detail/1"
      ||value.rights_schema!=="finding-serving-rights/1"||!same(value.actions,actions)||value.default_limit!==20||value.max_limit!==50||value.max_sources!==50
      ||value.max_candidates!==12||value.max_criteria!==11||value.max_result_bytes!==1000000)
      throw issue("MIGRATION_REQUIRED","The versioned Obligation evidence storage contract is unavailable.",503);
    return value;
  }catch(error){throw translate(error);}
}
export async function obligationEvidenceAvailability(args){
  try{await contract(args);return {available:true,reason:null};}
  catch(error){return {available:false,reason:error.code==="MIGRATION_REQUIRED"?"MIGRATION_REQUIRED":"PERSISTENCE_UNAVAILABLE"};}
}
const summaryKeys=["finding_id","revision","run_id","result_index","created_at","updated_at","state","source_state","review_state","rights_state"];
function summary(value,after=null){
  if(!object(value)||!uuid(value.finding_id)||!integer(value.revision,1)||!uuid(value.run_id)||!integer(value.result_index,0,10)||!date(value.created_at)||!date(value.updated_at)
    ||!states.includes(value.state)||!sourceStates.includes(value.source_state)||!reviewStates.includes(value.review_state)||!["ALLOWED","RIGHTS_BLOCKED"].includes(value.rights_state))return false;
  return value.state===(value.source_state!=="CURRENT"?"SOURCE_UNAVAILABLE":value.review_state!=="APPROVED"?"REVIEW_REQUIRED":value.rights_state!=="ALLOWED"?"RIGHTS_BLOCKED":"READY")
    &&Object.keys(value).every(key=>summaryKeys.includes(key))&&(!after||value.finding_id>after);
}
const policyShape=value=>object(value)&&["ALLOW","DENY","REVIEW_REQUIRED","REVOKED"].includes(value.decision)
  &&["OWNED_CONTENT","LICENSE","PERMISSION","PUBLIC_DOMAIN","UNKNOWN"].includes(value.basis)&&text(value.rationale,2000,1)&&text(value.evidence_reference,2000)&&text(value.attribution,4000)
  &&Array.isArray(value.duties)&&value.duties.length<=10&&value.duties.every(duty=>text(duty,500,1))&&(value.review_by===null||date(value.review_by))&&bytes(JSON.stringify(value))<=8192
  &&(value.decision!=="ALLOW"||value.basis!=="UNKNOWN"&&text(value.evidence_reference,2000,1)&&text(value.attribution,4000,1)&&date(value.review_by));
function rightsItem(value){
  return object(value)&&uuid(value.document_id)&&uuid(value.version_id)&&(HASH.test(value.original_hash||"")||value.original_hash===null&&value.state==="SOURCE_UNAVAILABLE")
    &&(value.filename===null||text(value.filename,1000))&&rightStates.includes(value.state)&&typeof value.allowed==="boolean"&&value.allowed===(value.state==="ALLOWED")
    &&(value.review_id===null?value.policy===null&&value.actor_id===null&&value.created_at===null&&value.policy_erased_at===null&&!value.allowed:
      uuid(value.review_id)&&uuid(value.actor_id)&&date(value.created_at)&&(value.policy===null?
        date(value.policy_erased_at)&&!value.allowed&&["REVOKED","SOURCE_UNAVAILABLE"].includes(value.state):
        value.policy_erased_at===null&&policyShape(value.policy)))
    &&(!value.allowed||value.policy?.decision==="ALLOW"&&Date.parse(value.policy.review_by)>Date.now());
}
function snapshot(value){return Array.isArray(value)&&integer(value.length,1,50)&&new Set(value.map(row=>row?.document_id)).size===value.length
  &&value.every(row=>object(row)&&uuid(row.document_id)&&uuid(row.version_id)&&text(row.index_generation,500,1)&&integer(row.lifecycle_epoch,1));}
function canonicalResult(value,index,sources){
  const analysis=value?.obligations;
  return object(value)&&text(value.question,10000,1)&&text(value.answer,16000,1)&&bytes(JSON.stringify(value))<=1000000&&["REVIEW_REQUIRED","UNSUPPORTED"].includes(value.claim_state)
    &&typeof value.abstained==="boolean"&&Array.isArray(value.sources)&&value.sources.length<=50&&value.sources.every((source,i)=>object(source)&&source.citation_id===`S${i+1}`
      &&uuid(source.document_id)&&uuid(source.version_id)&&uuid(source.chunk_id)&&text(source.filename,1000)&&text(source.content,1200,1)&&HASH.test(source.original_content_hash||"")
      &&integer(source.chunk_index)&&(source.page_number===null||integer(source.page_number))&&typeof source.excerpt==="boolean"&&Object.hasOwn(source,"location")
      &&sources.some(row=>row.document_id===source.document_id&&row.version_id===source.version_id))&&same(value.validated_citation_ids,value.sources.map(source=>source.citation_id))
    &&analysis?.schema_version==="research-obligations/1"&&analysis.criterion_index===index&&analysis.total_documents===sources.length
    &&analysis.interpretation==="REVIEW_REQUIRED_NO_LEGAL_CERTIFICATION"&&analysis.coverage==="BOUNDED_RETRIEVAL_NOT_COMPLETE_OBLIGATION_REGISTER"
    &&Array.isArray(analysis.candidates)&&analysis.candidates.length<=12&&Array.isArray(analysis.rejections)&&analysis.rejections.length+analysis.candidates.length<=12
    &&Array.isArray(analysis.documents)&&analysis.documents.length===sources.length&&analysis.documents.every((row,i)=>row?.document_id===sources[i].document_id)
    &&analysis.candidates.every(row=>row?.claim_state==="REVIEW_REQUIRED"&&row.applicability_state==="NOT_DETERMINED"&&row.control_state==="PROPOSED_NOT_IMPLEMENTED");
}
function detail(value,args,selection){
  const keys=["schema_version","workspace_id","action",...summaryKeys,"title","result","source_snapshot","evidence","reviews","rights","interpretation"];
  if(value?.schema_version!=="obligation-evidence-detail/1"||value.workspace_id!==args.workspace||value.action!==selection.action||value.finding_id!==selection.findingId
    ||value.revision!==selection.revision||value.interpretation!=="REVIEW_REQUIRED_NO_LEGAL_CERTIFICATION"||!Object.keys(value).every(key=>keys.includes(key)))return false;
  if(!summary(Object.fromEntries(summaryKeys.map(key=>[key,value[key]])))||!Array.isArray(value.evidence)||!Array.isArray(value.reviews)||!Array.isArray(value.rights))return false;
  if(value.state!=="READY")return value.title===null&&value.result===null&&value.source_snapshot===null&&value.evidence.length===0&&value.reviews.length===0&&value.rights.length===0;
  return text(value.title,160,1)&&snapshot(value.source_snapshot)&&canonicalResult(value.result,value.result_index,value.source_snapshot)
    &&value.evidence.length===value.result.sources.length&&value.evidence.every((row,i)=>{
      const source=value.result.sources[i];return row?.id===source.chunk_id&&row.document_id===source.document_id&&row.version_id===source.version_id&&row.citation_id===source.citation_id
        &&text(row.filename,1000)&&text(row.original_text,32768,1)&&bytes(row.original_text)<=32768&&row.original_content_hash===source.original_content_hash
        &&row.available===true&&row.freshness==="current"&&same(row.location,source.location);
    })&&value.reviews.length>=1&&value.reviews.every(row=>uuid(row?.id)&&row.workspace_id===args.workspace&&row.finding_id===selection.findingId&&row.revision===selection.revision
      &&uuid(row.reviewer_id)&&row.decision==="approved"&&text(row.comment,4000)&&date(row.created_at))
    &&value.rights.length===value.source_snapshot.length&&value.rights.every((row,i)=>rightsItem(row)&&row.allowed&&row.document_id===value.source_snapshot[i].document_id&&row.version_id===value.source_snapshot[i].version_id);
}
async function readAudit(args,selection){
  try{await args.serviceRequest(args.env,"audit_events",{method:"POST",body:JSON.stringify([{workspace_id:args.workspace,user_id:args.user.id,
    action:selection.operation==="serving_rights_read"?"finding.serving_rights.read":selection.action==="SERVE_MCP"?"mcp.obligation_lookup":"obligation:read",resource_type:"findings",resource_id:selection.findingId,
    metadata:{gateway:"cloudflare",profile:"ZERO_COST_LOW_TRAFFIC",domain:"OBLIGATION_ANALYSIS",serving_action:selection.action,operation:selection.operation||(selection.findingId?"read":"list"),revision:selection.revision}}])});}
  catch{/* Best-effort audit is not a successful durable audit receipt. */}
}
export async function handleObligationEvidence(args,mcpSelection=null){
  const {request,env,json}=args,url=new URL(request.url),mcp=mcpSelection!==null;
  try{
    if(!mcp&&!["GET","HEAD"].includes(request.method))throw issue("METHOD_NOT_ALLOWED","Use GET to inspect Obligation evidence.",405);
    const matched=mcp?null:url.pathname.match(/^\/api\/v2\/obligations(?:\/([0-9a-f-]{36}))?$/i);
    if(!mcp&&!matched)throw issue("NOT_FOUND","This Obligation evidence route is unavailable.",404);
    const findingId=mcp?(mcpSelection.finding_id==null?null:id(mcpSelection.finding_id)):matched[1]?id(matched[1]):null;
    const revision=findingId?requiredRevision(mcp?mcpSelection.revision:Number(url.searchParams.get("revision"))):null;
    const limit=pageLimit(mcp?(mcpSelection.limit??20):Number(url.searchParams.get("limit")??20)),cursor=mcp?mcpSelection.after:url.searchParams.get("after"),after=cursor==null?null:id(cursor);
    if(findingId&&after||!findingId&&(mcp?mcpSelection.revision!==undefined:url.searchParams.has("revision")))throw issue("INVALID_SCOPE","Choose either a metadata page or an exact Finding revision.");
    const selection={action:mcp?"SERVE_MCP":"SERVE_API",findingId,revision,limit,after};await contract(args);
    const result=await rpc(args,"nexus_obligation_evidence",{p_context:await workbenchContext(args),p_operation:findingId?"read":"list",p_action:selection.action,p_finding:findingId,p_revision:revision,p_limit:limit,p_after:after});
    if(findingId)confirmed(detail(result,args,selection));
    else confirmed(result?.schema_version==="obligation-evidence-list/1"&&result.workspace_id===args.workspace&&result.action===selection.action
      &&Object.keys(result).every(key=>["schema_version","workspace_id","action","items","next_after"].includes(key))&&Array.isArray(result.items)&&result.items.length<=limit
      &&result.items.every(row=>summary(row,after))&&result.items.every((row,i)=>!i||row.finding_id>result.items[i-1].finding_id)
      &&(result.next_after===null||result.items.at(-1)?.finding_id===result.next_after&&uuid(result.next_after)));
    await readAudit(args,selection);return json(request,env,mcp?{...result,protocol:"nexusrag-evidence-mcp/1",operation:"obligation_lookup"}:result);
  }catch(error){throw translate(error);}
}
export async function handleFindingServingRights(args,findingId,context){
  const {request,env,member,json}=args,url=new URL(request.url);
  try{
    const action=servingAction(url.searchParams.get("action"));let operation="read",command={},revision=null,key=null;
    if(request.method==="POST"){
      if(!["owner","admin"].includes(member.role))throw issue("FORBIDDEN","Workspace owner or administrator review is required.",403);
      const data=await readBoundedJsonObject(request);revision=requiredRevision(data.revision);key=request.headers.get("idempotency-key");
      if(!text(key,128,1)||!Array.isArray(data.selections)||!integer(data.selections.length,1,50)
        ||data.selections.some(row=>!object(row)||!Object.keys(row).every(key=>["version_id","original_hash","expected_review_id"].includes(key))||!uuid(row.version_id)||!HASH.test(row.original_hash||"")||row.expected_review_id!==null&&!uuid(row.expected_review_id))
        ||new Set(data.selections.map(row=>row.version_id.toLowerCase())).size!==data.selections.length)
        throw issue("INVALID_SCOPE","Choose exact source versions, original hashes and current serving decisions with a stable review intent.");
      const policy=data.policy;if(!policyShape({...policy,review_by:policy?.review_by??null})||!Object.keys(policy).every(key=>["decision","basis","rationale","evidence_reference","attribution","duties","review_by"].includes(key)))throw issue("INVALID_SCOPE","The bounded serving rights review is incomplete.");
      // Only SQL can distinguish a new ALLOW from a replay after its expiry.
      // Replays confirm immutable intent and return current EXPIRED eligibility.
      command={selections:data.selections.map(row=>({version_id:row.version_id.toLowerCase(),original_hash:row.original_hash,expected_review_id:row.expected_review_id?.toLowerCase()??null})),
        policy:{decision:policy.decision,basis:policy.basis,rationale:policy.rationale.trim(),evidence_reference:policy.evidence_reference.trim(),attribution:policy.attribution.trim(),duties:policy.duties.map(value=>value.trim()),
          review_by:policy.review_by==null?null:new Date(policy.review_by).toISOString()}};operation="record";
    }else if(!["GET","HEAD"].includes(request.method))throw issue("METHOD_NOT_ALLOWED","Use GET or POST for serving rights review.",405);
    await contract(args);
    const result=await rpc(args,"nexus_finding_serving_rights",{p_context:context,p_operation:operation,p_finding:findingId,p_action:action,p_command:command,p_revision:revision,p_key:key});
    confirmed(result?.schema_version==="finding-serving-rights/1"&&result.workspace_id===args.workspace&&result.finding_id===findingId&&integer(result.revision,1)&&result.action===action
      &&Object.keys(result).every(key=>["schema_version","workspace_id","finding_id","revision","action","source_state","eligible","can_review","items","confirmed_review"].includes(key))
      &&sourceStates.includes(result.source_state)&&typeof result.can_review==="boolean"&&typeof result.eligible==="boolean"&&result.can_review===["owner","admin"].includes(member.role)
      &&Array.isArray(result.items)&&integer(result.items.length,1,50)&&new Set(result.items.map(row=>row?.version_id)).size===result.items.length&&result.items.every(rightsItem)
      &&result.eligible===(result.source_state==="CURRENT"&&result.items.every(row=>row.allowed)));
    if(operation==="read"){
      confirmed(result.confirmed_review===null);
      await readAudit(args,{action,findingId,revision:result.revision,operation:"serving_rights_read"});
    }
    else{const receipt=result.confirmed_review;confirmed(result.revision>=revision&&receipt?.schema_version==="finding-serving-rights-confirmation/1"&&receipt.finding_id===findingId&&receipt.finding_revision===revision
      &&receipt.action===action&&receipt.actor_id===args.user.id&&receipt.serialization===servingIntentSerialization
      &&Object.keys(receipt).every(key=>["schema_version","finding_id","finding_revision","action","actor_id","review_ids","serialization","intent_hash"].includes(key))
      &&receipt.intent_hash===await servingIntentHash({finding_id:findingId,finding_revision:revision,action,actor_id:args.user.id,command})
      &&Array.isArray(receipt.review_ids)&&receipt.review_ids.length===command.selections.length&&new Set(receipt.review_ids).size===receipt.review_ids.length&&receipt.review_ids.every(uuid));}
    return json(request,env,result,operation==="record"?201:200);
  }catch(error){throw translate(error);}
}
