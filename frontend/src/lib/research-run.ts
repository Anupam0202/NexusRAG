export type ResearchComparison={schema_version:"research-comparison/1";criterion_index:number;batch_index:number;batch_count:number;total_documents:number;
  cells:Array<{document_id:string;filename:string;answer:string;claim_state:"REVIEW_REQUIRED"|"UNSUPPORTED";abstained:boolean;validated_citation_ids:string[];gap:string|null}>;
  interpretation:"REVIEW_REQUIRED_NO_AUTOMATIC_EQUIVALENCE_OR_RANKING"};
export type ResearchTimeline={schema_version:"research-timeline/1";criterion_index:number;batch_index:number;batch_count:number;total_documents:number;
  events:Array<{document_id:string;filename:string;citation_id:string;quote:string;quote_start:number;quote_end:number;date_text:string;date_role:string;
    date:{precision:string;lower:string|null;upper:string|null};claim_state:"REVIEW_REQUIRED"}>;
  gaps:Array<{document_id:string;filename:string;reason:string;rejected_events:number}>;
  interpretation:"REVIEW_REQUIRED_BOUNDS_NOT_CAUSAL_ORDER";coverage:"AT_MOST_TWO_EVENTS_PER_DOCUMENT_PER_CRITERION_NOT_EXHAUSTIVE"};
