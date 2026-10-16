import type { ResearchTimeline,ResearchRun } from "@/lib/research-run";

export function TimelineEvents({timeline,sourcePrefix,sourcePrefixes,combined=false}:{timeline:ResearchTimeline;sourcePrefix:string;sourcePrefixes?:Record<string,string>;combined?:boolean}) {
  return <section aria-label={`Timeline criterion ${timeline.criterion_index+1}, batch ${timeline.batch_index+1}`} className="mb-4 min-w-0">
    <p className="mb-3 text-xs text-[var(--text-muted)]">Criterion {timeline.criterion_index+1} · {combined?`Combined saved batches (${timeline.batch_count} planned)`:`Batch ${timeline.batch_index+1} of ${timeline.batch_count}`} · {timeline.total_documents} {timeline.total_documents===1?"document":"documents"} · Bounded evidence, not exhaustive</p>
    <p className="mb-3 text-sm">Dates and roles require review. Overlapping or unresolved bounds do not establish event order or causation.</p>
    <ol aria-label="Source events" className="divide-y divide-[var(--border)]">{timeline.events.map((event,index)=><li key={index} className="min-w-0 py-3">
      <h5 className="break-words text-sm font-semibold">{event.date_text||"Undated"} <span className="font-normal">/ {event.date_role.toLowerCase()} / {event.date.precision.toLowerCase()}</span></h5>
      <p className="my-1 break-words text-xs text-[var(--text-muted)]">{event.filename} · Review required</p>
      <blockquote className="whitespace-pre-wrap break-words text-sm">{event.quote}</blockquote>
      <p className="my-1 break-words text-xs">{event.date.lower?`${event.date.lower} to ${event.date.upper}`:"Unresolved date; retained verbatim"}</p>
      <a href={`#${sourcePrefixes?.[event.document_id]||sourcePrefix}-${event.citation_id}`} className="text-sm underline" onClick={()=>{
        const target=document.getElementById(`${sourcePrefixes?.[event.document_id]||sourcePrefix}-${event.citation_id}`);if(target instanceof HTMLDetailsElement)target.open=true;target?.focus({preventScroll:true});
      }}>[{event.citation_id}]</a>
      <span className="ml-2 text-xs text-[var(--text-muted)]">Original codepoints {event.quote_start}-{event.quote_end}</span>
    </li>)}</ol>
    {timeline.gaps.map(gap=><p key={gap.document_id} className="my-2 break-words text-sm">{gap.filename}: {gap.reason==="NO_INDEXED_EVIDENCE"?"No indexed evidence":gap.reason==="INVALID_SOURCE_ANCHOR"?"Unconfirmed source events omitted":"No relevant event returned"}</p>)}
  </section>;
}
export function timelineGroups(run:ResearchRun) {
  const groups=new Map<number,{timeline:ResearchTimeline;sourcePrefixes:Record<string,string>}>();
  run.results.forEach((result,index)=>{
    const timeline=result.timeline;if(!timeline)return;
    const group=groups.get(timeline.criterion_index)||{timeline:{...timeline,events:[],gaps:[]},sourcePrefixes:{}};
    group.timeline.events.push(...timeline.events);group.timeline.gaps.push(...timeline.gaps);
    for(const source of result.sources)group.sourcePrefixes[source.document_id]=`${run.id}-${index}`;
    groups.set(timeline.criterion_index,group);
  });
  return [...groups.values()].map(group=>{
    group.timeline.events.sort((a,b)=>a.date.lower===b.date.lower?0:a.date.lower===null?1:b.date.lower===null?-1:a.date.lower.localeCompare(b.date.lower));
    return group;
  });
}
export function TimelineOverview({run}:{run:ResearchRun}) {
  return <section aria-label="Saved chronology" className="min-w-0 border-t border-[var(--border)] pt-4">
    <h4 className="mb-3 font-semibold">Chronology</h4>
    {timelineGroups(run).map(({timeline,sourcePrefixes})=><div key={timeline.criterion_index}>
      <h5 className="mb-2 break-words text-sm font-medium">{run.questions[timeline.criterion_index]}</h5>
      <TimelineEvents timeline={timeline} sourcePrefix={run.id} sourcePrefixes={sourcePrefixes} combined/>
    </div>)}
  </section>;
}
