"use client";
import {useState} from "react";
import {entityFields,entityLists,type EntityCandidate,type ResearchEntities} from "@/lib/research-entities";
import type {ResearchQuoteAnchor} from "@/lib/research-run";

const labels={identifiers:"Identifiers",aliases:"Aliases",filings:"Filings",jurisdiction:"Jurisdiction wording",
  valid_from:"Valid-from wording",valid_to:"Valid-to wording",subject:"Subject",predicate:"Relationship wording",object:"Object"};
function Quote({value,sourcePrefix}:{value:ResearchQuoteAnchor;sourcePrefix?:string}) {
  return <><span className="whitespace-pre-wrap break-words">{value.quote}</span>{" "}{sourcePrefix
    ?<a className="underline" href={`#${sourcePrefix}-${value.citation_id}`}>[{value.citation_id}]</a>:<span>[{value.citation_id}]</span>}</>;
}
function Candidate({candidate,index,sourcePrefix}:{candidate:EntityCandidate;index:number;sourcePrefix?:string}) {
  const [expanded,setExpanded]=useState(index===0);
  return <details className="min-w-0 border-b border-[var(--border)] pb-3" open={expanded} onToggle={event=>setExpanded(event.currentTarget.open)}>
    <summary className="cursor-pointer break-words font-semibold">Candidate {index+1}: {candidate.name.quote}</summary>
    {expanded&&<>
      <p className="my-2"><Quote value={candidate.name} sourcePrefix={sourcePrefix}/></p>
      <p className="mb-3 text-xs text-[var(--text-muted)]">Identity unresolved / confidence not calibrated / independent review required</p>
      <dl className="grid min-w-0 gap-x-4 gap-y-2 sm:grid-cols-[10rem_minmax(0,1fr)]">
        {entityLists.map(field=><div key={field} className="contents"><dt className="font-medium">{labels[field]}</dt>
          <dd className="min-w-0 break-words">{candidate[field].length?<ul className="space-y-1">{candidate[field].map((anchor,i)=><li key={i}><Quote value={anchor} sourcePrefix={sourcePrefix}/></li>)}</ul>:"Not found in retrieved evidence"}</dd></div>)}
        {entityFields.map(field=><div key={field} className="contents"><dt className="font-medium">{labels[field]}</dt>
          <dd className="min-w-0 break-words">{candidate[field]?<Quote value={candidate[field]} sourcePrefix={sourcePrefix}/>:"Not found in retrieved evidence"}</dd></div>)}
      </dl>
      <div className="mt-3"><h6 className="font-medium">Source-asserted relationship candidates</h6>
        {candidate.relationships.length?<ol className="min-w-0 divide-y divide-[var(--border)]">{candidate.relationships.map((relationship,i)=><li key={i} className="min-w-0 space-y-2 py-3">
          <p><Quote value={relationship.statement} sourcePrefix={sourcePrefix}/></p>
          <dl className="grid min-w-0 gap-x-4 gap-y-2 sm:grid-cols-[10rem_minmax(0,1fr)]">{(["subject","predicate","object","valid_from","valid_to"] as const).map(field=><div key={field} className="contents">
            <dt className="font-medium">{labels[field]}</dt><dd className="min-w-0 break-words">{relationship[field]?<Quote value={relationship[field]} sourcePrefix={sourcePrefix}/>:"Not found in retrieved evidence"}</dd></div>)}</dl>
        </li>)}</ol>:<p className="mt-1">Not found in retrieved evidence</p>}
      </div>
      {candidate.limitations.length>0&&<div className="mt-3"><h6 className="font-medium">Limitations</h6><ul className="list-disc space-y-1 break-words pl-5">{candidate.limitations.map((limitation,i)=><li key={i}>{limitation}</li>)}</ul></div>}
    </>}
  </details>;
}
export function EntityCandidates({analysis,sourcePrefix}:{analysis:ResearchEntities;sourcePrefix?:string}) {
  return <section aria-label="Entity candidates" className="mb-4 min-w-0 space-y-3 text-sm">
    <p className="font-medium">{analysis.candidates.length} candidates / identities unresolved / no automatic adverse decision</p>
    {analysis.requested_targets.length>0&&<details><summary className="cursor-pointer font-medium">Requested entity targets ({analysis.requested_targets.length})</summary>
      <ul className="list-disc break-words pl-5">{analysis.requested_targets.map((target,i)=><li key={i}>{target}</li>)}</ul></details>}
    {analysis.candidates.map((candidate,index)=><Candidate key={index} candidate={candidate} index={index} sourcePrefix={sourcePrefix}/>)}
    {analysis.rejections.length>0&&<p className="text-amber-700 dark:text-amber-300">{analysis.rejections.length} proposed candidates omitted: unconfirmed source anchors, relationships or repeated name anchors.</p>}
    <details><summary className="cursor-pointer font-medium">Consulted source scope ({analysis.documents.length})</summary>
      <ul className="min-w-0 divide-y divide-[var(--border)]">{analysis.documents.map(document=><li key={document.document_id} className="min-w-0 space-y-1 break-words py-2">
        <p className="font-medium">{document.filename}</p><p className="text-xs text-[var(--text-muted)]">{document.evidence_state==="CANDIDATE"?"Candidate source":document.evidence_state==="NO_INDEXED_EVIDENCE"?"No indexed evidence":"No candidate proposed"} / {document.consulted_sources.length} original chunks consulted</p>
      </li>)}</ul>
    </details>
    <p className="text-xs text-[var(--text-muted)]">Bounded source review, not a complete entity register or verified identity join.</p>
  </section>;
}
