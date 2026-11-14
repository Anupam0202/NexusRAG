import type {ResearchQuoteAnchor,ResearchRun,ResearchRunResult} from "./research-run";

export const entityFields=["jurisdiction","valid_from","valid_to"] as const;
export const entityLists=["identifiers","aliases","filings"] as const;
export const entityRelationshipFields=["statement","subject","predicate","object","valid_from","valid_to"] as const;
export type EntityRelationship={statement:ResearchQuoteAnchor;subject:ResearchQuoteAnchor;predicate:ResearchQuoteAnchor;object:ResearchQuoteAnchor;
  valid_from:ResearchQuoteAnchor|null;valid_to:ResearchQuoteAnchor|null;claim_state:"REVIEW_REQUIRED";identity_state:"NOT_RESOLVED"};
export type EntityCandidate={name:ResearchQuoteAnchor;relationships:EntityRelationship[];limitations:string[];claim_state:"REVIEW_REQUIRED";
  identity_state:"NOT_RESOLVED";confidence_state:"NOT_CALIBRATED";decision_state:"NO_AUTOMATIC_ADVERSE_DECISION"}
  &Record<typeof entityFields[number],ResearchQuoteAnchor|null>&Record<typeof entityLists[number],ResearchQuoteAnchor[]>;
export type ResearchEntities={schema_version:"research-entities/1";criterion_index:number;total_documents:number;requested_targets:string[];
  candidates:EntityCandidate[];documents:Array<{document_id:string;filename:string;evidence_state:"CANDIDATE"|"NO_CANDIDATE_PROPOSED"|"NO_INDEXED_EVIDENCE";
    consulted_sources:Array<{version_id:string;chunk_id:string;original_content_hash:string;page_number:number|null;chunk_index:number}>}>;
  rejections:Array<{candidate_index:number;reason:"INVALID_SOURCE_ANCHOR_OR_RELATIONSHIP_STATEMENT"|"DUPLICATE_NAME_ANCHOR"}>;
  interpretation:"REVIEW_REQUIRED_NO_VERIFIED_IDENTITY_OR_ADVERSE_DECISION";coverage:"BOUNDED_RETRIEVAL_NOT_COMPLETE_ENTITY_REGISTER"};
