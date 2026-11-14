import Link from "@/components/layout/StaticLink";
import type {RadarOrigin} from "@/lib/radar";

export function RadarOriginPanel({origin}:{origin:RadarOrigin}){
  return <section aria-label="Radar Finding origin" className="min-w-0 space-y-3 rounded-lg border border-[var(--border)] p-3 text-sm">
    <h3 className="font-semibold">Supplied-snapshot change evidence</h3>
    <p>{origin.materiality.replaceAll("_"," ")} · Snapshot-pair review: {origin.review_state.replaceAll("_"," ")}</p>
    <p>Compared selected originals. This is not an independently fetched official source, a complete-file comparison or a legal certification.</p>
    {origin.provider_id&&<p className="break-words">Provider: {origin.provider_id}</p>}
    {origin.source_url&&<p className="break-all">Declared source: {origin.source_url}</p>}
    {!origin.source_available&&<p role="status">Source evidence is unavailable; content and downloads are withheld.</p>}
    <dl className="space-y-2 text-xs">
      {origin.before&&<div><dt className="font-semibold">Before snapshot</dt><dd className="break-all">Revision {origin.before.revision} · Version {origin.before.version_id} · Original SHA256 {origin.before.document_original_hash}</dd></div>}
      <div><dt className="font-semibold">After snapshot</dt><dd className="break-all">Revision {origin.after.revision} · Version {origin.after.version_id} · Original SHA256 {origin.after.document_original_hash}</dd></div>
      <div><dt className="font-semibold">Normalized compared evidence</dt><dd className="break-all">Before: {origin.previous_hash??"No earlier selection"}<br/>After: {origin.current_hash}</dd></div>
    </dl>
    {origin.affected_workflows.length>0&&<div><h4 className="font-semibold">Reviewed affected workflows</h4><ul className="list-inside list-disc">{origin.affected_workflows.map((value,index)=><li className="break-words" key={index}>{value}</li>)}</ul></div>}
    <p>This snapshot-pair review does not approve a later Finding revision. Inspect the exact evidence, then use the independent Finding review and source-version export rights.</p>
    <Link className="inline-block underline" href={`/radar?source=${origin.source_id}&change=${origin.id}`}>Inspect saved Radar change and review history</Link>
  </section>;
}
