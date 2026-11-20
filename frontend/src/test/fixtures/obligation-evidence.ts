import {createHash} from "node:crypto";
import {obligationFixture} from "@/test/obligation-fixture";
import type {FindingServingRights,ObligationEvidenceDetail,ObligationEvidenceList,ServingAction,FindingServingCommand} from "@/lib/obligation-evidence";
import type {FindingDetail} from "@/lib/api";
export const obligationId=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
// Independent Node hash for controlled test receipts, not a SQL persistence claim.
export function fixtureServingIntentHash(finding:string,revision:number,action:ServingAction,actor:string,command:Omit<FindingServingCommand,"revision">) {
  const values:Array<string|null>=[finding.toLowerCase(),String(revision),action,actor.toLowerCase(),String(command.selections.length)];
  for(const source of command.selections)values.push(source.version_id.toLowerCase(),source.original_hash,source.expected_review_id?.toLowerCase()??null);
  const policy=command.policy;values.push(policy.decision,policy.basis,policy.rationale,policy.evidence_reference,policy.attribution,String(policy.duties.length),...policy.duties,policy.review_by);
  const framed="OBLIGATION_SERVING_INTENT_UTF8/1\n"+values.map(value=>value===null?"-1:":`${Buffer.byteLength(value,"utf8")}:${value}`).join("");
  return createHash("sha256").update(framed,"utf8").digest("hex");
}
export function obligationEvidenceFixture(action:ServingAction="SERVE_API") {
  const run=obligationFixture(),result=run.results[0],finding=obligationId(13),reviewer=obligationId(11);
  for(const source of result.sources){source.original_content_hash=createHash("sha256").update(source.content).digest("hex");
    for(const document of result.obligations!.documents)for(const receipt of document.consulted_sources)if(receipt.chunk_id===source.chunk_id)receipt.original_content_hash=source.original_content_hash;}
  const policy={decision:"ALLOW" as const,basis:"OWNED_CONTENT" as const,rationale:"Approved synthetic retained-source serving.",evidence_reference:"urn:synthetic:serving-rights",
    attribution:"Synthetic source owner",duties:["Preserve source qualifications"],review_by:"2030-01-01T00:00:00.000Z"};
  const rights:FindingServingRights={schema_version:"finding-serving-rights/1",workspace_id:run.workspace_id,finding_id:finding,revision:3,action,source_state:"CURRENT",eligible:true,can_review:true,confirmed_review:null,
    items:result.sources.map((source,index)=>({document_id:source.document_id,version_id:source.version_id,original_hash:String(index+1).repeat(64),filename:source.filename,
      review_id:obligationId(20+index),actor_id:run.owner_id,created_at:run.created_at,policy:structuredClone(policy),policy_erased_at:null,allowed:true,state:"ALLOWED"}))};
  const summary={finding_id:finding,revision:3,run_id:run.id,result_index:0,created_at:run.created_at,updated_at:run.created_at,state:"READY" as const,source_state:"CURRENT" as const,review_state:"APPROVED" as const,rights_state:"ALLOWED" as const};
  const list:ObligationEvidenceList={schema_version:"obligation-evidence-list/1",workspace_id:run.workspace_id,action,items:[summary],next_after:null};
  const detail:ObligationEvidenceDetail={schema_version:"obligation-evidence-detail/1",workspace_id:run.workspace_id,action,...summary,title:"Synthetic reviewed duties",result,source_snapshot:run.source_snapshot!,
    evidence:result.sources.map(source=>({id:source.chunk_id,document_id:source.document_id,version_id:source.version_id,citation_id:source.citation_id,filename:source.filename,original_text:source.content,
      original_content_hash:source.original_content_hash,location:source.location,available:true,freshness:"current"})),reviews:[{reviewer_id:reviewer,revision:3,decision:"approved",comment:"Independent exact-revision review.",created_at:run.created_at}],
    rights:rights.items,interpretation:"REVIEW_REQUIRED_NO_LEGAL_CERTIFICATION"};
  const findingDetail:FindingDetail={id:finding,workspace_id:run.workspace_id,owner_id:run.owner_id,author_id:run.owner_id,title:detail.title!,revision:3,source_run_id:null,source_research_run_id:run.id,
    source_research_position:0,source_research_mode:"OBLIGATION_ANALYSIS",created_at:run.created_at,updated_at:run.created_at,permission:"owner",authored_markdown:"",generated_markdown:result.answer,source_unavailable:false,
    research_origin:{run_id:run.id,result_index:0,plan_id:run.plan_id,question:result.question,claim_state:"REVIEW_REQUIRED",source_state:"CURRENT",obligations:result.obligations},evidence:detail.evidence,reviews:detail.reviews,participants:[]};
  const command:FindingServingCommand={revision:3,selections:rights.items.map(row=>({version_id:row.version_id,original_hash:row.original_hash!,expected_review_id:row.review_id})),policy};
  const confirmed:FindingServingRights={...structuredClone(rights),confirmed_review:{schema_version:"finding-serving-rights-confirmation/1",finding_id:finding,finding_revision:3,action,actor_id:run.owner_id,
    review_ids:[obligationId(30),obligationId(31)],intent_hash:fixtureServingIntentHash(finding,3,action,run.owner_id,command),serialization:"OBLIGATION_SERVING_INTENT_UTF8/1"}};
  return {run,result,list,detail,rights,findingDetail,command,confirmed};
}
export function withheldObligationEvidence(state:"SOURCE_UNAVAILABLE"|"REVIEW_REQUIRED"|"RIGHTS_BLOCKED"="RIGHTS_BLOCKED",action:ServingAction="SERVE_API"):ObligationEvidenceDetail {
  const {detail}=obligationEvidenceFixture(action);return {...detail,state,source_state:state==="SOURCE_UNAVAILABLE"?"UNAVAILABLE_OR_CHANGED":"CURRENT",review_state:state==="REVIEW_REQUIRED"?"REVIEW_REQUIRED":"APPROVED",
    rights_state:"RIGHTS_BLOCKED",title:null,result:null,source_snapshot:null,evidence:[],reviews:[],rights:[]};
}
