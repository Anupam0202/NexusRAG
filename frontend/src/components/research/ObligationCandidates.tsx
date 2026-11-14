"use client";
import {useState} from "react";
import { obligationFields,obligationLists,type ObligationCandidate,type ResearchObligations } from "@/lib/research-obligations";
import type { ResearchQuoteAnchor } from "@/lib/research-run";

const labels={authority:"Authority",jurisdiction:"Jurisdiction",actor:"Actor",action:"Action",applicability:"Applicability wording",deadline:"Deadline wording",
  valid_from:"Effective-from wording",valid_to:"Effective-to wording",definitions:"Definitions",exceptions:"Exceptions",amendments:"Amendments",supersedes:"Supersession wording"};
function Quote({value,sourcePrefix}:{value:ResearchQuoteAnchor;sourcePrefix?:string}) {
  return <><span className="whitespace-pre-wrap break-words">{value.quote}</span>{" "}{sourcePrefix
    ?<a className="underline" href={`#${sourcePrefix}-${value.citation_id}`}>[{value.citation_id}]</a>:<span>[{value.citation_id}]</span>}</>;
}
function Candidate({candidate,index,sourcePrefix}:{candidate:ObligationCandidate;index:number;sourcePrefix?:string}) {
  const [expanded,setExpanded]=useState(index===0);
  return <details className="min-w-0 border-b border-[var(--border)] pb-3" open={expanded} onToggle={event=>setExpanded(event.currentTarget.open)}>
      <summary className="cursor-pointer break-words font-semibold">Candidate {index+1}: {candidate.provision.quote}</summary>
      {expanded&&<>
      <p className="my-2"><Quote value={candidate.provision} sourcePrefix={sourcePrefix}/></p>
      <dl className="grid min-w-0 gap-x-4 gap-y-2 sm:grid-cols-[10rem_minmax(0,1fr)]">
        {obligationFields.map(field=><div key={field} className="contents"><dt className="font-medium">{labels[field]}</dt>
          <dd className="min-w-0 break-words">{candidate[field]?<Quote value={candidate[field]} sourcePrefix={sourcePrefix}/>:"Not found in retrieved evidence"}</dd></div>)}
        {obligationLists.map(field=><div key={field} className="contents"><dt className="font-medium">{labels[field]}</dt>
          <dd className="min-w-0 break-words">{candidate[field].length?<ul className="space-y-1">{candidate[field].map((anchor,i)=><li key={i}><Quote value={anchor} sourcePrefix={sourcePrefix}/></li>)}</ul>:"Not found in retrieved evidence"}</dd></div>)}
        <dt className="font-medium">Proposed control</dt><dd className="min-w-0 whitespace-pre-wrap break-words">{candidate.control_candidate}<span className="block text-xs text-[var(--text-muted)]">Not implemented or certified</span></dd>
      </dl>
      {candidate.limitations.length>0&&<div className="mt-3"><h6 className="font-medium">Limitations</h6><ul className="list-disc space-y-1 break-words pl-5">{candidate.limitations.map((limitation,i)=><li key={i}>{limitation}</li>)}</ul></div>}
      </>}
    </details>;
}
export function ObligationCandidates({analysis,sourcePrefix}:{analysis:ResearchObligations;sourcePrefix?:string}) {
  return <section aria-label="Obligation candidates" className="mb-4 min-w-0 space-y-3 text-sm">
    <p className="font-medium">{analysis.candidates.length} candidates / independent review required / applicability undetermined</p>
    {analysis.candidates.map((candidate,index)=><Candidate key={index} candidate={candidate} index={index} sourcePrefix={sourcePrefix}/>)}
    {analysis.rejections.length>0&&<p className="text-amber-700 dark:text-amber-300">{analysis.rejections.length} proposed candidates omitted: unconfirmed source anchors or repeated provisions.</p>}
    <details><summary className="cursor-pointer font-medium">Consulted source scope ({analysis.documents.length})</summary>
      <ul className="min-w-0 divide-y divide-[var(--border)]">{analysis.documents.map(document=><li key={document.document_id} className="min-w-0 space-y-1 break-words py-2">
        <p className="font-medium">{document.filename}</p><p className="text-xs text-[var(--text-muted)]">{document.evidence_state==="CANDIDATE"?"Candidate source":document.evidence_state==="NO_INDEXED_EVIDENCE"?"No indexed evidence":"No candidate proposed"} / {document.consulted_sources.length} original chunks consulted</p>
      </li>)}</ul>
    </details>
    <p className="text-xs text-[var(--text-muted)]">Bounded source review, not a complete obligation register or legal certification.</p>
  </section>;
}
