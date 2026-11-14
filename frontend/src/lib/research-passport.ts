import type {ResearchQuoteAnchor,ResearchRun,ResearchRunResult} from "./research-run";
import {normalizePassportSubject,passportSubjectFields,type PassportSubject} from "./product-passport-subject";

export const passportKinds=["COMPONENT","CERTIFICATE","TEST","DECLARATION","OBLIGATION","SBOM","LICENCE","VEX","OTHER"] as const;
export const passportStatuses=["ASSERTED_BY_SUPPLIER","PUBLIC_SOURCE","INFERRED","CONTRADICTED","EXPIRED","REVOKED"] as const;
export type PassportClaim={kind:typeof passportKinds[number];property:string;value:string;status:typeof passportStatuses[number];
  evidence:ResearchQuoteAnchor[];qualifications:string[];claim_state:"REVIEW_REQUIRED";status_state:"PROPOSED_NOT_VERIFIED";subject_match:"NOT_VERIFIED"};
export type ResearchPassport={schema_version:"research-passport/1";criterion_index:number;total_documents:number;subject:PassportSubject;
  claims:PassportClaim[];gaps:Array<{document_id:string|null;description:string;state:"FOLLOW_UP_REQUIRED_NOT_ABSENCE_PROOF"}>;
  documents:Array<{document_id:string;filename:string;evidence_state:"CLAIM_PROPOSED"|"NO_CLAIM_PROPOSED"|"NO_INDEXED_EVIDENCE";
    consulted_sources:Array<{version_id:string;chunk_id:string;original_content_hash:string;page_number:number|null;chunk_index:number}>}>;
  rejections:Array<{claim_index:number;reason:"UNCONFIRMED_SOURCE_ANCHOR"|"REPEATED_CLAIM"}>;
  interpretation:"INDEPENDENT_REVIEW_NO_CERTIFICATION_OR_VERIFIED_PRODUCT_MATCH";coverage:"BOUNDED_SOURCE_REVIEW_NOT_COMPLETE_PRODUCT_PASSPORT"};
