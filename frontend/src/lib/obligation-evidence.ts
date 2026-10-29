import type {ResearchRun,ResearchRunResult} from "./research-run";
import {confirmedQueryRetrieval} from "./research-run";
import {confirmedObligationResult} from "./research-obligations";
import type {FindingExportPolicy} from "./finding-package";
export type ServingAction="SERVE_API"|"SERVE_MCP";
export type ObligationEvidenceState="READY"|"SOURCE_UNAVAILABLE"|"REVIEW_REQUIRED"|"RIGHTS_BLOCKED";
export type ServingRightState="ALLOWED"|"UNKNOWN"|"DENIED"|"REVIEW_REQUIRED"|"REVOKED"|"EXPIRED"|"HASH_MISMATCH"|"SOURCE_UNAVAILABLE";
export type FindingServingCommand={revision:number;selections:Array<{version_id:string;original_hash:string;expected_review_id:string|null}>;policy:FindingExportPolicy};
export type ServingRight={document_id:string;version_id:string;original_hash:string|null;filename:string|null;review_id:string|null;
  actor_id:string|null;created_at:string|null;policy:FindingExportPolicy|null;policy_erased_at:string|null;allowed:boolean;state:ServingRightState};
export type FindingServingConfirmation={schema_version:"finding-serving-rights-confirmation/1";finding_id:string;finding_revision:number;
  action:ServingAction;actor_id:string;review_ids:string[];intent_hash:string;serialization:"OBLIGATION_SERVING_INTENT_UTF8/1"};
export type FindingServingRights={schema_version:"finding-serving-rights/1";workspace_id:string;finding_id:string;revision:number;
  action:ServingAction;source_state:"CURRENT"|"UNAVAILABLE_OR_CHANGED";eligible:boolean;can_review:boolean;items:ServingRight[];confirmed_review:FindingServingConfirmation|null};
export type ObligationEvidenceSummary={finding_id:string;revision:number;run_id:string;result_index:number;created_at:string;updated_at:string;
  state:ObligationEvidenceState;source_state:"CURRENT"|"UNAVAILABLE_OR_CHANGED";review_state:"APPROVED"|"REVIEW_REQUIRED"|"CHANGES_REQUESTED";rights_state:"ALLOWED"|"RIGHTS_BLOCKED"};
export type ObligationEvidenceList={schema_version:"obligation-evidence-list/1";workspace_id:string;action:ServingAction;items:ObligationEvidenceSummary[];next_after:string|null};
export type ObligationEvidenceQuote={id:string;document_id:string;version_id:string;citation_id:string;filename:string;original_text:string;
  original_content_hash:string;location:unknown;available:true;freshness:"current"};
export type ObligationEvidenceReview={reviewer_id:string;revision:number;decision:string;comment:string;created_at?:string};
export type ObligationEvidenceDetail=ObligationEvidenceSummary&{schema_version:"obligation-evidence-detail/1";workspace_id:string;action:ServingAction;title:string|null;
  result:ResearchRunResult|null;source_snapshot:ResearchRun["source_snapshot"]|null;evidence:ObligationEvidenceQuote[];reviews:ObligationEvidenceReview[];
  rights:ServingRight[];interpretation:"REVIEW_REQUIRED_NO_LEGAL_CERTIFICATION"};
