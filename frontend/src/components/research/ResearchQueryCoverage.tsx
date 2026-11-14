import {Search} from "lucide-react";
import type {ResearchQueryRetrieval} from "@/lib/research-run";

export function ResearchQueryCoverage({retrieval}:{retrieval:ResearchQueryRetrieval}) {
  return <details className="my-3 min-w-0 border-t border-[var(--border)] pt-2">
    <summary className="cursor-pointer break-words text-sm"><Search aria-hidden="true" size={14} className="mr-1 inline"/>Search queries ({retrieval.completed_queries} of {retrieval.queries.length} completed)</summary>
    <p className="my-2 text-xs text-[var(--text-muted)]">Search queries are not evidence. Bounded retrieval does not establish complete coverage or claim support.</p>
    {retrieval.expansion_status==="INVALID_RESPONSE_ORIGINAL_ONLY"&&<p className="my-2 text-xs text-amber-700 dark:text-amber-300">Alternative query generation returned no usable response. Only the original query was searched.</p>}
    {retrieval.rejected_queries>0&&<p className="my-2 text-xs">{retrieval.rejected_queries} duplicate or nonconforming alternatives excluded.</p>}
    <ol className="list-inside list-decimal space-y-1 text-sm">
      {retrieval.queries.map((query,index)=><li className="whitespace-pre-wrap break-words" key={query}><span className="font-medium">{index?"Alternative":"Original"}: </span>{query}</li>)}
    </ol>
    <p className="mt-2 break-words text-xs text-[var(--text-muted)]">Expansion model: {retrieval.expansion_model}. Expansion and embedding may consume provider quota; actual cost can remain unknown.</p>
  </details>;
}