export type ResearchRunResult = {
  question:string;answer:string;claim_state:"REVIEW_REQUIRED"|"UNSUPPORTED";abstained:boolean;
  sources:Array<{citation_id:string;document_id:string;version_id:string;chunk_id:string;filename:string;content:string;
    original_content_hash:string;location:unknown;page_number:number;chunk_index:number;excerpt:boolean}>;
  validated_citation_ids:string[];model:string|null;coverage:{completeness:string;chunks_considered:number;lexical_limit_reached?:boolean};
  provider_cost_status:string;review_state:string;comparison?:ResearchComparison;timeline?:ResearchTimeline;
};
export type ResearchRun = {
  id:string;plan_id:string;workspace_id:string;owner_id:string;schema_version:"research-run/1";persistence_state:"PERSISTED";
  state:"queued"|"running"|"interrupted"|"completed"|"cancelled";generation:number;position:number;questions:string[];
  results:ResearchRunResult[];source_state:"CURRENT"|"UNAVAILABLE_OR_CHANGED";error_code:string|null;created_at:string;
  dispatch_state?:"ENQUEUED"|"PENDING_RECOVERY";
  mode?:"QUICK_LOOKUP"|"EVIDENCE_ANSWER"|"COMPARE"|"TIMELINE";total_steps?:number;
  results_included?:boolean;
  source_snapshot?:Array<{document_id:string;version_id:string;index_generation:string;lifecycle_epoch:number}>;
};
const uuid=(value:unknown)=>typeof value==="string"&&/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
export function confirmedResearchRun(value:unknown,planId:string):value is ResearchRun {
  if(!value||typeof value!=="object")return false;
  const row=value as ResearchRun;
  const comparing=row.mode==="COMPARE",timelining=row.mode==="TIMELINE",batched=comparing||timelining,count=row.source_snapshot?.length||0,batches=batched?Math.ceil(count/8):1,total=row.questions?.length*batches;
  return uuid(row.id)&&row.plan_id===planId&&uuid(row.workspace_id)&&uuid(row.owner_id)&&row.schema_version==="research-run/1"&&row.persistence_state==="PERSISTED"
    &&["queued","running","interrupted","completed","cancelled"].includes(row.state)&&Number.isSafeInteger(row.generation)&&row.generation>=1&&row.generation<=10
    &&Array.isArray(row.questions)&&row.questions.length>=1&&row.questions.length<=(batched?9:5)&&row.questions.every(q=>typeof q==="string"&&q.length>0&&q.length<=10000)
    &&(!batched||Array.isArray(row.source_snapshot)&&count>=(comparing?2:1)&&count<=40&&row.source_snapshot.every(s=>uuid(s.document_id))&&row.total_steps===total)
    &&Number.isSafeInteger(row.position)&&row.position>=0&&row.position<=total&&Array.isArray(row.results)
    &&["CURRENT","UNAVAILABLE_OR_CHANGED"].includes(row.source_state)&&(row.results_included===false?batched&&row.results.length===0:row.source_state==="CURRENT"?row.results.length===row.position:row.results.length===0)
    &&(row.state!=="completed"||row.position===total)&&row.results.every((result,index)=>result.question===row.questions[Math.floor(index/batches)]
      &&typeof result.answer==="string"&&result.answer.length>0&&result.answer.length<=16000&&["REVIEW_REQUIRED","UNSUPPORTED"].includes(result.claim_state)
      &&typeof result.abstained==="boolean"&&Array.isArray(result.sources)&&result.sources.length<=12
      &&result.coverage?.completeness==="NOT_EXHAUSTIVE"&&Number.isSafeInteger(result.coverage.chunks_considered)&&result.coverage.chunks_considered>=0&&result.coverage.chunks_considered<=200
      &&(result.coverage.lexical_limit_reached===undefined||typeof result.coverage.lexical_limit_reached==="boolean")
      &&["UNKNOWN","NOT_CALLED"].includes(result.provider_cost_status)&&result.review_state==="COMPLETION_CRITERIA_NOT_AUTOMATICALLY_VERIFIED"
      &&result.sources.every((source,i)=>source.citation_id===`S${i+1}`&&uuid(source.document_id)&&uuid(source.version_id)&&uuid(source.chunk_id)
        &&typeof source.filename==="string"&&typeof source.content==="string"&&/^[a-f0-9]{64}$/.test(source.original_content_hash))
      &&Array.isArray(result.validated_citation_ids)&&result.validated_citation_ids.every(id=>result.sources.some(source=>source.citation_id===id))
      &&(!comparing||confirmedComparison(result,index,row))&&(!timelining||confirmedTimeline(result,index,row)));
}
function confirmedTimeline(result:ResearchRunResult,index:number,run:ResearchRun) {
  const timeline=result.timeline,count=run.source_snapshot!.length,batches=Math.ceil(count/8),batch=index%batches;
  const ids=run.source_snapshot!.slice(batch*8,batch*8+8).map(s=>s.document_id);
  return timeline?.schema_version==="research-timeline/1"&&timeline.criterion_index===Math.floor(index/batches)&&timeline.batch_index===batch
    &&timeline.batch_count===batches&&timeline.total_documents===count&&timeline.interpretation==="REVIEW_REQUIRED_BOUNDS_NOT_CAUSAL_ORDER"
    &&timeline.coverage==="AT_MOST_TWO_EVENTS_PER_DOCUMENT_PER_CRITERION_NOT_EXHAUSTIVE"&&Array.isArray(timeline.events)&&timeline.events.length<=16
    &&Array.isArray(timeline.gaps)&&timeline.gaps.length<=8&&timeline.events.every(event=>{
      const source=result.sources.find(s=>s.citation_id===event.citation_id&&s.document_id===event.document_id);
      return source&&ids.includes(event.document_id)&&event.claim_state==="REVIEW_REQUIRED"&&typeof event.quote==="string"&&Array.from(event.quote).length>=1&&Array.from(event.quote).length<=200
        &&Number.isSafeInteger(event.quote_start)&&event.quote_start>=0&&event.quote_end===event.quote_start+Array.from(event.quote).length
        &&Array.from(source.content).slice(event.quote_start,event.quote_end).join("")===event.quote
        &&typeof event.date_text==="string"&&Array.from(event.date_text).length<=80&&event.quote.includes(event.date_text)
        &&["EVENT","EFFECTIVE","PUBLISHED","OBSERVED","UNKNOWN"].includes(event.date_role)
        &&event.date&&["YEAR","MONTH","DAY","INSTANT","INTERVAL","UNRESOLVED"].includes(event.date.precision)
        &&(event.date.precision==="UNRESOLVED"?event.date.lower===null&&event.date.upper===null:
          typeof event.date.lower==="string"&&typeof event.date.upper==="string"&&Number.isFinite(Date.parse(event.date.lower))&&Number.isFinite(Date.parse(event.date.upper))&&event.date.lower<=event.date.upper);
    })&&timeline.gaps.every(gap=>ids.includes(gap.document_id)&&["INVALID_SOURCE_ANCHOR","NO_RELEVANT_EVENT","NO_INDEXED_EVIDENCE"].includes(gap.reason)
      &&Number.isInteger(gap.rejected_events)&&gap.rejected_events>=0&&gap.rejected_events<=2)
    &&ids.every(id=>(timeline.events.filter(e=>e.document_id===id).length<=2)&&(timeline.events.some(e=>e.document_id===id)||timeline.gaps.some(g=>g.document_id===id)))
    &&result.abstained===(timeline.events.length===0)&&result.claim_state===(timeline.events.length?"REVIEW_REQUIRED":"UNSUPPORTED")
    &&new Set(timeline.events.map(e=>e.citation_id)).size===result.validated_citation_ids.length
    &&timeline.events.every(e=>result.validated_citation_ids.includes(e.citation_id));
}
function confirmedComparison(result:ResearchRunResult,index:number,run:ResearchRun) {
  const matrix=result.comparison,count=run.source_snapshot!.length,batches=Math.ceil(count/8),batch=index%batches;
  const ids=run.source_snapshot!.slice(batch*8,batch*8+8).map(s=>s.document_id);
  return matrix?.schema_version==="research-comparison/1"&&matrix.criterion_index===Math.floor(index/batches)&&matrix.batch_index===batch
    &&matrix.batch_count===batches&&matrix.total_documents===count&&matrix.interpretation==="REVIEW_REQUIRED_NO_AUTOMATIC_EQUIVALENCE_OR_RANKING"
    &&Array.isArray(matrix.cells)&&matrix.cells.length===ids.length&&matrix.cells.every((cell,i)=>cell.document_id===ids[i]
      &&typeof cell.filename==="string"&&typeof cell.answer==="string"&&cell.answer.length>0&&cell.answer.length<=240&&typeof cell.abstained==="boolean"
      &&Array.isArray(cell.validated_citation_ids)&&(cell.abstained?cell.claim_state==="UNSUPPORTED"&&cell.validated_citation_ids.length===0&&!!cell.gap
        :cell.claim_state==="REVIEW_REQUIRED"&&cell.validated_citation_ids.length>0&&cell.validated_citation_ids.every(id=>result.sources.some(s=>s.citation_id===id&&s.document_id===cell.document_id))));
}
