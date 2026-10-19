import modeLimits from "./research-modes.json";
import { confirmedObligations,type ResearchObligations } from "./research-obligations";
export type ResearchQueryRetrieval={schema_version:"research-query-retrieval/1";queries:string[];max_queries:number;completed_queries:number;
  expansion_status:"EXPANDED"|"ORIGINAL_ONLY"|"INVALID_RESPONSE_ORIGINAL_ONLY";rejected_queries:number;expansion_model:string;
  expansion_usage:Record<string,unknown>;evidence_interpretation:"SEARCH_QUERIES_NOT_EVIDENCE";paid_fallback:false};
export function confirmedQueryRetrieval(value:unknown,question:string,mode:string):value is ResearchQueryRetrieval {
  if(!value||typeof value!=="object"||!Object.hasOwn(modeLimits,mode))return false;
  const row=value as ResearchQueryRetrieval,max=modeLimits[mode as keyof typeof modeLimits].max_query_variants;
  return row.schema_version==="research-query-retrieval/1"&&row.max_queries===max&&Array.isArray(row.queries)&&row.queries.length>=1&&row.queries.length<=max
    &&row.queries[0]===question&&row.queries.every((q,i)=>typeof q==="string"&&q.trim()===q&&q.length>0&&Array.from(q).length<=(i?500:10000))
    &&new Set(row.queries.map(q=>q.toLowerCase())).size===row.queries.length&&row.completed_queries===row.queries.length
    &&["EXPANDED","ORIGINAL_ONLY","INVALID_RESPONSE_ORIGINAL_ONLY"].includes(row.expansion_status)&&((row.expansion_status==="EXPANDED")===(row.queries.length>1))
    &&Number.isSafeInteger(row.rejected_queries)&&row.rejected_queries>=0&&row.rejected_queries<max&&typeof row.expansion_model==="string"
    &&!!row.expansion_usage&&typeof row.expansion_usage==="object"&&!Array.isArray(row.expansion_usage)
    &&row.evidence_interpretation==="SEARCH_QUERIES_NOT_EVIDENCE"&&row.paid_fallback===false;
}
export type ResearchComparison={schema_version:"research-comparison/1";criterion_index:number;batch_index:number;batch_count:number;total_documents:number;
  cells:Array<{document_id:string;filename:string;answer:string;claim_state:"REVIEW_REQUIRED"|"UNSUPPORTED";abstained:boolean;validated_citation_ids:string[];gap:string|null}>;
  interpretation:"REVIEW_REQUIRED_NO_AUTOMATIC_EQUIVALENCE_OR_RANKING"};
export type ResearchTimeline={schema_version:"research-timeline/1";criterion_index:number;batch_index:number;batch_count:number;total_documents:number;
  events:Array<{document_id:string;filename:string;citation_id:string;quote:string;quote_start:number;quote_end:number;date_text:string;date_role:string;
    date:{precision:string;lower:string|null;upper:string|null};claim_state:"REVIEW_REQUIRED"}>;
  gaps:Array<{document_id:string;filename:string;reason:string;rejected_events:number}>;
  interpretation:"REVIEW_REQUIRED_BOUNDS_NOT_CAUSAL_ORDER";coverage:"AT_MOST_TWO_EVENTS_PER_DOCUMENT_PER_CRITERION_NOT_EXHAUSTIVE"};
export type ResearchQuoteAnchor={document_id:string;citation_id:string;quote:string;quote_start:number;quote_end:number};
export type ResearchDeep={schema_version:"research-deep/1";phase:"SUBQUESTION"|"SYNTHESIS";criterion_index:number;question_count:number;
  documents:Array<{document_id:string;filename:string;evidence_state:"CITED"|"IN_CONTEXT"|"CANDIDATES_ONLY"|"NO_INDEXED_EVIDENCE";context_citation_ids:string[];
    consulted_sources:Array<{version_id:string;chunk_id:string;original_content_hash:string;page_number?:number|null;chunk_index:number}>}>;
  prior_results:Array<{result_index:number;question:string;claim_state:"REVIEW_REQUIRED"|"UNSUPPORTED";abstained:boolean}>;
  limitations:string[];gaps:string[];interpretation:"REVIEW_REQUIRED_CITATIONS_NOT_ENTAILMENT";coverage:"BOUNDED_CANDIDATES_AND_CONTEXT_NOT_EXHAUSTIVE"};
