"use client";
import type {ResearchDiligence} from "@/lib/research-diligence";

export function DiligenceObservations({analysis,sourcePrefix}:{analysis:ResearchDiligence;sourcePrefix?:string}) {
  return <section aria-label="Due diligence observations" className="mb-4 min-w-0 space-y-3 text-sm">
    <p className="font-medium">{analysis.observations.length} observations / independent review required / no automatic adverse decision</p>
    {analysis.requested_targets.length>0&&<details><summary className="cursor-pointer font-medium">Requested subjects ({analysis.requested_targets.length})</summary>
      <ul className="list-disc break-words pl-5">{analysis.requested_targets.map((target,i)=><li key={i}>{target}</li>)}</ul></details>}
    <ol className="min-w-0 divide-y divide-[var(--border)]">{analysis.observations.map((row,index)=><li key={index} className="min-w-0 space-y-2 py-3">
      <p className="text-xs text-[var(--text-muted)]">{row.topic.replaceAll("_"," ")} / identity unresolved</p>
      <h6 className="break-words font-semibold">{row.summary}</h6>
      <ul className="min-w-0 space-y-2">{row.evidence.map((anchor,i)=><li key={i} className="whitespace-pre-wrap break-words">
        <blockquote>{anchor.quote}{" "}{sourcePrefix?<a className="underline" href={`#${sourcePrefix}-${anchor.citation_id}`}>[{anchor.citation_id}]</a>:<span>[{anchor.citation_id}]</span>}</blockquote>
      </li>)}</ul>
      <p className="font-medium">Qualifications and limitations</p>
      <ul className="list-disc space-y-1 break-words pl-5">{row.limitations.map((value,i)=><li key={i}>{value}</li>)}</ul>
    </li>)}</ol>
    <div><h6 className="font-medium">Unresolved evidence gaps</h6>
      {analysis.gaps.length?<ul className="list-disc space-y-2 break-words pl-5">{analysis.gaps.map((gap,i)=><li key={i}>{gap.description}
        {gap.document_id&&<span className="block text-xs text-[var(--text-muted)]">{analysis.documents.find(doc=>doc.document_id===gap.document_id)?.filename}</span>}
      </li>)}</ul>:<p>No additional gaps proposed; this does not establish complete coverage.</p>}
    </div>
    {analysis.rejections.length>0&&<p className="text-amber-700 dark:text-amber-300">{analysis.rejections.length} proposed observations omitted: unconfirmed source anchors or repeated observations.</p>}
    <details><summary className="cursor-pointer font-medium">Consulted source scope ({analysis.documents.length})</summary>
      <ul className="min-w-0 divide-y divide-[var(--border)]">{analysis.documents.map(doc=><li key={doc.document_id} className="min-w-0 space-y-1 break-words py-2">
        <p className="font-medium">{doc.filename}</p><p className="text-xs text-[var(--text-muted)]">{doc.evidence_state==="OBSERVATION"?"Observation source":doc.evidence_state==="NO_INDEXED_EVIDENCE"?"No indexed evidence":"No observation proposed"} / {doc.consulted_sources.length} original chunks consulted</p>
      </li>)}</ul>
    </details>
    <p className="text-xs text-[var(--text-muted)]">Bounded source review, not complete due diligence, verified identity or proof of no issues.</p>
  </section>;
}
