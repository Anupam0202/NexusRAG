import type { ResearchQuoteAnchor,ResearchRun,ResearchRunResult } from "./research-run";

export const obligationFields=["authority","jurisdiction","actor","action","applicability","deadline","valid_from","valid_to"] as const;
export const obligationLists=["definitions","exceptions","amendments","supersedes"] as const;
type Field=typeof obligationFields[number];
type List=typeof obligationLists[number];
export type ObligationCandidate={provision:ResearchQuoteAnchor;action:ResearchQuoteAnchor;control_candidate:string;limitations:string[];
  claim_state:"REVIEW_REQUIRED";applicability_state:"NOT_DETERMINED";control_state:"PROPOSED_NOT_IMPLEMENTED"}
  & Record<Exclude<Field,"action">,ResearchQuoteAnchor|null> & Record<List,ResearchQuoteAnchor[]>;
export type ResearchObligations={schema_version:"research-obligations/1";criterion_index:number;total_documents:number;
  candidates:ObligationCandidate[];documents:Array<{document_id:string;filename:string;evidence_state:"CANDIDATE"|"NO_CANDIDATE_PROPOSED"|"NO_INDEXED_EVIDENCE";
    consulted_sources:Array<{version_id:string;chunk_id:string;original_content_hash:string;page_number:number|null;chunk_index:number}>}>;
  rejections:Array<{candidate_index:number;reason:"INVALID_SOURCE_ANCHOR"|"DUPLICATE_PROVISION"}>;
  interpretation:"REVIEW_REQUIRED_NO_LEGAL_CERTIFICATION";coverage:"BOUNDED_RETRIEVAL_NOT_COMPLETE_OBLIGATION_REGISTER"};
export function obligationAnchors(candidate:ObligationCandidate) {
  return [candidate.provision,...obligationFields.flatMap(field=>candidate[field]?[candidate[field] as ResearchQuoteAnchor]:[]),
    ...obligationLists.flatMap(field=>candidate[field])];
}
const uuid=(value:unknown)=>typeof value==="string"&&/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const text=(value:unknown,max:number):value is string=>typeof value==="string"&&!!value.trim()&&Array.from(value).length<=max;
// A saved Finding exposes one canonical result and its source snapshot. Keep the
// same quotation/receipt checks without constructing an artificial whole run.
export function confirmedObligationResult(result:ResearchRunResult,index:number,snapshot:ResearchRun["source_snapshot"]) {
  const analysis=result.obligations;
  if(!analysis||!snapshot||analysis.schema_version!=="research-obligations/1"||analysis.criterion_index!==index||analysis.total_documents!==snapshot.length
    ||analysis.interpretation!=="REVIEW_REQUIRED_NO_LEGAL_CERTIFICATION"||analysis.coverage!=="BOUNDED_RETRIEVAL_NOT_COMPLETE_OBLIGATION_REGISTER"
    ||!Array.isArray(analysis.candidates)||analysis.candidates.length>12||!Array.isArray(analysis.rejections)
    ||analysis.rejections.length+analysis.candidates.length>12||!Array.isArray(analysis.documents)||analysis.documents.length!==snapshot.length)return false;
  const originals=new Map<string,{source:ResearchRunResult["sources"][number];characters:string[]}>();
  for(const source of result.sources) {
    const characters=Array.from(source.content);
    if(characters.length<1||characters.length>1200||originals.has(source.citation_id))return false;
    originals.set(source.citation_id,{source,characters});
  }
  const used=new Set<string>(),provisions=new Set<string>();
  for(const candidate of analysis.candidates) {
    if(!candidate||candidate.claim_state!=="REVIEW_REQUIRED"||candidate.applicability_state!=="NOT_DETERMINED"||candidate.control_state!=="PROPOSED_NOT_IMPLEMENTED"
      ||!text(candidate.control_candidate,240)||!Array.isArray(candidate.limitations)||candidate.limitations.length>4||candidate.limitations.some(value=>!text(value,240))
      ||!candidate.provision||!candidate.action||!obligationFields.every(field=>candidate[field]!==undefined&&(field==="action"||candidate[field]===null||typeof candidate[field]==="object"))
      ||!obligationLists.every(field=>Array.isArray(candidate[field])&&candidate[field].length<=4))return false;
    for(const anchor of obligationAnchors(candidate)) {
      if(!anchor||!text(anchor.quote,300)||!Number.isSafeInteger(anchor.quote_start)||anchor.quote_start<0||anchor.quote_end!==anchor.quote_start+Array.from(anchor.quote).length)return false;
      const original=originals.get(anchor.citation_id);
      if(!original||original.source.document_id!==anchor.document_id||original.characters.slice(anchor.quote_start,anchor.quote_end).join("")!==anchor.quote)return false;
      used.add(anchor.citation_id);
    }
    const source=originals.get(candidate.provision.citation_id)!.source;
    const identity=`${source.version_id}:${source.chunk_id}:${candidate.provision.quote_start}:${candidate.provision.quote_end}`;
    if(provisions.has(identity))return false;
    provisions.add(identity);
  }
  const rejected=new Set<number>();
  for(const rejection of analysis.rejections) {
    if(!rejection||!Number.isSafeInteger(rejection.candidate_index)||rejection.candidate_index<0||rejection.candidate_index>=analysis.candidates.length+analysis.rejections.length
      ||!["INVALID_SOURCE_ANCHOR","DUPLICATE_PROVISION"].includes(rejection.reason)||rejected.has(rejection.candidate_index))return false;
    rejected.add(rejection.candidate_index);
  }
  let receiptCount=0;
  for(const [i,document] of analysis.documents.entries()) {
    if(!document||document.document_id!==snapshot[i].document_id||typeof document.filename!=="string"||!Array.isArray(document.consulted_sources))return false;
    receiptCount+=document.consulted_sources.length;
    const state=analysis.candidates.some(candidate=>obligationAnchors(candidate).some(anchor=>anchor.document_id===document.document_id))?"CANDIDATE":
      document.consulted_sources.length?"NO_CANDIDATE_PROPOSED":"NO_INDEXED_EVIDENCE";
    if(document.evidence_state!==state||!document.consulted_sources.every(receipt=>receipt&&receipt.version_id===snapshot[i].version_id&&uuid(receipt.chunk_id)
      &&/^[a-f0-9]{64}$/.test(receipt.original_content_hash)&&Number.isSafeInteger(receipt.chunk_index)&&receipt.chunk_index>=0
      &&(receipt.page_number===null||Number.isSafeInteger(receipt.page_number)&&receipt.page_number>=0)))return false;
  }
  return receiptCount<=50&&result.sources.length===used.size&&result.sources.every(source=>analysis.documents.some(document=>document.document_id===source.document_id&&document.consulted_sources.some(receipt=>receipt.version_id===source.version_id
      &&receipt.chunk_id===source.chunk_id&&receipt.original_content_hash===source.original_content_hash)))
    &&result.validated_citation_ids.length===used.size&&result.validated_citation_ids.every((id,i)=>id===result.sources[i].citation_id&&used.has(id))
    &&result.abstained===(analysis.candidates.length===0)&&result.claim_state===(analysis.candidates.length?"REVIEW_REQUIRED":"UNSUPPORTED");
}
export function confirmedObligations(result:ResearchRunResult,index:number,run:ResearchRun) {
  return confirmedObligationResult(result,index,run.source_snapshot);
}
