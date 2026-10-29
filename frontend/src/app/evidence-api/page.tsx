"use client";
import {useEffect,useRef,useState} from "react";
import {Code2,RefreshCw} from "lucide-react";
import Link from "@/components/layout/StaticLink";
import {AuthRequiredState} from "@/components/auth/AuthRequiredState";
import {ObligationCandidates} from "@/components/research/ObligationCandidates";
import {FindingServingRights} from "@/components/findings/FindingServingRights";
import {useStore} from "@/hooks/useStore";
import {listObligationEvidence,readObligationEvidence,type ApiRequestContext} from "@/lib/api";
import {obligationStateLabel,servingActionLabel,type ObligationEvidenceDetail,type ObligationEvidenceSummary,type ServingAction} from "@/lib/obligation-evidence";
const button="rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-medium disabled:opacity-50";
const field="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-2 text-sm";
export default function EvidenceApiPage() {
  const authMode=useStore(state=>state.authMode),userId=useStore(state=>state.authUser?.id),workspaceId=useStore(state=>state.workspaceId);
  const [action,setAction]=useState<ServingAction>("SERVE_API");
  if(authMode!=="authenticated")return <div className="p-6"><AuthRequiredState authMode={authMode} nextPath="/evidence-api" title="Sign in to inspect obligation evidence"/></div>;
  if(!workspaceId)return <p role="status" className="p-6">Choose a workspace to inspect its shared obligation evidence.</p>;
  return <div role="region" aria-label="Obligation evidence reader" tabIndex={0} className="h-full min-w-0 overflow-y-auto p-4 md:p-8"><div className="mx-auto max-w-6xl space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="flex items-center gap-2 text-2xl font-bold"><Code2/>Evidence API</h1>
      <p className="mt-2 text-sm text-[var(--text-muted)]">Inspect source-backed obligation candidates shared with you, with current review and serving permission.</p></div><Link className={button} href="/findings">Findings & rights review</Link></div>
    <label className="block max-w-sm text-sm">Reader action<select className={field} value={action} onChange={event=>setAction(event.target.value as ServingAction)}><option value="SERVE_API">REST API</option><option value="SERVE_MCP">Custom MCP</option></select></label>
    <Reader key={`${authMode}:${userId}:${workspaceId}:${action}`} context={{workspaceId,expectedUserId:userId??null}} action={action}/>
  </div></div>;
}
function Reader({context,action}:{context:ApiRequestContext;action:ServingAction}) {
  const [items,setItems]=useState<ObligationEvidenceSummary[]>([]),[after,setAfter]=useState<string|null>(null),[detail,setDetail]=useState<ObligationEvidenceDetail|null>(null);
  const [detailInvalidated,setDetailInvalidated]=useState(false);
  const [busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[retryAt,setRetryAt]=useState<number|null>(null);
  const alive=useRef(true),inFlight=useRef(false),retryRequest=useRef<(()=>Promise<void>)|null>(null);
  useEffect(()=>{if(retryAt===null)return;const remaining=retryAt-Date.now();if(remaining<=0){setRetryAt(null);return;}
    const timer=window.setInterval(()=>{if(Date.now()>=retryAt)setRetryAt(null);},Math.min(remaining,1000));return()=>window.clearInterval(timer);},[retryAt]);
  async function operate(callback:()=>Promise<void>) {
    if(inFlight.current||retryAt!==null&&retryAt>Date.now())return;retryRequest.current=callback;inFlight.current=true;setBusy(true);setError(null);
    try{await callback();}catch(error){if(alive.current){setError(error instanceof Error?error.message:"Obligation evidence could not be confirmed.");
      if(error&&typeof error==="object"&&"retryAfterSeconds" in error&&typeof error.retryAfterSeconds==="number"&&error.retryAfterSeconds>0)setRetryAt(Date.now()+error.retryAfterSeconds*1000);
    }}finally{inFlight.current=false;if(alive.current)setBusy(false);}
  }
  async function read(id:string,revision:number){setDetail(null);setDetailInvalidated(false);const value=await readObligationEvidence(id,revision,action,context);if(alive.current)setDetail(value);}
  async function load(){setItems([]);setAfter(null);setDetail(null);setDetailInvalidated(false);const value=await listObligationEvidence(action,context);if(!alive.current)return;
    setItems(value.items);setAfter(value.next_after);const query=new URLSearchParams(window.location.search),id=query.get("finding"),revision=query.get("revision");
    if(id){
      if(!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)||revision!==null&&(!/^[1-9]\d*$/.test(revision)||!Number.isSafeInteger(Number(revision))))throw new Error("The obligation evidence link is invalid. Select a saved Finding and its exact revision.");
      const canonical=id.toLowerCase(),linked=value.items.find(row=>row.finding_id===canonical);
      if(revision!==null)await read(canonical,Number(revision));else if(linked)await read(linked.finding_id,linked.revision);else throw new Error("This Finding is outside the first page. Use a link with its exact revision, or load the following pages.");
    }
  }
  const initialLoad=useRef(()=>operate(load));
  useEffect(()=>{alive.current=true;void initialLoad.current();return()=>{alive.current=false;};},[]); // Parent key binds identity and action.
  const blocked=busy||retryAt!==null;
  return <>
    <div className="flex flex-wrap items-center gap-3"><button className={button} disabled={blocked} onClick={()=>void operate(load)}><RefreshCw size={14} className="mr-2 inline"/>Reload evidence list</button><p className="text-xs text-[var(--text-muted)]">{servingActionLabel(action)} · private workspace scope · up to 50 source versions per saved result</p></div>
    {busy&&<p role="status" className="text-sm">Checking current source, review and serving rights…</p>}
    {error&&<div role="alert" className="space-y-2 rounded-lg border border-red-400/40 p-3 text-sm text-red-600"><p className="break-words">{error}</p><button className={button} disabled={blocked} onClick={()=>void operate(retryRequest.current??load)}>Retry current request</button></div>}
    {retryAt!==null&&<p role="status" className="text-sm">The service asked you to wait. Retry after <time dateTime={new Date(retryAt).toISOString()}>{new Date(retryAt).toLocaleTimeString()}</time>.</p>}
    <div className="grid min-w-0 items-start gap-5 md:grid-cols-[minmax(200px,1fr)_minmax(0,2fr)]">
      <section aria-label="Accessible obligation Findings" className="min-w-0 space-y-3 rounded-xl border border-[var(--border)] p-4"><h2 className="font-semibold">Saved obligation Findings</h2>
        {!items.length&&!busy&&!error&&<p className="text-sm">No accessible saved obligation analysis. Save a source-backed Obligation Analysis result in Research, or ask its owner to share a Finding.</p>}
        <ul className="space-y-2">{items.map((row,index)=><li key={row.finding_id}><button className={`${button} w-full min-w-0 text-left`} disabled={blocked} aria-pressed={detail?.finding_id===row.finding_id} onClick={()=>void operate(()=>read(row.finding_id,row.revision))}>
          <span className="block">Obligation Finding {index+1} · revision {row.revision}</span><span className="block break-all text-xs">{row.finding_id}</span><span className="block text-xs">{detailInvalidated&&detail?.finding_id===row.finding_id?"Recheck serving rights":obligationStateLabel[row.state]}</span></button></li>)}</ul>
        {after&&<button className={button} disabled={blocked} onClick={()=>void operate(async()=>{const cursor=after,value=await listObligationEvidence(action,context,cursor);if(!alive.current)return;
          if(value.next_after===cursor)throw new Error("The evidence cursor did not advance. Reload before retrying.");setItems(previous=>[...previous,...value.items]);setAfter(value.next_after);
        })}>Load more obligation Findings</button>}
      </section>
      <section aria-label="Selected obligation evidence" className="min-w-0 space-y-4 rounded-xl border border-[var(--border)] p-4"><h2 className="font-semibold">{detailInvalidated?"Recheck selected obligation Finding":detail?.title??"Select a saved obligation Finding"}</h2>
        {detail&&<><p className="text-sm">Revision {detail.revision} · {servingActionLabel(detail.action)} · {detailInvalidated?"Current serving state must be rechecked":obligationStateLabel[detail.state]}</p>
          <dl className="grid gap-2 text-sm sm:grid-cols-3"><div><dt className="font-medium">Sources</dt><dd>{detailInvalidated?"Recheck required":detail.source_state==="CURRENT"?"Current":"Unavailable or changed"}</dd></div><div><dt className="font-medium">Finding review</dt><dd>{detailInvalidated?"Recheck required":detail.review_state.replaceAll("_"," ")}</dd></div><div><dt className="font-medium">Serving rights</dt><dd>{detailInvalidated?"Recheck required":detail.rights_state.replaceAll("_"," ")}</dd></div></dl>
          <div className="flex flex-wrap gap-2"><Link className={button} href={`/findings?finding=${encodeURIComponent(detail.finding_id)}`}>Inspect Finding & rights</Link><button className={button} disabled={blocked} onClick={()=>void operate(()=>read(detail.finding_id,detail.revision))}>Recheck selected evidence</button></div>
          {detailInvalidated&&<p role="status" className="text-sm">Serving rights changed. Recheck this Finding before viewing its content.</p>}
          {detail.state!=="READY"&&<p className="text-sm">Content is withheld. Current source versions, independent approval of this revision and permission for this serving action must all be confirmed.</p>}
          <FindingServingRights key={`${detail.finding_id}:${detail.revision}:${action}`} finding={{id:detail.finding_id,revision:detail.revision}} context={context} parentBusy={blocked} initialAction={action}
            onRightsConfirmed={rights=>{if(detail.state==="READY"&&rights.action===action&&!rights.eligible)setDetailInvalidated(true);}}/>
          {!detailInvalidated&&detail.result?.obligations&&<><p className="whitespace-pre-wrap break-words text-sm">{detail.result.question}</p><details className="text-sm"><summary className="cursor-pointer font-medium">Saved analysis text</summary><p className="whitespace-pre-wrap break-words">{detail.result.answer}</p><p className="mt-2 text-xs">{detail.result.coverage.chunks_considered} original chunks considered · not exhaustive · {detail.result.claim_state.replaceAll("_"," ")}</p></details>
            <ObligationCandidates analysis={detail.result.obligations} sourcePrefix={`obligation-${detail.finding_id}`}/>
            <section aria-label="Original source evidence" className="space-y-3"><h3 className="font-semibold">Original source evidence</h3>{detail.evidence.map(row=><blockquote key={row.id} id={`obligation-${detail.finding_id}-${row.citation_id}`} tabIndex={-1} className="min-w-0 space-y-2 border-l-2 border-brand-400 pl-3 text-sm"><p className="whitespace-pre-wrap break-words">{row.original_text}</p><p className="break-words">[{row.citation_id}] {row.filename} · {row.freshness}</p><p className="break-all font-mono text-xs">Version {row.version_id} · SHA256 {row.original_content_hash}</p><p className="break-words text-xs">Location: {JSON.stringify(row.location)}</p><Link className="inline-block underline" href={`/documents/${encodeURIComponent(row.document_id)}`}>Inspect source document</Link></blockquote>)}</section>
            <details className="min-w-0 text-sm"><summary className="cursor-pointer font-medium">Serving attribution and duties ({detail.rights.length} source versions)</summary><ul className="space-y-3">{detail.rights.map(row=><li key={row.version_id} className="min-w-0 space-y-1 py-2"><p className="break-words font-medium">{row.filename}</p><p className="whitespace-pre-wrap break-words">{row.policy?.attribution}</p><ul className="list-inside list-disc">{row.policy?.duties.map((duty,index)=><li key={index} className="break-words">{duty}</li>)}</ul><p className="break-words">Rights evidence: {row.policy?.evidence_reference}</p><p className="whitespace-pre-wrap break-words">{row.policy?.rationale}</p>{row.policy?.review_by&&<p>Rights review by <time dateTime={row.policy.review_by}>{new Date(row.policy.review_by).toLocaleString()}</time></p>}</li>)}</ul></details>
            <details className="text-sm"><summary className="cursor-pointer font-medium">Independent revision reviews ({detail.reviews.length})</summary><ul className="space-y-3">{detail.reviews.map(row=><li key={row.reviewer_id} className="space-y-1 py-2"><p className="break-all">{row.reviewer_id} · {row.decision} · revision {row.revision}</p><p className="whitespace-pre-wrap break-words">{row.comment}</p>{row.created_at&&<time dateTime={row.created_at}>{new Date(row.created_at).toLocaleString()}</time>}</li>)}</ul></details>
          </>}
        </>}
        <p className="text-xs text-[var(--text-muted)]">A reviewed Finding still contains review-required candidates. Applicability remains undetermined and proposed controls are not implemented or certified. This bounded review is not a complete legal register.</p>
      </section>
    </div>
    <details className="rounded-xl border border-[var(--border)] p-4 text-sm"><summary className="cursor-pointer font-semibold">Machine-client request</summary><p className="my-2">Use your own Supabase session token and current workspace binding. Never paste a token into this page.</p>
      <pre className="overflow-x-auto rounded-lg bg-[var(--bg-secondary)] p-3 text-xs" aria-label="Machine request example">{action==="SERVE_API"?"GET /api/v2/obligations?limit=20\nAuthorization: Bearer <your-session-token>\nX-Workspace-ID: <current-workspace>":'POST /api/v2/mcp/execute\nAuthorization: Bearer <your-session-token>\nX-Workspace-ID: <current-workspace>\nContent-Type: application/json\n\n{"operation":"obligation_lookup","limit":20}'}</pre>
      <p className="mt-2 text-xs text-[var(--text-muted)]">Custom MCP uses the nexusrag-evidence-mcp/1 HTTP envelope. Standard MCP client interoperability has not been verified. Procurement and Passport domain readers remain unavailable.</p>
    </details>
  </>;
}
