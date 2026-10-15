export type ResearchRunResult = {
  question:string;answer:string;claim_state:"REVIEW_REQUIRED"|"UNSUPPORTED";abstained:boolean;
  sources:Array<{citation_id:string;document_id:string;version_id:string;chunk_id:string;filename:string;content:string;
    original_content_hash:string;location:unknown;page_number:number;chunk_index:number;excerpt:boolean}>;
  validated_citation_ids:string[];model:string|null;coverage:{completeness:string;chunks_considered:number};
  provider_cost_status:string;review_state:string;
};
export type ResearchRun = {
  id:string;plan_id:string;workspace_id:string;owner_id:string;schema_version:"research-run/1";persistence_state:"PERSISTED";
  state:"queued"|"running"|"interrupted"|"completed"|"cancelled";generation:number;position:number;questions:string[];
  results:ResearchRunResult[];source_state:"CURRENT"|"UNAVAILABLE_OR_CHANGED";error_code:string|null;created_at:string;
  dispatch_state?:"ENQUEUED"|"PENDING_RECOVERY";
};
const uuid=(value:unknown)=>typeof value==="string"&&/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
export function confirmedResearchRun(value:unknown,planId:string):value is ResearchRun {
  if(!value||typeof value!=="object")return false;
  const row=value as ResearchRun;
  return uuid(row.id)&&row.plan_id===planId&&uuid(row.workspace_id)&&uuid(row.owner_id)&&row.schema_version==="research-run/1"&&row.persistence_state==="PERSISTED"
    &&["queued","running","interrupted","completed","cancelled"].includes(row.state)&&Number.isSafeInteger(row.generation)&&row.generation>=1&&row.generation<=10
    &&Array.isArray(row.questions)&&row.questions.length>=1&&row.questions.length<=5&&row.questions.every(q=>typeof q==="string"&&q.length>0&&q.length<=10000)
    &&Number.isSafeInteger(row.position)&&row.position>=0&&row.position<=row.questions.length&&Array.isArray(row.results)
    &&["CURRENT","UNAVAILABLE_OR_CHANGED"].includes(row.source_state)&&(row.source_state==="CURRENT"?row.results.length===row.position:row.results.length===0)
    &&(row.state!=="completed"||row.position===row.questions.length)&&row.results.every((result,index)=>result.question===row.questions[index]
      &&typeof result.answer==="string"&&result.answer.length>0&&result.answer.length<=16000&&["REVIEW_REQUIRED","UNSUPPORTED"].includes(result.claim_state)
      &&typeof result.abstained==="boolean"&&Array.isArray(result.sources)&&result.sources.length<=12
      &&result.coverage?.completeness==="NOT_EXHAUSTIVE"&&Number.isSafeInteger(result.coverage.chunks_considered)&&result.coverage.chunks_considered>=0&&result.coverage.chunks_considered<=200
      &&["UNKNOWN","NOT_CALLED"].includes(result.provider_cost_status)&&result.review_state==="COMPLETION_CRITERIA_NOT_AUTOMATICALLY_VERIFIED"
      &&result.sources.every((source,i)=>source.citation_id===`S${i+1}`&&uuid(source.document_id)&&uuid(source.version_id)&&uuid(source.chunk_id)
        &&typeof source.filename==="string"&&typeof source.content==="string"&&/^[a-f0-9]{64}$/.test(source.original_content_hash))
      &&Array.isArray(result.validated_citation_ids)&&result.validated_citation_ids.every(id=>result.sources.some(source=>source.citation_id===id)));
}