const uuid=(value:unknown):value is string=>typeof value==="string"&&/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const hash=(value:unknown):value is string=>typeof value==="string"&&/^[a-f0-9]{64}$/.test(value);
const text=(value:unknown,max:number,min=0):value is string=>typeof value==="string"&&!value.includes("\0")&&Array.from(value).length>=min&&Array.from(value).length<=max;
const date=(value:unknown):value is string=>typeof value==="string"&&Number.isFinite(Date.parse(value));
const integer=(value:unknown,min:number,max=Number.MAX_SAFE_INTEGER):value is number=>Number.isSafeInteger(value)&&Number(value)>=min&&Number(value)<=max;
const sourceState=(value:unknown)=>value==="CURRENT"||value==="UNAVAILABLE_OR_CHANGED";
const bytes=(value:unknown)=>new TextEncoder().encode(JSON.stringify(value)).byteLength;
const summaryKeys=["finding_id","revision","run_id","result_index","created_at","updated_at","state","source_state","review_state","rights_state"];
export function sameJson(left:unknown,right:unknown):boolean {
  if(left===right)return true;
  if(left===null||right===null||typeof left!=="object"||typeof right!=="object")return false;
  if(Array.isArray(left)||Array.isArray(right))return Array.isArray(left)&&Array.isArray(right)&&left.length===right.length&&left.every((value,index)=>sameJson(value,right[index]));
  const a=left as Record<string,unknown>,b=right as Record<string,unknown>,keys=Object.keys(a);
  return keys.length===Object.keys(b).length&&keys.every(key=>Object.hasOwn(b,key)&&sameJson(a[key],b[key]));
}
export function confirmedServingPolicy(policy:FindingExportPolicy):boolean {
  return !!policy&&Object.keys(policy).every(key=>["decision","basis","rationale","evidence_reference","attribution","duties","review_by"].includes(key))
    &&["ALLOW","DENY","REVIEW_REQUIRED","REVOKED"].includes(policy.decision)&&["OWNED_CONTENT","LICENSE","PERMISSION","PUBLIC_DOMAIN","UNKNOWN"].includes(policy.basis)
    &&text(policy.rationale,2000,1)&&!!policy.rationale.trim()&&text(policy.evidence_reference,2000)&&text(policy.attribution,4000)
    &&Array.isArray(policy.duties)&&policy.duties.length<=10&&policy.duties.every(value=>text(value,500,1)&&!!value.trim())
    &&(policy.review_by===null||date(policy.review_by))&&bytes(policy)<=8192
    &&(policy.decision!=="ALLOW"||policy.basis!=="UNKNOWN"&&!!policy.evidence_reference.trim()&&!!policy.attribution.trim()&&date(policy.review_by));
}
export function canonicalServingCommand(body:FindingServingCommand):FindingServingCommand|null {
  if(!body||!Object.keys(body).every(key=>["revision","selections","policy"].includes(key))||!integer(body.revision,1)||!confirmedServingPolicy(body.policy)||!Array.isArray(body.selections)||body.selections.length<1||body.selections.length>50
    ||!body.selections.every(row=>row&&Object.keys(row).every(key=>["version_id","original_hash","expected_review_id"].includes(key))&&uuid(row.version_id)&&hash(row.original_hash)&&(row.expected_review_id===null||uuid(row.expected_review_id)))
    ||new Set(body.selections.map(row=>row.version_id.toLowerCase())).size!==body.selections.length)return null;
  return {revision:body.revision,selections:body.selections.map(row=>({version_id:row.version_id.toLowerCase(),original_hash:row.original_hash,expected_review_id:row.expected_review_id?.toLowerCase()??null})),
    policy:{decision:body.policy.decision,basis:body.policy.basis,rationale:body.policy.rationale.trim(),evidence_reference:body.policy.evidence_reference.trim(),attribution:body.policy.attribution.trim(),
      duties:body.policy.duties.map(value=>value.trim()),review_by:body.policy.review_by===null?null:new Date(body.policy.review_by).toISOString()}};
}
export function confirmedServingRight(row:ServingRight):boolean {
  return !!row&&uuid(row.document_id)&&uuid(row.version_id)&&(hash(row.original_hash)||row.original_hash===null&&row.state==="SOURCE_UNAVAILABLE"&&!row.allowed)&&(row.filename===null||text(row.filename,4096))
    &&(row.review_id===null||uuid(row.review_id))&&(row.actor_id===null||uuid(row.actor_id))&&(row.created_at===null||date(row.created_at))&&typeof row.allowed==="boolean"
    &&["ALLOWED","UNKNOWN","DENIED","REVIEW_REQUIRED","REVOKED","EXPIRED","HASH_MISMATCH","SOURCE_UNAVAILABLE"].includes(row.state)
    &&(row.review_id===null?row.policy===null&&row.policy_erased_at===null&&row.actor_id===null&&row.created_at===null&&!row.allowed:
      uuid(row.actor_id)&&date(row.created_at)&&(row.policy_erased_at===null?!!row.policy&&confirmedServingPolicy(row.policy):
        date(row.policy_erased_at)&&row.policy===null&&!row.allowed&&["REVOKED","SOURCE_UNAVAILABLE"].includes(row.state)))
    &&row.allowed===(row.state==="ALLOWED")&&(!row.allowed||row.policy?.decision==="ALLOW");
}
export function confirmedServingRights(value:FindingServingRights,id:string,workspace:string|null|undefined,action:ServingAction):boolean {
  return !!value&&value.schema_version==="finding-serving-rights/1"&&value.finding_id===id&&value.workspace_id===workspace&&value.action===action&&integer(value.revision,1)
    &&sourceState(value.source_state)&&typeof value.can_review==="boolean"&&typeof value.eligible==="boolean"&&Array.isArray(value.items)&&value.items.length>=1&&value.items.length<=50
    &&value.items.every(confirmedServingRight)&&new Set(value.items.map(row=>row.version_id)).size===value.items.length
    &&value.eligible===(value.source_state==="CURRENT"&&value.items.every(row=>row.allowed))
    &&(value.confirmed_review===null||!!value.confirmed_review&&value.confirmed_review.schema_version==="finding-serving-rights-confirmation/1"
      &&Object.keys(value.confirmed_review).every(key=>["schema_version","finding_id","finding_revision","action","actor_id","review_ids","serialization","intent_hash"].includes(key))
      &&value.confirmed_review.finding_id===id&&value.confirmed_review.action===action&&integer(value.confirmed_review.finding_revision,1)&&uuid(value.confirmed_review.actor_id)
      &&value.confirmed_review.serialization==="OBLIGATION_SERVING_INTENT_UTF8/1"&&hash(value.confirmed_review.intent_hash)&&Array.isArray(value.confirmed_review.review_ids)
      &&value.confirmed_review.review_ids.length>=1&&value.confirmed_review.review_ids.length<=50&&value.confirmed_review.review_ids.every(uuid)
      &&new Set(value.confirmed_review.review_ids).size===value.confirmed_review.review_ids.length);
}
export function confirmedObligationSummary(row:ObligationEvidenceSummary):boolean {
  return !!row&&uuid(row.finding_id)&&integer(row.revision,1)&&uuid(row.run_id)&&integer(row.result_index,0,10)&&date(row.created_at)&&date(row.updated_at)
    &&["READY","SOURCE_UNAVAILABLE","REVIEW_REQUIRED","RIGHTS_BLOCKED"].includes(row.state)&&sourceState(row.source_state)
    &&["APPROVED","REVIEW_REQUIRED","CHANGES_REQUESTED"].includes(row.review_state)&&["ALLOWED","RIGHTS_BLOCKED"].includes(row.rights_state)
    &&row.state===(row.source_state!=="CURRENT"?"SOURCE_UNAVAILABLE":row.review_state!=="APPROVED"?"REVIEW_REQUIRED":row.rights_state!=="ALLOWED"?"RIGHTS_BLOCKED":"READY");
}
export function confirmedObligationList(value:ObligationEvidenceList,workspace:string|null|undefined,action:ServingAction,limit:number,after?:string):boolean {
  return !!value&&value.schema_version==="obligation-evidence-list/1"&&value.workspace_id===workspace&&value.action===action&&Array.isArray(value.items)&&value.items.length<=limit
    &&value.items.every(row=>confirmedObligationSummary(row)&&Object.keys(row).every(key=>summaryKeys.includes(key)))
    &&value.items.every((row,index)=>row.finding_id>(index?value.items[index-1].finding_id:after??""))
    &&(value.next_after===null||uuid(value.next_after)&&value.items.at(-1)?.finding_id===value.next_after);
}
function confirmedSelectedResult(result:ResearchRunResult,index:number,snapshot:ResearchRun["source_snapshot"]):boolean {
  if(!result||!Array.isArray(snapshot)||snapshot.length<1||snapshot.length>50||!snapshot.every(row=>row&&uuid(row.document_id)&&uuid(row.version_id)&&typeof row.index_generation==="string"&&row.index_generation.length>0&&integer(row.lifecycle_epoch,1))
    ||new Set(snapshot.map(row=>row.document_id)).size!==snapshot.length||!text(result.question,10000,1)||!text(result.answer,16000,1)||!["REVIEW_REQUIRED","UNSUPPORTED"].includes(result.claim_state)
    ||typeof result.abstained!=="boolean"||!Array.isArray(result.sources)||result.sources.length>50||!Array.isArray(result.validated_citation_ids)||!result.coverage
    ||result.coverage.completeness!=="NOT_EXHAUSTIVE"||!integer(result.coverage.chunks_considered,0,200)||!["UNKNOWN","NOT_CALLED"].includes(result.provider_cost_status)
    ||result.review_state!=="COMPLETION_CRITERIA_NOT_AUTOMATICALLY_VERIFIED"||result.model!==null&&typeof result.model!=="string"||bytes(result)>1000000)return false;
  if(!result.sources.every((row,index)=>row&&row.citation_id===`S${index+1}`&&uuid(row.document_id)&&uuid(row.version_id)&&uuid(row.chunk_id)&&text(row.filename,4096)&&text(row.content,1200,1)
    &&hash(row.original_content_hash)&&integer(row.chunk_index,0)&&(row.page_number===null||integer(row.page_number,0))&&typeof row.excerpt==="boolean"
    &&snapshot.some(item=>item.document_id===row.document_id&&item.version_id===row.version_id)))return false;
  return (result.query_retrieval===undefined||confirmedQueryRetrieval(result.query_retrieval,result.question,"OBLIGATION_ANALYSIS"))&&confirmedObligationResult(result,index,snapshot);
}
export async function confirmedObligationDetail(value:ObligationEvidenceDetail,id:string,revision:number,workspace:string|null|undefined,action:ServingAction):Promise<boolean> {
  try {
    if(!value||value.schema_version!=="obligation-evidence-detail/1"||value.workspace_id!==workspace||value.action!==action||value.finding_id!==id||value.revision!==revision
      ||!confirmedObligationSummary(value)||value.interpretation!=="REVIEW_REQUIRED_NO_LEGAL_CERTIFICATION"||!Array.isArray(value.evidence)||!Array.isArray(value.reviews)||!Array.isArray(value.rights))return false;
    if(value.state!=="READY")return value.title===null&&value.result===null&&value.source_snapshot===null&&value.evidence.length===0&&value.reviews.length===0&&value.rights.length===0;
    const {result,source_snapshot:snapshot}=value;
    if(!text(value.title,160,1)||!result||!snapshot||!confirmedSelectedResult(result,value.result_index,snapshot)||value.rights.length!==snapshot.length||!value.rights.every(confirmedServingRight)
      ||value.rights.some(row=>!row.allowed)||new Set(value.rights.map(row=>row.version_id)).size!==snapshot.length
      ||!snapshot.every(source=>value.rights.some(row=>row.document_id===source.document_id&&row.version_id===source.version_id))||value.evidence.length!==result.sources.length
      ||new Set(value.evidence.map(row=>row.citation_id)).size!==value.evidence.length||!value.reviews.length||!value.reviews.every(row=>row&&uuid(row.reviewer_id)&&row.revision===revision
        &&["approved","changes_requested"].includes(row.decision)&&text(row.comment,4000)&&(row.created_at===undefined||date(row.created_at)))
      ||!value.reviews.some(row=>row.decision==="approved")||value.reviews.some(row=>row.decision==="changes_requested"))return false;
    for(const [index,row] of value.evidence.entries()) {
      const source=result.sources[index];
      if(!row||!uuid(row.id)||row.id!==source.chunk_id||row.document_id!==source.document_id||row.version_id!==source.version_id||row.citation_id!==source.citation_id||row.filename!==source.filename
        ||row.available!==true||row.freshness!=="current"||row.original_content_hash!==source.original_content_hash||typeof row.original_text!=="string"||!row.original_text
        ||new TextEncoder().encode(row.original_text).byteLength>32768||Array.from(row.original_text).slice(0,Array.from(source.content).length).join("")!==source.content||!sameJson(row.location,source.location))return false;
      const digest=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(row.original_text))),part=>part.toString(16).padStart(2,"0")).join("");
      if(digest!==row.original_content_hash)return false;
    }
    return true;
  }catch{return false;}
}
export const servingActionLabel=(action:ServingAction)=>action==="SERVE_API"?"REST API":"Custom MCP";
export const obligationStateLabel:Record<ObligationEvidenceState,string>={READY:"Available for this action",SOURCE_UNAVAILABLE:"Source evidence unavailable",REVIEW_REQUIRED:"Independent revision review required",RIGHTS_BLOCKED:"Source serving rights withheld"};
