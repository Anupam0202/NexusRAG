import type { ResearchDeep } from "@/lib/research-run";

const states={CITED:"Cited",IN_CONTEXT:"In context",CANDIDATES_ONLY:"Candidates inspected",NO_INDEXED_EVIDENCE:"No indexed evidence"};
export function DeepResearchReport({report,sourcePrefix,runPrefix}:{report:ResearchDeep;sourcePrefix?:string;runPrefix?:string}) {
  const synthesis=report.phase==="SYNTHESIS";
  return <section aria-label={synthesis?"Deep Research synthesis":`Deep Research subquestion ${report.criterion_index+1}`} className="mb-3 min-w-0 space-y-3 text-sm">
    <h5 className="font-semibold">{synthesis?"Synthesis":`Subquestion ${report.criterion_index+1} of ${report.question_count-1}`}</h5>
    {report.limitations.length>0&&<div><h6 className="font-medium">Limitations</h6><ul className="list-disc space-y-1 break-words pl-5">{report.limitations.map((text,index)=><li key={index}>{text}</li>)}</ul></div>}
    {report.gaps.length>0&&<div><h6 className="font-medium">Evidence gaps</h6><ul className="list-disc space-y-1 break-words pl-5">{report.gaps.map((text,index)=><li key={index}>{text}</li>)}</ul></div>}
    {report.prior_results.length>0&&<details><summary className="cursor-pointer font-medium">Earlier analyses ({report.prior_results.length})</summary>
      <ol className="list-decimal space-y-2 break-words py-2 pl-5">{report.prior_results.map(result=><li key={result.result_index}>
        {runPrefix?<a className="underline" href={`#${runPrefix}-${result.result_index}`}>{result.question}</a>:result.question}
        <span className="block text-xs text-[var(--text-muted)]">{result.abstained?"No supported answer":"Review required"}</span>
      </li>)}</ol></details>}
    <details><summary className="cursor-pointer font-medium">Source scope ({report.documents.length})</summary>
      <ul className="min-w-0 divide-y divide-[var(--border)]">{report.documents.map(document=><li key={document.document_id} className="min-w-0 space-y-1 break-words py-2">
        <p className="font-medium">{document.filename}</p>
        <p className="text-xs text-[var(--text-muted)]">{states[document.evidence_state]} / {document.consulted_sources.length} original {document.consulted_sources.length===1?"chunk":"chunks"} inspected</p>
        {document.context_citation_ids.length>0&&<p className="flex flex-wrap gap-2 text-xs">{document.context_citation_ids.map(id=>sourcePrefix
          ?<a key={id} className="underline" href={`#${sourcePrefix}-${id}`}>[{id}]</a>:<span key={id}>[{id}]</span>)}</p>}
      </li>)}</ul>
    </details>
  </section>;
}
