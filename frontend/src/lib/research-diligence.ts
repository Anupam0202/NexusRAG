import type {ResearchQuoteAnchor,ResearchRun,ResearchRunResult} from "./research-run";

export const diligenceTopics=["IDENTITY","OWNERSHIP","FILINGS","OBLIGATIONS","OPERATIONS","SOURCE_DISCREPANCY","OTHER"] as const;
export type DiligenceObservation={topic:typeof diligenceTopics[number];summary:string;evidence:ResearchQuoteAnchor[];limitations:string[];
  claim_state:"REVIEW_REQUIRED";identity_state:"NOT_RESOLVED";decision_state:"NO_AUTOMATIC_ADVERSE_DECISION"};
export type ResearchDiligence={schema_version:"research-diligence/1";criterion_index:number;total_documents:number;requested_targets:string[];
  observations:DiligenceObservation[];gaps:Array<{document_id:string|null;description:string;state:"FOLLOW_UP_REQUIRED_NOT_ABSENCE_PROOF"}>;
  documents:Array<{document_id:string;filename:string;evidence_state:"OBSERVATION"|"NO_OBSERVATION_PROPOSED"|"NO_INDEXED_EVIDENCE";
    consulted_sources:Array<{version_id:string;chunk_id:string;original_content_hash:string;page_number:number|null;chunk_index:number}>}>;
  rejections:Array<{observation_index:number;reason:"UNCONFIRMED_SOURCE_ANCHOR"|"REPEATED_OBSERVATION"}>;
  interpretation:"INDEPENDENT_REVIEW_NO_VERIFIED_IDENTITY_OR_ADVERSE_DECISION";coverage:"BOUNDED_SOURCE_REVIEW_NOT_COMPLETE_DUE_DILIGENCE"};
const uuid=(value:unknown)=>typeof value==="string"&&/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const text=(value:unknown,max:number):value is string=>typeof value==="string"&&!!value.trim()&&!value.includes("\0")&&Array.from(value).length<=max;
export function confirmedDiligence(result:ResearchRunResult,index:number,run:ResearchRun) {
  const analysis=result.diligence,snapshot=run.source_snapshot;
  if(!analysis||!snapshot||analysis.schema_version!=="research-diligence/1"||analysis.criterion_index!==index||analysis.total_documents!==snapshot.length
    ||analysis.interpretation!=="INDEPENDENT_REVIEW_NO_VERIFIED_IDENTITY_OR_ADVERSE_DECISION"||analysis.coverage!=="BOUNDED_SOURCE_REVIEW_NOT_COMPLETE_DUE_DILIGENCE"
    ||!Array.isArray(analysis.requested_targets)||!Array.isArray(run.entity_scope)||analysis.requested_targets.length!==run.entity_scope.length
    ||analysis.requested_targets.length>100||analysis.requested_targets.some((target,i)=>target!==run.entity_scope![i]||!text(target,128))
    ||!Array.isArray(analysis.observations)||analysis.observations.length>12||!Array.isArray(analysis.gaps)||analysis.gaps.length>12
    ||!Array.isArray(analysis.rejections)||analysis.rejections.length+analysis.observations.length>12
    ||!Array.isArray(analysis.documents)||analysis.documents.length!==snapshot.length)return false;
  const originals=new Map<string,{source:ResearchRunResult["sources"][number];characters:string[]}>();
  for(const source of result.sources){const characters=Array.from(source.content);
    if(characters.length<1||characters.length>1200||originals.has(source.citation_id))return false;
    originals.set(source.citation_id,{source,characters});}
  const used=new Set<string>(),observations=new Set<string>();
  for(const row of analysis.observations) {
    if(!row||!diligenceTopics.includes(row.topic)||!text(row.summary,240)||row.claim_state!=="REVIEW_REQUIRED"||row.identity_state!=="NOT_RESOLVED"
      ||row.decision_state!=="NO_AUTOMATIC_ADVERSE_DECISION"||!Array.isArray(row.evidence)||row.evidence.length<1||row.evidence.length>4
      ||!Array.isArray(row.limitations)||row.limitations.length<1||row.limitations.length>4||row.limitations.some(value=>!text(value,240)))return false;
    const keys:string[]=[];
    for(const anchor of row.evidence) {
      if(!anchor||!text(anchor.quote,300)||!Number.isSafeInteger(anchor.quote_start)||anchor.quote_start<0
        ||anchor.quote_end!==anchor.quote_start+Array.from(anchor.quote).length)return false;
      const original=originals.get(anchor.citation_id);
      if(!original||original.source.document_id!==anchor.document_id||original.characters.slice(anchor.quote_start,anchor.quote_end).join("")!==anchor.quote)return false;
      keys.push(`${anchor.document_id}:${anchor.citation_id}:${anchor.quote_start}:${anchor.quote_end}`);used.add(anchor.citation_id);
    }
    if(new Set(keys).size!==keys.length||row.topic==="SOURCE_DISCREPANCY"&&keys.length<2)return false;
    const key=JSON.stringify([row.topic,row.summary,keys.sort()]);if(observations.has(key))return false;observations.add(key);
  }
  const rejected=new Set<number>();
  for(const row of analysis.rejections) {
    if(!row||!Number.isSafeInteger(row.observation_index)||row.observation_index<0||row.observation_index>=analysis.observations.length+analysis.rejections.length
      ||!["UNCONFIRMED_SOURCE_ANCHOR","REPEATED_OBSERVATION"].includes(row.reason)||rejected.has(row.observation_index))return false;
    rejected.add(row.observation_index);
  }
  if(analysis.gaps.some(row=>!row||!text(row.description,240)||row.state!=="FOLLOW_UP_REQUIRED_NOT_ABSENCE_PROOF"
    ||row.document_id!==null&&!snapshot.some(source=>source.document_id===row.document_id)))return false;
  let count=0;
  for(const [i,doc] of analysis.documents.entries()) {
    if(!doc||doc.document_id!==snapshot[i].document_id||typeof doc.filename!=="string"||!Array.isArray(doc.consulted_sources))return false;
    count+=doc.consulted_sources.length;
    const state=analysis.observations.some(row=>row.evidence.some(anchor=>anchor.document_id===doc.document_id))?"OBSERVATION":
      doc.consulted_sources.length?"NO_OBSERVATION_PROPOSED":"NO_INDEXED_EVIDENCE";
    if(doc.evidence_state!==state||!doc.consulted_sources.every(receipt=>receipt&&receipt.version_id===snapshot[i].version_id&&uuid(receipt.chunk_id)
      &&/^[a-f0-9]{64}$/.test(receipt.original_content_hash)&&Number.isSafeInteger(receipt.chunk_index)&&receipt.chunk_index>=0
      &&(receipt.page_number===null||Number.isSafeInteger(receipt.page_number)&&receipt.page_number>=0)))return false;
  }
  return count<=60&&result.sources.length===used.size&&result.sources.every(source=>analysis.documents.some(doc=>doc.document_id===source.document_id
    &&doc.consulted_sources.some(receipt=>receipt.version_id===source.version_id&&receipt.chunk_id===source.chunk_id&&receipt.original_content_hash===source.original_content_hash)))
    &&result.validated_citation_ids.length===used.size&&result.validated_citation_ids.every((id,i)=>id===result.sources[i].citation_id&&used.has(id))
    &&result.abstained===(analysis.observations.length===0)&&result.claim_state===(analysis.observations.length?"REVIEW_REQUIRED":"UNSUPPORTED");
}
