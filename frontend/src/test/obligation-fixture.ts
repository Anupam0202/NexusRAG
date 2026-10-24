import type { ResearchRun,ResearchRunResult,ResearchQuoteAnchor } from "@/lib/research-run";
import type { ObligationCandidate } from "@/lib/research-obligations";
const id=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
export function obligationFixture():ResearchRun {
  const contents=["\u{1f4ca} Operators must retain reports for 30 days, except public summaries.","A report is a synthetic retained record."];
  const sources=contents.map((content,index)=>({citation_id:`S${index+1}`,document_id:id(index+1),version_id:id(index+3),chunk_id:id(index+5),
    filename:`Synthetic duties ${index+1}.txt`,content,original_content_hash:String(index).repeat(64),location:{section:"3"},page_number:index?0:null,chunk_index:0,excerpt:false}));
  const anchor=(quote:string,index=0):ResearchQuoteAnchor=>{const offset=sources[index].content.indexOf(quote),quote_start=Array.from(sources[index].content.slice(0,offset)).length;
    return {document_id:sources[index].document_id,citation_id:sources[index].citation_id,quote,quote_start,quote_end:quote_start+Array.from(quote).length};};
  const candidate:ObligationCandidate={provision:anchor("Operators must retain reports for 30 days, except public summaries."),authority:null,jurisdiction:null,
    actor:anchor("Operators"),action:anchor("retain reports"),applicability:null,deadline:anchor("30 days"),valid_from:null,valid_to:null,
    definitions:[anchor("A report is a synthetic retained record.",1)],exceptions:[anchor("except public summaries")],amendments:[],supersedes:[],
    control_candidate:"Propose a report-retention review.",limitations:["No independent applicability determination."],claim_state:"REVIEW_REQUIRED",
    applicability_state:"NOT_DETERMINED",control_state:"PROPOSED_NOT_IMPLEMENTED"};
  const result:ResearchRunResult={question:"Which synthetic duties need review?",answer:"Operators retain reports [S1]. Definition [S2].",claim_state:"REVIEW_REQUIRED",abstained:false,
    sources,validated_citation_ids:["S1","S2"],model:"synthetic",coverage:{completeness:"NOT_EXHAUSTIVE",chunks_considered:2},provider_cost_status:"UNKNOWN",
    review_state:"COMPLETION_CRITERIA_NOT_AUTOMATICALLY_VERIFIED",obligations:{schema_version:"research-obligations/1",criterion_index:0,total_documents:2,candidates:[candidate],
      documents:sources.map(source=>({document_id:source.document_id,filename:source.filename,evidence_state:"CANDIDATE",consulted_sources:[{version_id:source.version_id,
        chunk_id:source.chunk_id,original_content_hash:source.original_content_hash,page_number:source.page_number,chunk_index:source.chunk_index}]})),rejections:[],
      interpretation:"REVIEW_REQUIRED_NO_LEGAL_CERTIFICATION",coverage:"BOUNDED_RETRIEVAL_NOT_COMPLETE_OBLIGATION_REGISTER"}};
  return {id:id(7),plan_id:id(8),workspace_id:id(9),owner_id:id(10),schema_version:"research-run/1",persistence_state:"PERSISTED",state:"completed",generation:1,position:1,
    questions:[result.question],results:[result],source_state:"CURRENT",error_code:null,created_at:"2026-10-19T00:00:00Z",mode:"OBLIGATION_ANALYSIS",total_steps:1,
    source_snapshot:sources.map(source=>({document_id:source.document_id,version_id:source.version_id,index_generation:"synthetic-generation",lifecycle_epoch:1}))};
}
