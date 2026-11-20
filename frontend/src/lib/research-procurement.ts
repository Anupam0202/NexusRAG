import type {ResearchQuoteAnchor,ResearchRun,ResearchRunResult} from "./research-run";

export const procurementKinds=["OPPORTUNITY","TENDER","GRANT","AWARD","AMENDMENT","OTHER"] as const;
export const procurementFields=["notice_id","title","buyer","supplier","lot","value","currency","deadline","lifecycle_status","classification","jurisdiction","source_date","amendment_of"] as const;
export type ProcurementField=typeof procurementFields[number];
export type ProcurementRecord={kind:typeof procurementKinds[number];source_document_id:string;source_version_id:string;
  fields:Partial<Record<ProcurementField,ResearchQuoteAnchor>>&{notice_id:ResearchQuoteAnchor};limitations:string[];
  claim_state:"REVIEW_REQUIRED";record_state:"PROPOSED_NOT_VERIFIED";value_interpretation:"SOURCE_WORDING_NO_IMPLICIT_CONVERSION";
  deadline_interpretation:"SOURCE_WORDING_NOT_CURRENT_ELIGIBILITY";decision_state:"NO_AUTOMATIC_ELIGIBILITY_AWARD_OR_RANKING"};
export type ResearchProcurement={schema_version:"research-procurement/1";criterion_index:number;total_documents:number;records:ProcurementRecord[];
  gaps:Array<{document_id:string|null;description:string;state:"FOLLOW_UP_REQUIRED_NOT_ABSENCE_PROOF"}>;
  documents:Array<{document_id:string;filename:string;evidence_state:"RECORD_PROPOSED"|"NO_RECORD_PROPOSED"|"NO_INDEXED_EVIDENCE";
    consulted_sources:Array<{version_id:string;chunk_id:string;original_content_hash:string;page_number:number|null;chunk_index:number}>}>;
  rejections:Array<{record_index:number;reason:"UNCONFIRMED_SOURCE_ANCHOR"|"CROSS_DOCUMENT_RECORD_FIELDS"|"REPEATED_RECORD"}>;
  interpretation:"INDEPENDENT_REVIEW_NO_AUTOMATIC_ELIGIBILITY_AWARD_OR_RANKING";coverage:"BOUNDED_SOURCE_REVIEW_NOT_COMPLETE_PROCUREMENT_GRAPH"};
