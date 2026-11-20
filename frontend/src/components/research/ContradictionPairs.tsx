import Link from "@/components/layout/StaticLink";
import type {ResearchContradiction} from "@/lib/research-run";

const relationships={POTENTIAL_CONFLICT:"Potential conflict",DIFFERENT_CONTEXT:"Different context",TEMPORAL_CHANGE:"Temporal change",INSUFFICIENT_CONTEXT:"Insufficient context"};
export function ContradictionPairs({analysis,sourcePrefix}:{analysis:ResearchContradiction;sourcePrefix:string}) {
  return <section aria-label="Source-paired analysis" className="mb-4 min-w-0">
    <h5 className="mb-2 text-sm font-semibold">Statement pairs</h5>
    <p className="mb-2 text-xs text-[var(--text-muted)]">Criterion {analysis.criterion_index+1} / {analysis.total_documents} {analysis.total_documents===1?"document":"documents"} / {analysis.pairs.length} {analysis.pairs.length===1?"pair":"pairs"} / Bounded evidence, not exhaustive</p>
    <p className="mb-3 text-sm">Review required. Different dates, versions, units or scopes do not by themselves establish a contradiction.</p>
    {!analysis.pairs.length&&<p className="mb-3 text-sm">No source-anchored pairs returned. This does not establish consistency.</p>}
    {analysis.rejected_pairs>0&&<p role="status" className="mb-3 text-sm text-amber-700 dark:text-amber-300">{analysis.rejected_pairs} unconfirmed or duplicate {analysis.rejected_pairs===1?"pair was":"pairs were"} excluded.</p>}
    <ol className="min-w-0 divide-y divide-[var(--border)]">{analysis.pairs.map((pair,index)=><li key={index} className="min-w-0 py-3">
      <h6 className="mb-1 text-sm font-semibold">{relationships[pair.relationship]}</h6>
      <p className="mb-3 whitespace-pre-wrap break-words text-sm">{pair.explanation}</p>
      <div className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2">{[pair.left,pair.right].map((side,i)=><figure key={i} className="min-w-0">
        <blockquote className="mb-2 whitespace-pre-wrap break-words text-sm">{side.quote}</blockquote>
        <figcaption className="break-words text-xs text-[var(--text-muted)]">{analysis.documents.find(d=>d.document_id===side.document_id)?.filename} / Review required{" "}
          <a href={`#${sourcePrefix}-${side.citation_id}`} className="underline" onClick={()=>{
            const target=document.getElementById(`${sourcePrefix}-${side.citation_id}`);
            if(target instanceof HTMLDetailsElement)target.open=true;
            target?.focus({preventScroll:true});
          }}>[{side.citation_id}]</a>
          <span className="mt-1 block">Original codepoints {side.quote_start}-{side.quote_end}</span>
        </figcaption>
      </figure>)}</div>
    </li>)}</ol>
    <details className="mt-3 min-w-0 border-t border-[var(--border)] pt-3">
      <summary className="cursor-pointer text-sm">Consulted scope ({analysis.documents.length} {analysis.documents.length===1?"document":"documents"})</summary>
      <ul className="mt-2 min-w-0 divide-y divide-[var(--border)]">{analysis.documents.map(doc=><li key={doc.document_id} className="min-w-0 py-2 text-xs">
        <Link href={`/documents/${encodeURIComponent(doc.document_id)}`} className="break-words underline">{doc.filename}</Link>
        <p className="mt-1">{doc.evidence_state==="PAIRED_CANDIDATE"?"Candidate pair proposed":doc.evidence_state==="NO_PAIR_PROPOSED"?"No pair proposed; not a consistency finding":"No indexed evidence"}</p>
        {doc.consulted_sources.map(s=><p key={s.chunk_id} className="mt-1 break-all text-[var(--text-muted)]">Chunk {s.chunk_index}{s.page_number!=null&&s.page_number>0?` / page ${s.page_number}`:""} / SHA256 {s.original_content_hash}</p>)}
      </li>)}</ul>
    </details>
  </section>;
}