const uuid=(value:unknown)=>typeof value==="string"&&/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const text=(value:unknown,max:number):value is string=>typeof value==="string"&&!!value.trim()&&!value.includes("\0")&&Array.from(value).length<=max;
export function confirmedPassportSubject(value:unknown):value is PassportSubject {
  try {const subject=normalizePassportSubject(value);return passportSubjectFields.every(([field])=>subject[field]===(value as PassportSubject)[field]);}
  catch{return false;}
}
export function confirmedPassport(result:ResearchRunResult,index:number,run:ResearchRun) {
  const analysis=result.passport,snapshot=run.source_snapshot;
  if(!analysis||!snapshot||analysis.schema_version!=="research-passport/1"||analysis.criterion_index!==index||analysis.total_documents!==snapshot.length
    ||analysis.interpretation!=="INDEPENDENT_REVIEW_NO_CERTIFICATION_OR_VERIFIED_PRODUCT_MATCH"||analysis.coverage!=="BOUNDED_SOURCE_REVIEW_NOT_COMPLETE_PRODUCT_PASSPORT"
    ||!confirmedPassportSubject(analysis.subject)||!confirmedPassportSubject(run.passport_subject)
    ||passportSubjectFields.some(([field])=>analysis.subject[field]!==run.passport_subject![field])
    ||!Array.isArray(analysis.claims)||analysis.claims.length>12||!Array.isArray(analysis.gaps)||analysis.gaps.length>12
    ||!Array.isArray(analysis.rejections)||analysis.rejections.length+analysis.claims.length>12
    ||!Array.isArray(analysis.documents)||analysis.documents.length!==snapshot.length)return false;
  const originals=new Map<string,{source:ResearchRunResult["sources"][number];characters:string[]}>();
  for(const source of result.sources){const characters=Array.from(source.content);
    if(characters.length<1||characters.length>1200||originals.has(source.citation_id))return false;
    originals.set(source.citation_id,{source,characters});}
  const used=new Set<string>(),claims=new Set<string>();
  for(const row of analysis.claims) {
    if(!row||!passportKinds.includes(row.kind)||!passportStatuses.includes(row.status)||!text(row.property,128)||!text(row.value,240)
      ||row.claim_state!=="REVIEW_REQUIRED"||row.status_state!=="PROPOSED_NOT_VERIFIED"||row.subject_match!=="NOT_VERIFIED"
      ||!Array.isArray(row.evidence)||row.evidence.length<1||row.evidence.length>4
      ||!Array.isArray(row.qualifications)||row.qualifications.length<1||row.qualifications.length>4||row.qualifications.some(value=>!text(value,240)))return false;
    const keys:string[]=[],ranges:Array<{version:string;chunk:string;start:number;end:number}>=[];
    for(const anchor of row.evidence) {
      if(!anchor||!text(anchor.quote,300)||!Number.isSafeInteger(anchor.quote_start)||anchor.quote_start<0
        ||anchor.quote_end!==anchor.quote_start+Array.from(anchor.quote).length)return false;
      const original=originals.get(anchor.citation_id);
      if(!original||original.source.document_id!==anchor.document_id||original.characters.slice(anchor.quote_start,anchor.quote_end).join("")!==anchor.quote)return false;
      keys.push(`${anchor.document_id}:${anchor.citation_id}:${anchor.quote_start}:${anchor.quote_end}`);used.add(anchor.citation_id);
      const range={version:original.source.version_id,chunk:original.source.chunk_id,start:anchor.quote_start,end:anchor.quote_end};
      if(row.status==="CONTRADICTED"&&ranges.some(prior=>prior.version===range.version&&prior.chunk===range.chunk&&prior.start<range.end&&range.start<prior.end))return false;
      ranges.push(range);
    }
    if(new Set(keys).size!==keys.length||row.status==="CONTRADICTED"&&keys.length<2)return false;
    const key=JSON.stringify([row.kind,row.property,row.value,row.status,keys.sort()]);if(claims.has(key))return false;claims.add(key);
  }
  const rejected=new Set<number>();
  for(const row of analysis.rejections) {
    if(!row||!Number.isSafeInteger(row.claim_index)||row.claim_index<0||row.claim_index>=analysis.claims.length+analysis.rejections.length
      ||!["UNCONFIRMED_SOURCE_ANCHOR","REPEATED_CLAIM"].includes(row.reason)||rejected.has(row.claim_index))return false;
    rejected.add(row.claim_index);
  }
  if(analysis.gaps.some(row=>!row||!text(row.description,240)||row.state!=="FOLLOW_UP_REQUIRED_NOT_ABSENCE_PROOF"
    ||row.document_id!==null&&!snapshot.some(source=>source.document_id===row.document_id)))return false;
  let count=0;
  for(const [i,doc] of analysis.documents.entries()) {
    if(!doc||doc.document_id!==snapshot[i].document_id||typeof doc.filename!=="string"||!Array.isArray(doc.consulted_sources))return false;
    count+=doc.consulted_sources.length;
    const state=analysis.claims.some(row=>row.evidence.some(anchor=>anchor.document_id===doc.document_id))?"CLAIM_PROPOSED":
      doc.consulted_sources.length?"NO_CLAIM_PROPOSED":"NO_INDEXED_EVIDENCE";
    if(doc.evidence_state!==state||!doc.consulted_sources.every(receipt=>receipt&&receipt.version_id===snapshot[i].version_id&&uuid(receipt.chunk_id)
      &&/^[a-f0-9]{64}$/.test(receipt.original_content_hash)&&Number.isSafeInteger(receipt.chunk_index)&&receipt.chunk_index>=0
      &&(receipt.page_number===null||Number.isSafeInteger(receipt.page_number)&&receipt.page_number>=0)))return false;
  }
  return count<=60&&result.sources.length===used.size&&result.sources.every(source=>analysis.documents.some(doc=>doc.document_id===source.document_id
    &&doc.consulted_sources.some(receipt=>receipt.version_id===source.version_id&&receipt.chunk_id===source.chunk_id&&receipt.original_content_hash===source.original_content_hash)))
    &&result.validated_citation_ids.length===used.size&&result.validated_citation_ids.every((id,i)=>id===result.sources[i].citation_id&&used.has(id))
    &&result.abstained===(analysis.claims.length===0)&&result.claim_state===(analysis.claims.length?"REVIEW_REQUIRED":"UNSUPPORTED");
}