const uuid=(value:unknown)=>typeof value==="string"&&/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const text=(value:unknown,max:number):value is string=>typeof value==="string"&&!!value.trim()&&!value.includes("\0")&&Array.from(value).length<=max;
export function confirmedProcurement(result:ResearchRunResult,index:number,run:ResearchRun) {
  const analysis=result.procurement,snapshot=run.source_snapshot;
  if(!analysis||!snapshot||analysis.schema_version!=="research-procurement/1"||analysis.criterion_index!==index||analysis.total_documents!==snapshot.length
    ||analysis.interpretation!=="INDEPENDENT_REVIEW_NO_AUTOMATIC_ELIGIBILITY_AWARD_OR_RANKING"||analysis.coverage!=="BOUNDED_SOURCE_REVIEW_NOT_COMPLETE_PROCUREMENT_GRAPH"
    ||!Array.isArray(analysis.records)||analysis.records.length>12||!Array.isArray(analysis.gaps)||analysis.gaps.length>12
    ||!Array.isArray(analysis.rejections)||analysis.rejections.length+analysis.records.length>12
    ||!Array.isArray(analysis.documents)||analysis.documents.length!==snapshot.length)return false;
  const originals=new Map<string,{source:ResearchRunResult["sources"][number];characters:string[]}>();
  for(const source of result.sources){const characters=Array.from(source.content);
    if(characters.length<1||characters.length>1200||originals.has(source.citation_id))return false;
    originals.set(source.citation_id,{source,characters});}
  const used=new Set<string>(),records=new Set<string>();
  for(const row of analysis.records) {
    if(!row||!procurementKinds.includes(row.kind)||!uuid(row.source_document_id)||!uuid(row.source_version_id)
      ||row.claim_state!=="REVIEW_REQUIRED"||row.record_state!=="PROPOSED_NOT_VERIFIED"||row.value_interpretation!=="SOURCE_WORDING_NO_IMPLICIT_CONVERSION"
      ||row.deadline_interpretation!=="SOURCE_WORDING_NOT_CURRENT_ELIGIBILITY"||row.decision_state!=="NO_AUTOMATIC_ELIGIBILITY_AWARD_OR_RANKING"
      ||!row.fields||typeof row.fields!=="object"||Array.isArray(row.fields)||!Object.hasOwn(row.fields,"notice_id")
      ||Object.keys(row.fields).some(key=>!procurementFields.includes(key as ProcurementField))
      ||!Array.isArray(row.limitations)||row.limitations.length<1||row.limitations.length>4||row.limitations.some(value=>!text(value,240)))return false;
    const keys:Array<[string,string,number,number]>=[];
    for(const [field,anchor] of Object.entries(row.fields)) {
      if(!anchor||!text(anchor.quote,300)||!Number.isSafeInteger(anchor.quote_start)||anchor.quote_start<0
        ||anchor.quote_end!==anchor.quote_start+Array.from(anchor.quote).length)return false;
      const original=originals.get(anchor.citation_id);
      if(!original||original.source.document_id!==anchor.document_id||anchor.document_id!==row.source_document_id||original.source.version_id!==row.source_version_id
        ||original.characters.slice(anchor.quote_start,anchor.quote_end).join("")!==anchor.quote)return false;
      keys.push([field,anchor.citation_id,anchor.quote_start,anchor.quote_end]);used.add(anchor.citation_id);
    }
    keys.sort(([a],[b])=>a.localeCompare(b));
    const key=JSON.stringify([row.source_document_id,row.source_version_id,row.kind,keys,[...row.limitations].sort()]);
    if(records.has(key))return false;records.add(key);
  }
  const rejected=new Set<number>();
  for(const row of analysis.rejections){
    if(!row||!Number.isSafeInteger(row.record_index)||row.record_index<0||row.record_index>=analysis.records.length+analysis.rejections.length
      ||!["UNCONFIRMED_SOURCE_ANCHOR","CROSS_DOCUMENT_RECORD_FIELDS","REPEATED_RECORD"].includes(row.reason)||rejected.has(row.record_index))return false;
    rejected.add(row.record_index);
  }
  if(analysis.gaps.some(row=>!row||!text(row.description,240)||row.state!=="FOLLOW_UP_REQUIRED_NOT_ABSENCE_PROOF"
    ||row.document_id!==null&&!snapshot.some(source=>source.document_id===row.document_id)))return false;
  let count=0;
  for(const [i,doc] of analysis.documents.entries()){
    if(!doc||doc.document_id!==snapshot[i].document_id||typeof doc.filename!=="string"||!Array.isArray(doc.consulted_sources))return false;
    count+=doc.consulted_sources.length;
    const state=analysis.records.some(row=>row.source_document_id===doc.document_id)?"RECORD_PROPOSED":doc.consulted_sources.length?"NO_RECORD_PROPOSED":"NO_INDEXED_EVIDENCE";
    if(doc.evidence_state!==state||!doc.consulted_sources.every(receipt=>receipt&&receipt.version_id===snapshot[i].version_id&&uuid(receipt.chunk_id)
      &&/^[a-f0-9]{64}$/.test(receipt.original_content_hash)&&Number.isSafeInteger(receipt.chunk_index)&&receipt.chunk_index>=0
      &&(receipt.page_number===null||Number.isSafeInteger(receipt.page_number)&&receipt.page_number>=0)))return false;
  }
  return count<=50&&result.sources.length===used.size&&result.sources.every(source=>analysis.documents.some(doc=>doc.document_id===source.document_id
    &&doc.consulted_sources.some(receipt=>receipt.version_id===source.version_id&&receipt.chunk_id===source.chunk_id&&receipt.original_content_hash===source.original_content_hash
      &&receipt.page_number===source.page_number&&receipt.chunk_index===source.chunk_index)))
    &&result.validated_citation_ids.length===used.size&&result.validated_citation_ids.every((id,i)=>id===result.sources[i].citation_id&&used.has(id))
    &&result.abstained===(analysis.records.length===0)&&result.claim_state===(analysis.records.length?"REVIEW_REQUIRED":"UNSUPPORTED");
}
