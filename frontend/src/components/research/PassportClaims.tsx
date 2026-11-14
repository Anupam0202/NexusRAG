"use client";
import type {ResearchPassport} from "@/lib/research-passport";
import {passportSubjectFields} from "@/lib/product-passport-subject";

export function PassportClaims({analysis,sourcePrefix}:{analysis:ResearchPassport;sourcePrefix?:string}) {
  return <section aria-label="Product passport claims" className="mb-4 min-w-0 space-y-3 text-sm">
    <header className="min-w-0 space-y-2">
      <h5 className="whitespace-pre-wrap break-words font-semibold">{analysis.subject.product_name}</h5>
      <p className="text-xs text-[var(--text-muted)]">Declared product / applicability not verified</p>
      <dl className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">{passportSubjectFields.map(([field,label])=><div key={field} className="min-w-0">
        <dt className="text-xs text-[var(--text-muted)]">{label}</dt><dd className="whitespace-pre-wrap break-all">{analysis.subject[field]}</dd>
      </div>)}</dl>
    </header>
    <p className="font-medium">{analysis.claims.length} proposed claims / independent review required / not certification</p>
    {!analysis.claims.length&&<p>No source-anchored claims were returned from the bounded excerpts. This does not establish complete coverage or a clean passport.</p>}
    <ol className="min-w-0 divide-y divide-[var(--border)]">{analysis.claims.map((row,index)=><li key={index} className="min-w-0 space-y-2 py-3">
      <p className="text-xs text-[var(--text-muted)]">{row.kind.replaceAll("_"," ")} / proposed {row.status.toLowerCase().replaceAll("_"," ")}</p>
      <h6 className="whitespace-pre-wrap break-words font-semibold">{row.property}</h6>
      <p className="whitespace-pre-wrap break-words">{row.value}</p>
      <ul className="min-w-0 space-y-2">{row.evidence.map((anchor,i)=><li key={i} className="whitespace-pre-wrap break-words">
        <blockquote>{anchor.quote}{" "}{sourcePrefix?<a className="underline" href={`#${sourcePrefix}-${anchor.citation_id}`}>[{anchor.citation_id}]</a>:<span>[{anchor.citation_id}]</span>}</blockquote>
      </li>)}</ul>
      <p className="font-medium">Qualifications and applicability</p>
      <ul className="list-disc space-y-1 break-words pl-5">{row.qualifications.map((value,i)=><li key={i}>{value}</li>)}</ul>
    </li>)}</ol>
    <div><h6 className="font-medium">Unresolved product evidence gaps</h6>
      {analysis.gaps.length?<ul className="list-disc space-y-2 break-words pl-5">{analysis.gaps.map((gap,i)=><li key={i}>{gap.description}
        {gap.document_id&&<span className="block text-xs text-[var(--text-muted)]">{analysis.documents.find(doc=>doc.document_id===gap.document_id)?.filename}</span>}
      </li>)}</ul>:<p>No additional gaps proposed; absence of a gap is not proof that evidence is complete.</p>}
    </div>
    {analysis.rejections.length>0&&<p className="text-amber-700 dark:text-amber-300">{analysis.rejections.length} proposed claims omitted: unconfirmed anchors or repeated claims.</p>}
    <details><summary className="cursor-pointer font-medium">Consulted source scope ({analysis.documents.length})</summary>
      <ul className="min-w-0 divide-y divide-[var(--border)]">{analysis.documents.map(doc=><li key={doc.document_id} className="min-w-0 space-y-1 break-words py-2">
        <p className="font-medium">{doc.filename}</p><p className="text-xs text-[var(--text-muted)]">{doc.evidence_state==="CLAIM_PROPOSED"?"Proposed claim source":doc.evidence_state==="NO_INDEXED_EVIDENCE"?"No indexed evidence":"No claim proposed"} / {doc.consulted_sources.length} original chunks consulted</p>
      </li>)}</ul>
    </details>
    <p className="text-xs text-[var(--text-muted)]">Proposed expiry or revocation is not a verified current status. Review source dates, versions, issuer and product applicability.</p>
  </section>;
}
