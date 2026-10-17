import type { ResearchComparison } from "@/lib/research-run";

export function ComparisonMatrix({matrix,sourcePrefix}:{matrix:ResearchComparison;sourcePrefix:string}) {
  return <section aria-label={`Comparison criterion ${matrix.criterion_index+1}, batch ${matrix.batch_index+1}`} className="mb-4 min-w-0">
    <p className="mb-2 text-xs text-[var(--text-muted)]">Criterion {matrix.criterion_index+1} · Batch {matrix.batch_index+1} of {matrix.batch_count} · {matrix.total_documents} documents</p>
    <div className="max-w-full overflow-x-auto" tabIndex={0} role="region" aria-label="Comparison evidence matrix">
      <table className="w-full min-w-[520px] table-fixed border-collapse text-left text-sm">
        <colgroup><col className="w-1/4"/><col className="w-1/2"/><col className="w-1/4"/></colgroup>
        <thead><tr className="border-b border-[var(--border)]"><th scope="col" className="p-2">Document</th><th scope="col" className="p-2">Evidence answer</th><th scope="col" className="p-2">Source / gap</th></tr></thead>
        <tbody>{matrix.cells.map(cell=><tr key={cell.document_id} className="border-b border-[var(--border)] align-top">
          <th scope="row" className="break-words p-2 font-medium">{cell.filename}</th>
          <td className="whitespace-pre-wrap break-words p-2"><p>{cell.answer}</p><span className="mt-2 block text-xs text-[var(--text-muted)]">{cell.abstained?"Unsupported":"Review required"}</span></td>
          <td className="break-words p-2">{cell.abstained?<span>{cell.gap==="NO_INDEXED_EVIDENCE"?"No indexed evidence":"Insufficient evidence"}</span>:cell.validated_citation_ids.map(id=>
            <a key={id} href={`#${sourcePrefix}-${id}`} className="mr-2 inline-block underline" onClick={()=>{
              const target=document.getElementById(`${sourcePrefix}-${id}`);
              if(target instanceof HTMLDetailsElement)target.open=true;
              target?.focus({preventScroll:true});
            }}>[{id}]</a>)}</td>
        </tr>)}</tbody>
      </table>
    </div>
  </section>;
}
