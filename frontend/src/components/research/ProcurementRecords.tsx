"use client";
import {procurementFields,type ProcurementField,type ResearchProcurement} from "@/lib/research-procurement";

const labels:Record<ProcurementField,string>={notice_id:"Notice identifier",title:"Title",buyer:"Buyer",supplier:"Supplier",lot:"Lot",value:"Value wording",
  currency:"Currency wording",deadline:"Deadline wording",lifecycle_status:"Lifecycle wording",classification:"Classification wording",jurisdiction:"Jurisdiction",
  source_date:"Source date wording",amendment_of:"Amendment reference"};
export function ProcurementRecords({analysis,sourcePrefix}:{analysis:ResearchProcurement;sourcePrefix?:string}) {
  return <section aria-label="Procurement records" className="mb-4 min-w-0 space-y-3 text-sm">
    <p className="font-medium">{analysis.records.length} proposed records / independent review required / not verified notices</p>
    <p className="text-xs text-[var(--text-muted)]">Source wording only. Values are not converted; deadlines and lifecycle wording do not establish current eligibility, an award or a ranking.</p>
    {!analysis.records.length&&<p>No source-anchored records were returned from the bounded excerpts. This is not a complete market search or proof of no opportunities.</p>}
    <ol className="min-w-0 divide-y divide-[var(--border)]">{analysis.records.map((row,index)=><li key={index} className="min-w-0 py-3">
      <details className="min-w-0">
        <summary className="cursor-pointer whitespace-pre-wrap break-words font-medium">{index+1}. Proposed {row.kind.toLowerCase().replaceAll("_"," ")}: {row.fields.notice_id.quote}</summary>
        <p className="my-2 break-words text-xs text-[var(--text-muted)]">{analysis.documents.find(doc=>doc.document_id===row.source_document_id)?.filename}</p>
        <dl className="min-w-0 space-y-3">{procurementFields.map(field=>{
          const anchor=row.fields[field];
          return <div key={field} className="min-w-0"><dt className="font-medium">{labels[field]}</dt><dd className="whitespace-pre-wrap break-words">
            {anchor?<blockquote>{anchor.quote}{" "}{sourcePrefix?<a className="underline" href={`#${sourcePrefix}-${anchor.citation_id}`}>[{anchor.citation_id}]</a>:<span>[{anchor.citation_id}]</span>}</blockquote>:<span className="text-[var(--text-muted)]">Not established by this record</span>}
          </dd></div>;
        })}</dl>
        <h6 className="mt-3 font-medium">Qualifications and limitations</h6>
        <ul className="list-disc space-y-1 break-words pl-5">{row.limitations.map((value,i)=><li key={i} className="whitespace-pre-wrap">{value}</li>)}</ul>
      </details>
    </li>)}</ol>
    <div><h6 className="font-medium">Unresolved procurement evidence gaps</h6>
      {analysis.gaps.length?<ul className="list-disc space-y-2 break-words pl-5">{analysis.gaps.map((gap,i)=><li key={i}>{gap.description}
        {gap.document_id&&<span className="block text-xs text-[var(--text-muted)]">{analysis.documents.find(doc=>doc.document_id===gap.document_id)?.filename}</span>}
      </li>)}</ul>:<p>No additional gaps proposed; this does not prove complete coverage or eligibility.</p>}
    </div>
    {analysis.rejections.length>0&&<p className="text-amber-700 dark:text-amber-300">{analysis.rejections.length} proposed records omitted: unconfirmed anchors, mixed original documents or repeated records.</p>}
    <details><summary className="cursor-pointer font-medium">Consulted source scope ({analysis.documents.length})</summary>
      <ul className="min-w-0 divide-y divide-[var(--border)]">{analysis.documents.map(doc=><li key={doc.document_id} className="min-w-0 space-y-1 break-words py-2">
        <p className="font-medium">{doc.filename}</p><p className="text-xs text-[var(--text-muted)]">{doc.evidence_state==="RECORD_PROPOSED"?"Proposed record source":doc.evidence_state==="NO_INDEXED_EVIDENCE"?"No indexed evidence":"No record proposed"} / {doc.consulted_sources.length} original chunks consulted</p>
      </li>)}</ul>
    </details>
  </section>;
}