export type ResearchContradiction={schema_version:"research-contradiction/1";criterion_index:number;total_documents:number;
  pairs:Array<{left:ResearchQuoteAnchor;right:ResearchQuoteAnchor;relationship:"POTENTIAL_CONFLICT"|"DIFFERENT_CONTEXT"|"TEMPORAL_CHANGE"|"INSUFFICIENT_CONTEXT";
    explanation:string;claim_state:"REVIEW_REQUIRED"}>;
  documents:Array<{document_id:string;filename:string;evidence_state:"PAIRED_CANDIDATE"|"NO_PAIR_PROPOSED"|"NO_INDEXED_EVIDENCE";
    consulted_sources:Array<{version_id:string;chunk_id:string;original_content_hash:string;page_number?:number|null;chunk_index:number}>}>;
  rejected_pairs:number;interpretation:"REVIEW_REQUIRED_NO_AUTOMATIC_CONFLICT_VERDICT";coverage:"BOUNDED_RETRIEVAL_AT_MOST_SIX_PAIRS_NOT_EXHAUSTIVE"};
export type ResearchRunResult = {
  question:string;answer:string;claim_state:"REVIEW_REQUIRED"|"UNSUPPORTED";abstained:boolean;
  sources:Array<{citation_id:string;document_id:string;version_id:string;chunk_id:string;filename:string;content:string;
    original_content_hash:string;location:unknown;page_number:number|null;chunk_index:number;excerpt:boolean}>;
  validated_citation_ids:string[];model:string|null;coverage:{completeness:string;chunks_considered:number;lexical_limit_reached?:boolean};
  provider_cost_status:string;review_state:string;comparison?:ResearchComparison;timeline?:ResearchTimeline;contradiction?:ResearchContradiction;deep?:ResearchDeep;obligations?:ResearchObligations;query_retrieval?:ResearchQueryRetrieval;
};
export type ResearchRun = {
  id:string;plan_id:string;workspace_id:string;owner_id:string;schema_version:"research-run/1";persistence_state:"PERSISTED";
  state:"queued"|"running"|"interrupted"|"completed"|"cancelled";generation:number;position:number;questions:string[];
  results:ResearchRunResult[];source_state:"CURRENT"|"UNAVAILABLE_OR_CHANGED";error_code:string|null;created_at:string;
  dispatch_state?:"ENQUEUED"|"PENDING_RECOVERY";
  mode?:"QUICK_LOOKUP"|"EVIDENCE_ANSWER"|"COMPARE"|"TIMELINE"|"CONTRADICTION_ANALYSIS"|"DEEP_RESEARCH"|"OBLIGATION_ANALYSIS";total_steps?:number;
  results_included?:boolean;
  source_snapshot?:Array<{document_id:string;version_id:string;index_generation:string;lifecycle_epoch:number}>;
};
const uuid=(value:unknown)=>typeof value==="string"&&/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
export function confirmedResearchRun(value:unknown,planId:string):value is ResearchRun {
  if(!value||typeof value!=="object")return false;
  const row=value as ResearchRun;
  const comparing=row.mode==="COMPARE",timelining=row.mode==="TIMELINE",contradicting=row.mode==="CONTRADICTION_ANALYSIS",deepening=row.mode==="DEEP_RESEARCH",obligating=row.mode==="OBLIGATION_ANALYSIS",batched=comparing||timelining,count=row.source_snapshot?.length||0,batches=batched?Math.ceil(count/8):1,total=row.questions?.length*batches;
  return uuid(row.id)&&row.plan_id===planId&&uuid(row.workspace_id)&&uuid(row.owner_id)&&row.schema_version==="research-run/1"&&row.persistence_state==="PERSISTED"
    &&["queued","running","interrupted","completed","cancelled"].includes(row.state)&&Number.isSafeInteger(row.generation)&&row.generation>=1&&row.generation<=10
    &&Array.isArray(row.questions)&&row.questions.length>=1&&row.questions.length<=(deepening?13:contradicting||obligating?11:batched?9:5)&&row.questions.every(q=>typeof q==="string"&&q.length>0&&q.length<=10000)
    &&(!batched||Array.isArray(row.source_snapshot)&&count>=(comparing?2:1)&&count<=40&&row.source_snapshot.every(s=>uuid(s.document_id))&&row.total_steps===total)
    &&(!(contradicting||deepening||obligating)||Array.isArray(row.source_snapshot)&&count>=1&&count<=(deepening?60:50)&&row.source_snapshot.every(s=>uuid(s.document_id)&&uuid(s.version_id)
      &&typeof s.index_generation==="string"&&s.index_generation.length>0&&Number.isSafeInteger(s.lifecycle_epoch)&&s.lifecycle_epoch>=1)&&row.total_steps===total)
    &&Number.isSafeInteger(row.position)&&row.position>=0&&row.position<=total&&Array.isArray(row.results)
    &&["CURRENT","UNAVAILABLE_OR_CHANGED"].includes(row.source_state)&&(row.results_included===false?(batched||contradicting||deepening||obligating)&&row.results.length===0:row.source_state==="CURRENT"?row.results.length===row.position:row.results.length===0)
    &&(row.state!=="completed"||row.position===total)&&row.results.every((result,index)=>result.question===row.questions[Math.floor(index/batches)]
      &&typeof result.answer==="string"&&result.answer.length>0&&(obligating?Array.from(result.answer).length:result.answer.length)<=16000&&["REVIEW_REQUIRED","UNSUPPORTED"].includes(result.claim_state)
      &&typeof result.abstained==="boolean"&&Array.isArray(result.sources)&&result.sources.length<=(deepening&&index===total-1?156:obligating?50:12)
      &&result.coverage?.completeness==="NOT_EXHAUSTIVE"&&Number.isSafeInteger(result.coverage.chunks_considered)&&result.coverage.chunks_considered>=0&&result.coverage.chunks_considered<=200
      &&(result.coverage.lexical_limit_reached===undefined||typeof result.coverage.lexical_limit_reached==="boolean")
      &&(result.query_retrieval===undefined||confirmedQueryRetrieval(result.query_retrieval,result.question,row.mode||"QUICK_LOOKUP"))
      &&["UNKNOWN","NOT_CALLED"].includes(result.provider_cost_status)&&result.review_state==="COMPLETION_CRITERIA_NOT_AUTOMATICALLY_VERIFIED"
      &&result.sources.every((source,i)=>source.citation_id===`S${i+1}`&&uuid(source.document_id)&&uuid(source.version_id)&&uuid(source.chunk_id)
        &&typeof source.filename==="string"&&typeof source.content==="string"&&/^[a-f0-9]{64}$/.test(source.original_content_hash))
      &&Array.isArray(result.validated_citation_ids)&&result.validated_citation_ids.every(id=>result.sources.some(source=>source.citation_id===id))
      &&(!comparing||confirmedComparison(result,index,row))&&(!timelining||confirmedTimeline(result,index,row))&&(!contradicting||confirmedContradiction(result,index,row))
      &&(!deepening||confirmedDeep(result,index,row))&&(!obligating||confirmedObligations(result,index,row)));
}
function confirmedDeep(result:ResearchRunResult,index:number,run:ResearchRun) {
  const report=result.deep,snapshot=run.source_snapshot!,phase=index===run.questions.length-1?"SYNTHESIS":"SUBQUESTION";
  const bounded=(values:unknown):values is string[]=>Array.isArray(values)&&values.length<=8&&values.every(value=>typeof value==="string"&&value.trim()&&Array.from(value).length<=500);
  if(report?.schema_version!=="research-deep/1"||report.phase!==phase||report.criterion_index!==index||report.question_count!==run.questions.length
    ||report.interpretation!=="REVIEW_REQUIRED_CITATIONS_NOT_ENTAILMENT"||report.coverage!=="BOUNDED_CANDIDATES_AND_CONTEXT_NOT_EXHAUSTIVE"
    ||!bounded(report.limitations)||!bounded(report.gaps)||!Array.isArray(report.documents)||report.documents.length!==snapshot.length
    ||!Array.isArray(report.prior_results)||report.prior_results.length!==(phase==="SYNTHESIS"?index:0)
    ||!report.prior_results.every((prior,i)=>prior?.result_index===i&&prior.question===run.questions[i]
      &&prior.claim_state===run.results[i]?.claim_state&&prior.abstained===run.results[i]?.abstained)
    ||report.documents.reduce((sum,doc)=>sum+(Array.isArray(doc?.consulted_sources)?doc.consulted_sources.length:345),0)>344)return false;
  return report.documents.every((doc,i)=>{
    if(!doc||doc.document_id!==snapshot[i].document_id||typeof doc.filename!=="string"||!Array.isArray(doc.context_citation_ids)||!Array.isArray(doc.consulted_sources))return false;
    const context=result.sources.filter(source=>source.document_id===doc.document_id).map(source=>source.citation_id);
    const state=context.some(id=>result.validated_citation_ids.includes(id))?"CITED":context.length?"IN_CONTEXT":doc.consulted_sources.length?"CANDIDATES_ONLY":"NO_INDEXED_EVIDENCE";
    return doc.evidence_state===state&&doc.context_citation_ids.length===context.length&&doc.context_citation_ids.every((id,j)=>id===context[j])
      &&doc.consulted_sources.every(source=>source&&source.version_id===snapshot[i].version_id&&uuid(source.chunk_id)&&/^[a-f0-9]{64}$/.test(source.original_content_hash)
        &&Number.isSafeInteger(source.chunk_index)&&source.chunk_index>=0&&(source.page_number==null||Number.isSafeInteger(source.page_number)&&source.page_number>=0));
  })&&result.sources.every(source=>Array.from(source.content).length>=1&&Array.from(source.content).length<=1200
    &&report.documents.some(doc=>doc.document_id===source.document_id&&doc.consulted_sources.some(receipt=>receipt.chunk_id===source.chunk_id
      &&receipt.version_id===source.version_id&&receipt.original_content_hash===source.original_content_hash)))
    &&result.abstained===(result.validated_citation_ids.length===0)&&result.claim_state===(result.abstained?"UNSUPPORTED":"REVIEW_REQUIRED");
}
function confirmedContradiction(result:ResearchRunResult,index:number,run:ResearchRun) {
  const analysis=result.contradiction,snapshot=run.source_snapshot!;
  if(analysis?.schema_version!=="research-contradiction/1"||analysis.criterion_index!==index||analysis.total_documents!==snapshot.length
    ||analysis.interpretation!=="REVIEW_REQUIRED_NO_AUTOMATIC_CONFLICT_VERDICT"||analysis.coverage!=="BOUNDED_RETRIEVAL_AT_MOST_SIX_PAIRS_NOT_EXHAUSTIVE"
    ||!Array.isArray(analysis.pairs)||analysis.pairs.length>6||!Array.isArray(analysis.documents)||analysis.documents.length!==snapshot.length
    ||!Number.isSafeInteger(analysis.rejected_pairs)||analysis.rejected_pairs<0||analysis.pairs.length+analysis.rejected_pairs>6)return false;
  const identities=new Set<string>(),used=new Set<string>();
  for(const pair of analysis.pairs) {
    if(!pair||pair.claim_state!=="REVIEW_REQUIRED"||!["POTENTIAL_CONFLICT","DIFFERENT_CONTEXT","TEMPORAL_CHANGE","INSUFFICIENT_CONTEXT"].includes(pair.relationship)
      ||typeof pair.explanation!=="string"||!pair.explanation.trim()||Array.from(pair.explanation).length>240)return false;
    const keys:string[]=[],ranges:Array<{chunk:string;start:number;end:number}>=[];
    for(const side of [pair.left,pair.right]) {
      if(!side||typeof side.quote!=="string"||!side.quote||Array.from(side.quote).length>200||!Number.isSafeInteger(side.quote_start)||side.quote_start<0
        ||side.quote_end!==side.quote_start+Array.from(side.quote).length)return false;
      const source=result.sources.find(s=>s.citation_id===side.citation_id&&s.document_id===side.document_id);
      if(!source||Array.from(source.content).slice(side.quote_start,side.quote_end).join("")!==side.quote)return false;
      const chunk=`${source.version_id}:${source.chunk_id}`;keys.push(`${chunk}:${side.quote_start}:${side.quote_end}`);used.add(side.citation_id);
      ranges.push({chunk,start:side.quote_start,end:side.quote_end});
    }
    const key=keys.sort().join("|");
    if(identities.has(key)||ranges[0].chunk===ranges[1].chunk&&ranges[0].start<ranges[1].end&&ranges[1].start<ranges[0].end)return false;
    identities.add(key);
  }
  if(!analysis.documents.every(d=>d&&typeof d==="object")||analysis.documents.reduce((sum,d)=>sum+(Array.isArray(d.consulted_sources)?d.consulted_sources.length:51),0)>50)return false;
  if(!analysis.documents.every((doc,i)=>doc.document_id===snapshot[i].document_id&&typeof doc.filename==="string"&&Array.isArray(doc.consulted_sources)
    &&doc.evidence_state===(analysis.pairs.some(p=>p.left.document_id===doc.document_id||p.right.document_id===doc.document_id)?"PAIRED_CANDIDATE":doc.consulted_sources.length?"NO_PAIR_PROPOSED":"NO_INDEXED_EVIDENCE")
    &&doc.consulted_sources.every(s=>s&&s.version_id===snapshot[i].version_id&&uuid(s.chunk_id)&&/^[a-f0-9]{64}$/.test(s.original_content_hash)
      &&Number.isSafeInteger(s.chunk_index)&&s.chunk_index>=0&&(s.page_number==null||Number.isSafeInteger(s.page_number)&&s.page_number>=0))))return false;
  return result.abstained===(analysis.pairs.length===0)&&result.claim_state===(analysis.pairs.length?"REVIEW_REQUIRED":"UNSUPPORTED")
    &&result.sources.length===used.size&&result.validated_citation_ids.length===used.size
    &&result.validated_citation_ids.every((id,i)=>id===result.sources[i].citation_id&&used.has(id))
    &&result.sources.every(source=>analysis.documents.some(doc=>doc.document_id===source.document_id&&doc.consulted_sources.some(s=>
      s.version_id===source.version_id&&s.chunk_id===source.chunk_id&&s.original_content_hash===source.original_content_hash)));
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
