// Synthetic transport peers using the real canonical Obligation formatter.
// These are not SQL durability, hosted identity or provider quality evidence.
import {obligationCapacity,obligationWire} from "./research-obligation-capacity.mjs";
import {obligationResult,obligationWork} from "../../apps/gateway/src/research-obligations.js";
export const obligationIds={workspace:"11111111-1111-4111-8111-111111111111",user:"22222222-2222-4222-8222-222222222222",finding:"33333333-3333-4333-8333-333333333333",
  policy:"44444444-4444-4444-8444-444444444444",run:"55555555-5555-4555-8555-555555555555",reviewer:"66666666-6666-4666-8666-666666666666"};
export const obligationContract=()=>({schema_version:"obligation-evidence/1",list_schema:"obligation-evidence-list/1",detail_schema:"obligation-evidence-detail/1",
  rights_schema:"finding-serving-rights/1",actions:["SERVE_API","SERVE_MCP"],default_limit:20,max_limit:50,max_sources:50,max_candidates:12,max_criteria:11,max_result_bytes:1000000});
export const servingPolicy=()=>({decision:"ALLOW",basis:"OWNED_CONTENT",rationale:"Synthetic owner-held source with explicit serving evidence.",evidence_reference:"urn:synthetic:owner-permission",
  attribution:"Synthetic policy owner",duties:["Retain attribution."],review_by:"2099-01-01T00:00:00.000Z"});
export function obligationDetail(action="SERVE_API"){
  const fixture=obligationCapacity(),rendered=obligationResult(obligationWork(fixture.run),fixture.documents,fixture.sources,{answer:JSON.stringify(obligationWire(fixture.candidates,fixture.sources))});
  const result={question:fixture.run.questions[0],answer:rendered.checked.answer,claim_state:rendered.checked.claim_state,abstained:rendered.checked.abstained,sources:rendered.sources,
    validated_citation_ids:rendered.sources.map(row=>row.citation_id),model:"controlled-synthetic",coverage:{completeness:"NOT_EXHAUSTIVE",chunks_considered:50},provider_cost_status:"NOT_CALLED",
    review_state:"COMPLETION_CRITERIA_NOT_AUTOMATICALLY_VERIFIED",obligations:rendered.analysis};
  return {schema_version:"obligation-evidence-detail/1",workspace_id:obligationIds.workspace,action,finding_id:obligationIds.finding,revision:3,run_id:obligationIds.run,result_index:0,
    created_at:"2026-10-27T00:00:00Z",updated_at:"2026-10-27T00:01:00Z",state:"READY",source_state:"CURRENT",review_state:"APPROVED",rights_state:"ALLOWED",title:"Synthetic reviewed obligation candidates",
    result,source_snapshot:fixture.run.source_snapshot,evidence:rendered.sources.map(source=>{const original=fixture.originals.find(row=>row.id===source.chunk_id);
      return {id:original.id,document_id:source.document_id,version_id:source.version_id,citation_id:source.citation_id,filename:source.filename,original_text:original.original_text,
        original_content_hash:source.original_content_hash,location:source.location,available:true,freshness:"current"};}),
    reviews:[{id:obligationIds.policy,workspace_id:obligationIds.workspace,finding_id:obligationIds.finding,revision:3,reviewer_id:obligationIds.reviewer,decision:"approved",
      comment:"Reviewed exact synthetic revision; no legal certification.",created_at:"2026-10-27T00:01:00Z"}],
    rights:fixture.originals.map((source,i)=>({document_id:source.document_id,version_id:source.version_id,original_hash:source.original_content_hash,filename:fixture.documents[i].filename,
      review_id:`ab444400-0000-4000-8100-${String(i+1).padStart(12,"0")}`,actor_id:obligationIds.user,created_at:"2026-10-27T00:01:00Z",policy:servingPolicy(),policy_erased_at:null,allowed:true,state:"ALLOWED"})),
    interpretation:"REVIEW_REQUIRED_NO_LEGAL_CERTIFICATION"};
}
export function obligationSummary(detail=obligationDetail()){return Object.fromEntries(["finding_id","revision","run_id","result_index","created_at","updated_at","state","source_state","review_state","rights_state"].map(key=>[key,detail[key]]));}
export function obligationWithheld(state="RIGHTS_BLOCKED",action="SERVE_API"){return {...obligationDetail(action),state,source_state:state==="SOURCE_UNAVAILABLE"?"UNAVAILABLE_OR_CHANGED":"CURRENT",
  review_state:state==="REVIEW_REQUIRED"?"REVIEW_REQUIRED":"APPROVED",rights_state:state==="RIGHTS_BLOCKED"?"RIGHTS_BLOCKED":"ALLOWED",title:null,result:null,source_snapshot:null,evidence:[],reviews:[],rights:[]};}
export function obligationRights(action="SERVE_API"){return {schema_version:"finding-serving-rights/1",workspace_id:obligationIds.workspace,finding_id:obligationIds.finding,revision:3,
  action,source_state:"CURRENT",eligible:true,can_review:true,items:obligationDetail(action).rights,confirmed_review:null};}