export function entityAnchors(candidate:EntityCandidate) {
  return [candidate.name,...entityFields.flatMap(field=>candidate[field]?[candidate[field]!]:[]),...entityLists.flatMap(field=>candidate[field]),
    ...candidate.relationships.flatMap(relationship=>entityRelationshipFields.flatMap(field=>relationship[field]?[relationship[field]!]:[]))];
}
const uuid=(value:unknown)=>typeof value==="string"&&/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const text=(value:unknown,max:number):value is string=>typeof value==="string"&&!!value.trim()&&Array.from(value).length<=max&&!value.includes("\0");
export function confirmedEntities(result:ResearchRunResult,index:number,run:ResearchRun) {
  const analysis=result.entities,snapshot=run.source_snapshot;
  if(!analysis||!snapshot||analysis.schema_version!=="research-entities/1"||analysis.criterion_index!==index||analysis.total_documents!==snapshot.length
    ||analysis.interpretation!=="REVIEW_REQUIRED_NO_VERIFIED_IDENTITY_OR_ADVERSE_DECISION"||analysis.coverage!=="BOUNDED_RETRIEVAL_NOT_COMPLETE_ENTITY_REGISTER"
    ||!Array.isArray(analysis.requested_targets)||!Array.isArray(run.entity_scope)||analysis.requested_targets.length!==run.entity_scope.length
    ||analysis.requested_targets.some((target,i)=>target!==run.entity_scope![i])||analysis.requested_targets.length>100
    ||analysis.requested_targets.some(target=>!text(target,128))||!Array.isArray(analysis.candidates)||analysis.candidates.length>12
    ||!Array.isArray(analysis.rejections)||analysis.rejections.length+analysis.candidates.length>12
    ||!Array.isArray(analysis.documents)||analysis.documents.length!==snapshot.length)return false;
  const originals=new Map<string,{source:ResearchRunResult["sources"][number];characters:string[]}>();
  for(const source of result.sources){const characters=Array.from(source.content);
    if(characters.length<1||characters.length>1200||originals.has(source.citation_id))return false;
    originals.set(source.citation_id,{source,characters});}
  const used=new Set<string>(),names=new Set<string>();
  for(const candidate of analysis.candidates) {
    if(!candidate||!candidate.name||candidate.claim_state!=="REVIEW_REQUIRED"||candidate.identity_state!=="NOT_RESOLVED"
      ||candidate.confidence_state!=="NOT_CALIBRATED"||candidate.decision_state!=="NO_AUTOMATIC_ADVERSE_DECISION"
      ||!Array.isArray(candidate.limitations)||candidate.limitations.length>4||candidate.limitations.some(value=>!text(value,240))
      ||!entityFields.every(field=>candidate[field]!==undefined&&(candidate[field]===null||typeof candidate[field]==="object"))
      ||!entityLists.every(field=>Array.isArray(candidate[field])&&candidate[field].length<=4)
      ||!Array.isArray(candidate.relationships)||candidate.relationships.length>4)return false;
    for(const relationship of candidate.relationships) {
      const statement=relationship?.statement;
      if(!statement||relationship.claim_state!=="REVIEW_REQUIRED"||relationship.identity_state!=="NOT_RESOLVED"
        ||!entityRelationshipFields.every(field=>{const item=relationship[field];return item===null&&["valid_from","valid_to"].includes(field)
          ||!!item&&item.citation_id===statement.citation_id&&item.document_id===statement.document_id
            &&item.quote_start>=statement.quote_start&&item.quote_end<=statement.quote_end;}))return false;
    }
    for(const anchor of entityAnchors(candidate)) {
      if(!anchor||!text(anchor.quote,300)||!Number.isSafeInteger(anchor.quote_start)||anchor.quote_start<0
        ||anchor.quote_end!==anchor.quote_start+Array.from(anchor.quote).length)return false;
      const original=originals.get(anchor.citation_id);
      if(!original||original.source.document_id!==anchor.document_id||original.characters.slice(anchor.quote_start,anchor.quote_end).join("")!==anchor.quote)return false;
      used.add(anchor.citation_id);
    }
    const source=originals.get(candidate.name.citation_id)!.source,key=`${source.version_id}:${source.chunk_id}:${candidate.name.quote_start}:${candidate.name.quote_end}`;
    if(names.has(key))return false;names.add(key);
  }
  const rejected=new Set<number>();
  for(const item of analysis.rejections) {
    if(!item||!Number.isSafeInteger(item.candidate_index)||item.candidate_index<0||item.candidate_index>=analysis.candidates.length+analysis.rejections.length
      ||!["INVALID_SOURCE_ANCHOR_OR_RELATIONSHIP_STATEMENT","DUPLICATE_NAME_ANCHOR"].includes(item.reason)||rejected.has(item.candidate_index))return false;
    rejected.add(item.candidate_index);
  }
  let receiptCount=0;
  for(const [i,document] of analysis.documents.entries()) {
    if(!document||document.document_id!==snapshot[i].document_id||typeof document.filename!=="string"||!Array.isArray(document.consulted_sources))return false;
    receiptCount+=document.consulted_sources.length;
    const state=analysis.candidates.some(candidate=>entityAnchors(candidate).some(anchor=>anchor.document_id===document.document_id))?"CANDIDATE":
      document.consulted_sources.length?"NO_CANDIDATE_PROPOSED":"NO_INDEXED_EVIDENCE";
    if(document.evidence_state!==state||!document.consulted_sources.every(receipt=>receipt&&receipt.version_id===snapshot[i].version_id&&uuid(receipt.chunk_id)
      &&/^[a-f0-9]{64}$/.test(receipt.original_content_hash)&&Number.isSafeInteger(receipt.chunk_index)&&receipt.chunk_index>=0
      &&(receipt.page_number===null||Number.isSafeInteger(receipt.page_number)&&receipt.page_number>=0)))return false;
  }
  return receiptCount<=50&&result.sources.length===used.size&&result.sources.every(source=>analysis.documents.some(document=>document.document_id===source.document_id
    &&document.consulted_sources.some(receipt=>receipt.version_id===source.version_id&&receipt.chunk_id===source.chunk_id&&receipt.original_content_hash===source.original_content_hash)))
    &&result.validated_citation_ids.length===used.size&&result.validated_citation_ids.every((id,i)=>id===result.sources[i].citation_id&&used.has(id))
    &&result.abstained===(analysis.candidates.length===0)&&result.claim_state===(analysis.candidates.length?"REVIEW_REQUIRED":"UNSUPPORTED");
}
