"use client";

import {useEffect,useRef,useState} from "react";
import Link from "@/components/layout/StaticLink";
import {AuthRequiredState} from "@/components/auth/AuthRequiredState";
import {useStore} from "@/hooks/useStore";
import {useDocuments} from "@/hooks/useDocuments";
import {captureRadarSnapshot,createRadarFinding,createRadarSource,getCurrentWorkspace,listRadarProviders,listRadarReviews,listRadarRuns,listRadarSources,
  readRadarChange,readRadarChunks,readRadarSource,reviewRadarChange} from "@/lib/api";
import {radarKinds,radarUuid,type RadarSource,type RadarSourceDetail,type RadarChangeDetail,type RadarChunks,type RadarKind,type RadarProvider} from "@/lib/radar";

const control="w-full min-w-0 rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-2 text-sm";
const button="rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-medium disabled:opacity-50";
const failure=(error:unknown)=>error instanceof Error?error.message:"The operation was not confirmed. Refresh before retrying.";
const label=(value:string)=>value.replaceAll("_"," ");
const localNow=()=>{const date=new Date();return new Date(date.getTime()-date.getTimezoneOffset()*60_000).toISOString().slice(0,16);};

export default function RadarPage(){
  const auth=useStore(s=>s.authMode),user=useStore(s=>s.authUser?.id),workspace=useStore(s=>s.workspaceId);
  if(auth!=="authenticated")return <AuthRequiredState authMode={auth} nextPath="/radar" title="Sign in to your terms and quota workspace"/>;
  if(!workspace)return <p role="status" className="p-6">Choose a workspace before opening Radar.</p>;
  return <RadarWorkspace key={JSON.stringify([user,workspace])} workspace={workspace} user={user??null}/>;
}
function RadarWorkspace({workspace,user}:{workspace:string;user:string|null}){
  const context={workspaceId:workspace,expectedUserId:user};
  const {documents,loading:documentsLoading,error:documentError}=useDocuments();
  const [sources,setSources]=useState<RadarSource[]>([]),[nextSource,setNextSource]=useState<string|null>(null);
  const [providers,setProviders]=useState<RadarProvider[]>([]),[providerAfter,setProviderAfter]=useState<string|null>(null),[role,setRole]=useState("viewer");
  const [detail,setDetail]=useState<RadarSourceDetail|null>(null),[change,setChange]=useState<RadarChangeDetail|null>(null);
  const [provider,setProvider]=useState(""),[title,setTitle]=useState(""),[sourceUrl,setSourceUrl]=useState(""),[kind,setKind]=useState<RadarKind>("QUOTA");
  const [documentId,setDocumentId]=useState(""),[chunks,setChunks]=useState<RadarChunks|null>(null),[selected,setSelected]=useState<string[]>([]),[beforeSelected,setBeforeSelected]=useState<string[]>([]);
  const [captured,setCaptured]=useState(localNow),[rationale,setRationale]=useState("");
  const [decision,setDecision]=useState<"approved"|"changes_requested">("approved"),[comment,setComment]=useState(""),[affected,setAffected]=useState("");
  const [findingTitle,setFindingTitle]=useState(""),[findingNote,setFindingNote]=useState("");
  const [busy,setBusy]=useState(true),[error,setError]=useState<string|null>(null),[status,setStatus]=useState<string|null>(null),[reload,setReload]=useState(0);
  const alive=useRef(true),sequence=useRef(0),pending=useRef(false),intents=useRef(new Map<string,{body:string;key:string}>());
  const canWrite=["owner","admin","editor"].includes(role);
  const latest=detail?.latest_snapshot??null;
  const selectedCount=new Set([...beforeSelected,...selected]).size;
  const remaining=156-beforeSelected.length;
  function showSource(value:RadarSourceDetail){setDetail(value);setBeforeSelected(value.latest_snapshot?.chunk_ids??[]);}
  useEffect(()=>{const counter=sequence;alive.current=true;return()=>{alive.current=false;counter.current++;};},[]);
  useEffect(()=>{
    let current=true;setBusy(true);setRole("viewer");setError(null);
    Promise.allSettled([listRadarSources(context),listRadarProviders(context),getCurrentWorkspace(context)]).then(async results=>{
      if(!current)return;
      const [sourceResult,providerResult,authority]=results;
      if(sourceResult.status==="fulfilled"){setSources(sourceResult.value.items);setNextSource(sourceResult.value.next_after);}
      if(providerResult.status==="fulfilled"){setProviders(providerResult.value.items);setProviderAfter(providerResult.value.next_after??null);}
      const errors=results.filter(result=>result.status==="rejected").map(result=>failure((result as PromiseRejectedResult).reason));
      if(authority.status==="fulfilled"){
        if(authority.value.workspace_id===workspace&&authority.value.user_id===user&&["owner","admin","editor","viewer"].includes(authority.value.role))setRole(authority.value.role);
        else errors.push("Edit authority could not be verified for this account and workspace. Refresh to retry.");
      }
      if(errors.length)setError(errors.join(" "));
      const params=new URLSearchParams(window.location.search),requested=params.get("source"),requestedChange=params.get("change");
      if(requested){
        if(!radarUuid(requested)||requestedChange&&!radarUuid(requestedChange))throw new Error("The Radar link is invalid. Choose a saved source.");
        const stored=await readRadarSource(requested,context);if(!current)return;showSource(stored);
        if(requestedChange){const record=await readRadarChange(requestedChange,context);if(!current)return;
          if(record.source_id!==requested)throw new Error("The change does not belong to this saved source.");setChange(record);setAffected(record.affected_workflows.join("\n"));}
      }
    }).catch(error=>{if(current)setError(failure(error));}).finally(()=>{if(current)setBusy(false);});
    return()=>{current=false;};
  // Account/workspace changes remount the complete controller.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[workspace,user,reload]);
  async function operate(action:(current:()=>boolean)=>Promise<void>){
    if(pending.current||busy)return;pending.current=true;setBusy(true);setError(null);setStatus(null);
    const operation=++sequence.current,current=()=>alive.current&&sequence.current===operation;
    try{await action(current);}catch(error){if(current())setError(failure(error));}
    finally{if(current()){pending.current=false;setBusy(false);}}
  }
  function intent(operation:string,body:unknown){const encoded=JSON.stringify(body),prior=intents.current.get(operation);
    if(prior?.body===encoded)return prior.key;const key=crypto.randomUUID();intents.current.set(operation,{body:encoded,key});return key;}
  function chooseChange(value:RadarChangeDetail){setChange(value);setAffected(value.affected_workflows.join("\n"));setComment("");setDecision("approved");
    setFindingTitle(Array.from(`${detail?.source.title??"Provider"}: ${label(value.materiality)} change`).slice(0,160).join(""));
    setFindingNote("");window.history.replaceState(null,"",`/radar?source=${value.source_id}&change=${value.id}`);}
  async function openSource(id:string,current:()=>boolean){const value=await readRadarSource(id,context);if(!current())return;
    showSource(value);setChange(null);setChunks(null);setSelected([]);setDocumentId("");setStatus(null);window.history.replaceState(null,"",`/radar?source=${id}`);}
  const create=()=>operate(async current=>{
    const body={provider_id:provider,title:title.trim(),source_url:new URL(sourceUrl.trim()).href,kind};
    if(Array.from(body.title).length<1||Array.from(body.title).length>160)throw new Error("Source title must contain 1 to 160 characters.");
    const source=await createRadarSource(body,intent("source",body),context);if(!current())return;
    setSources(items=>[source,...items.filter(item=>item.id!==source.id)]);await openSource(source.id,current);if(current())setStatus("Source and manual monitor saved. No automatic retrieval is enabled.");
  });
  const capture=()=>operate(async current=>{
    if(!detail||!chunks||!selected.length)return;
    if(selectedCount>156)throw new Error("The before and after selections share 156 unique-original slots.");
    if(latest&&!beforeSelected.length)throw new Error("Choose at least one original from the previous snapshot to compare.");
    const date=new Date(captured);if(!Number.isFinite(date.getTime()))throw new Error("Choose the actual snapshot capture time.");
    const body={expected_revision:detail.source.revision,document_id:documentId,version_id:chunks.version_id,chunk_ids:selected,
      ...(latest?{before_chunk_ids:beforeSelected}:{}),captured_at:date.toISOString(),rights_rationale:rationale.trim()};
    const result=await captureRadarSnapshot(detail.source.id,body,intent(`capture:${detail.source.id}`,body),context);if(!current())return;
    const refreshed=await readRadarSource(detail.source.id,context);if(!current())return;
    showSource(refreshed);setSources(items=>[result.source,...items.filter(item=>item.id!==result.source.id)]);setSelected([]);
    chooseChange(result.change);setStatus(`Snapshot revision ${result.snapshot.revision} saved with exact selected-original references.`);
  });
  const review=()=>operate(async current=>{
    if(!change)return;const workflows=affected.split("\n").map(value=>value.trim()).filter(Boolean);
    if(workflows.length>50||workflows.some(value=>Array.from(value).length>128))throw new Error("Use at most 50 affected workflows, each at most 128 characters.");
    const body={expected_review_revision:change.review_revision,decision,comment,affected_workflows:workflows};
    const saved=await reviewRadarChange(change.id,body,intent(`review:${change.id}`,body),context);if(!current())return;
    setChange(saved);setStatus("Review saved for this exact snapshot pair. Finding revisions require their own independent review.");
  });
  const finding=()=>operate(async current=>{
    if(!change)return;const body={title:findingTitle.trim(),authored_markdown:findingNote,expected_review_revision:change.review_revision};
    const saved=await createRadarFinding(change.id,body,intent(`finding:${change.id}`,body),context);if(!current())return;
    setChange({...change,finding_id:saved.id});setStatus("Source-linked Finding saved. Open Findings for independent revision review and export rights.");
  });
  return <div className="h-full overflow-y-auto px-4 py-6 md:px-8"><div className="mx-auto max-w-6xl space-y-5">
    <header className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-xl font-semibold">Terms &amp; Quota Radar</h1>
      <p className="mt-1 text-sm text-[var(--text-muted)]">Compare selected evidence from supplied snapshots. Official origin is not independently fetched or verified.</p></div>
      <button className={button} disabled={busy} onClick={()=>setReload(value=>value+1)}>Refresh Radar</button></header>
    <p className="text-sm text-[var(--text-muted)]">Upload permitted copies in <Link href="/documents" className="underline">Documents</Link> first. Use separate retained documents for before and after snapshots. Comparisons cover selected originals, not an entire file. No live fetching, AI or recurring retrieval is enabled.</p>
    {error&&<p role="alert" className="rounded-lg border border-red-300 p-3 text-sm">{error}</p>}
    {status&&<p role="status" className="rounded-lg border border-emerald-500 p-3 text-sm">{status}</p>}
    <div className="grid min-w-0 gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
      <aside aria-label="Saved Radar sources" className="min-w-0"><h2 className="mb-2 font-semibold">Saved sources</h2>
        {!sources.length&&<p className="text-sm">{busy?"Loading sources...":"No saved sources"}</p>}
        <ul>{sources.map(source=><li key={source.id} className="border-b border-[var(--border)]"><button className="w-full break-words py-3 text-left text-sm disabled:opacity-50" disabled={busy}
          onClick={()=>void operate(current=>openSource(source.id,current))}>{source.title}<span className="block text-xs">{source.provider_id} · Revision {source.revision}</span></button></li>)}</ul>
        {nextSource&&<button className={button} disabled={busy} onClick={()=>void operate(async current=>{const page=await listRadarSources(context,nextSource);if(current()){
          setSources(items=>[...items,...page.items.filter(row=>!items.some(old=>old.id===row.id))]);setNextSource(page.next_after);}})}>Load more sources</button>}
        <button className={`${button} mt-4`} disabled={busy||!canWrite} onClick={()=>{setDetail(null);setChange(null);window.history.replaceState(null,"","/radar");}}>New source</button>
      </aside>
      <main className="min-w-0 space-y-6">
        {!detail?<section aria-label="New Radar source" className="space-y-3"><h2 className="font-semibold">New supplied source</h2>
          <label className="block text-sm">Provider<select className={control} value={provider} disabled={busy||!canWrite} onChange={event=>setProvider(event.target.value)}><option value="">Choose a registered provider</option>
            {providers.map(p=><option key={p.id} value={p.id}>{p.display_name} · {label(p.rights.state)}</option>)}</select></label>
          {providerAfter&&<button className={button} disabled={busy} onClick={()=>void operate(async current=>{const page=await listRadarProviders(context,providerAfter);if(current()){
            setProviders(items=>[...items,...page.items.filter(row=>!items.some(old=>old.id===row.id))]);setProviderAfter(page.next_after??null);}})}>Load more providers</button>}
          <label className="block text-sm">Source title<input className={control} value={title} maxLength={320} onChange={event=>setTitle(event.target.value)} disabled={busy||!canWrite}/></label>
          <label className="block text-sm">Declared source URL<input type="url" className={control} value={sourceUrl} maxLength={4000} placeholder="https://provider.example/quota" onChange={event=>setSourceUrl(event.target.value)} disabled={busy||!canWrite}/></label>
          <label className="block text-sm">Snapshot kind<select className={control} value={kind} onChange={event=>setKind(event.target.value as RadarKind)} disabled={busy||!canWrite}>{radarKinds.map(value=><option key={value} value={value}>{label(value)}</option>)}</select></label>
          <button className={button} disabled={busy||!canWrite||!provider||!title.trim()||!sourceUrl.trim()} onClick={()=>void create()}>Save source</button>
        </section>:<>
          <section aria-label="Stored Radar source" className="min-w-0 space-y-2"><h2 className="break-words text-lg font-semibold">{detail.source.title}</h2>
            <p className="break-all text-sm">{detail.source.source_url}</p><p className="text-sm">{detail.source.provider_id} · {label(detail.source.kind)} · Revision {detail.source.revision}</p>
            <p className="text-sm">Current display policy: {label(detail.source.rights.state)} · {label(detail.source.rights.reason_code)}</p>
            <p className="text-sm">Manual monitor · Automatic retrieval disabled{detail.source.monitor.latest_run?` · Last run: ${label(detail.source.monitor.latest_run.status)}`:""}</p>
            <h3 className="pt-2 text-sm font-semibold">Snapshot history</h3><ul className="space-y-2">{detail.snapshots.items.map(snapshot=><li key={snapshot.id} className="break-words text-sm">
              <button className="text-left underline disabled:opacity-50" disabled={busy} onClick={()=>void operate(async current=>{const value=await readRadarChange(snapshot.change_id,context);if(value.source_id!==detail.source.id)throw new Error("The change does not belong to this source.");if(current())chooseChange(value);})}>Inspect snapshot revision {snapshot.revision}</button>
              <span> · {snapshot.chunk_ids.length} of {snapshot.stored_chunk_count} stored originals selected · {new Date(snapshot.captured_at).toLocaleString()}</span></li>)}</ul>
            {detail.snapshots.next_after&&<button className={button} disabled={busy} onClick={()=>void operate(async current=>{const page=await readRadarSource(detail.source.id,context,detail.snapshots.next_after!);if(current())setDetail(old=>old?{...page,
              snapshots:{...page.snapshots,items:[...old.snapshots.items,...page.snapshots.items.filter(s=>!old.snapshots.items.some(p=>p.id===s.id))]},
              changes:{...page.changes,items:[...old.changes.items,...page.changes.items.filter(s=>!old.changes.items.some(p=>p.id===s.id))]},runs:old.runs}:page);})}>Load more snapshots</button>}
            <section aria-label="Manual snapshot run history" className="space-y-2 pt-3"><h3 className="text-sm font-semibold">Manual snapshot runs</h3>
              <p className="text-xs">Each confirmed capture or recorded failure appears here. A failed attempt does not replace the last confirmed snapshot. Refresh Radar after a failed request to inspect its durable outcome.</p>
              {!detail.runs.items.length&&<p className="text-xs">No confirmed runs</p>}
              <ul className="space-y-2">{detail.runs.items.map(run=><li key={run.id} className="min-w-0 rounded-lg border border-[var(--border)] p-2 text-xs">
                <p>{label(run.status)}{run.materiality?` · ${label(run.materiality)}`:""} · {new Date(run.started_at).toLocaleString()}</p>
                <p className="break-all">Run {run.id}</p>
                {run.metadata.reason_code&&<p>Reason: {label(run.metadata.reason_code)}</p>}
                {run.metadata.last_confirmed_snapshot_id&&<p className="break-all">Last confirmed snapshot: {run.metadata.last_confirmed_snapshot_id}</p>}
                {["BASELINE","UNCHANGED","CHANGED"].includes(run.status)&&<button className="underline disabled:opacity-50" disabled={busy}
                  onClick={()=>void operate(async current=>{const value=await readRadarChange(run.id,context);if(value.source_id!==detail.source.id)throw new Error("The run does not belong to this source.");if(current())chooseChange(value);})}>Inspect run evidence</button>}
              </li>)}</ul>
              {detail.runs.next_after&&<button className={button} disabled={busy} onClick={()=>void operate(async current=>{const page=await listRadarRuns(detail.source.id,context,detail.runs.next_after!);
                if(page.items.some(run=>run.monitor_id!==detail.source.monitor.id))throw new Error("Run history does not belong to this source.");
                if(current())setDetail(old=>old?{...old,runs:{...page,items:[...old.runs.items,...page.items.filter(run=>!old.runs.items.some(prior=>prior.id===run.id))]}}:old);})}>Load more manual runs</button>}
            </section>
          </section>
          <section aria-label="Capture supplied snapshot" className="space-y-3 border-t border-[var(--border)] pt-4"><h3 className="font-semibold">Capture selected snapshot evidence</h3>
            {latest&&<fieldset className="space-y-2"><legend className="text-sm font-semibold">Before evidence from snapshot revision {latest.revision}</legend>
              <p className="text-xs">Choose the previous originals to compare. The saved snapshot stays unchanged; this comparison records your exact subset.</p>
              <div className="max-h-60 space-y-2 overflow-y-auto">{latest.selected_originals.map(original=><label key={original.id} className="flex items-start gap-2 rounded-lg border border-[var(--border)] p-2 text-sm">
                <input type="checkbox" checked={beforeSelected.includes(original.id)} disabled={busy||!canWrite||!beforeSelected.includes(original.id)&&!selected.includes(original.id)&&selectedCount>=156}
                  onChange={event=>setBeforeSelected(ids=>event.target.checked?[...ids,original.id]:ids.filter(id=>id!==original.id))}/>
                <span className="min-w-0">Before original {original.chunk_index} · {original.original_bytes} UTF-8 bytes<code className="block break-all text-xs">SHA256 {original.original_content_hash}</code></span>
              </label>)}</div><Link className="text-sm underline" href={`/documents/${latest.document_id}`}>Inspect the retained before document</Link></fieldset>}
            {documentError&&<p role="alert">{documentError}</p>}
            <label className="block text-sm">Retained document<select className={control} value={documentId} disabled={busy||!canWrite||documentsLoading||Boolean(documentError)} onChange={event=>{
              const id=event.target.value;setDocumentId(id);setChunks(null);setSelected([]);if(id)void operate(async current=>{const page=await readRadarChunks(id,context);if(current())setChunks(page);});}}>
              <option value="">Choose a ready document</option>{documents.filter(d=>d.status==="ready").map(doc=><option key={doc.document_id} value={doc.document_id}>{doc.filename}</option>)}</select></label>
            {chunks&&<><p className="break-all text-xs">Pinned version {chunks.version_id} · Original file {chunks.document_original_bytes} bytes · SHA256 {chunks.document_original_hash}</p>
              <p className="text-sm">Choose exact after originals ({selected.length} selected; {selectedCount} unique originals across both sides, maximum 156). {remaining} new after originals fit alongside the current before selection.</p>
              <ul className="max-h-80 space-y-2 overflow-y-auto">{chunks.items.map(chunk=><li key={chunk.id} className="rounded-lg border border-[var(--border)] p-3"><label className="flex items-start gap-2 text-sm" aria-label={`After original ${chunk.chunk_index}`}>
                <input type="checkbox" checked={selected.includes(chunk.id)} disabled={busy||!canWrite||!selected.includes(chunk.id)&&!beforeSelected.includes(chunk.id)&&selectedCount>=156}
                  onChange={event=>setSelected(ids=>event.target.checked?[...ids,chunk.id]:ids.filter(id=>id!==chunk.id))}/>
                <span className="min-w-0"><span className="block">Original {chunk.chunk_index} · {chunk.original_bytes} UTF-8 bytes</span><span className="block whitespace-pre-wrap break-words text-xs">{chunk.preview}{chunk.preview_truncated?"… (preview)":""}</span>
                  <code className="block break-all text-xs">SHA256 {chunk.original_content_hash}</code></span></label></li>)}</ul>
              {chunks.next_after&&<button className={button} disabled={busy} onClick={()=>void operate(async current=>{const page=await readRadarChunks(documentId,context,chunks.next_after!,chunks.version_id);if(current())setChunks(old=>old?{...page,items:[...old.items,...page.items.filter(row=>!old.items.some(p=>p.id===row.id))]}:page);})}>Load more originals</button>}
              <Link href={`/documents/${documentId}`} className="text-sm underline">Inspect retained document and full originals</Link></>}
            <label className="block text-sm">Snapshot captured at<input type="datetime-local" className={control} value={captured} onChange={event=>setCaptured(event.target.value)} disabled={busy||!canWrite}/></label>
            <label className="block text-sm">Permission for supplied evidence<textarea className={control} rows={3} maxLength={4000} value={rationale} onChange={event=>setRationale(event.target.value)} disabled={busy||!canWrite}/></label>
            <p className="text-xs text-[var(--text-muted)]">Describe permission to retain, display and manually monitor this supplied copy. Provider policy still governs each action; this declaration cannot approve fetching, AI or export.</p>
            <button className={button} disabled={busy||!canWrite||!chunks||!selected.length||Boolean(latest&&!beforeSelected.length)||selectedCount>156||!rationale.trim()} onClick={()=>void capture()}>Save selected snapshot</button>
          </section>
          {change&&<section aria-label="Selected Radar change" className="min-w-0 space-y-3 border-t border-[var(--border)] pt-4"><h3 className="font-semibold">Selected evidence change</h3>
            <p className="text-sm">{label(change.status)} · {label(change.materiality)} · Review: {label(change.review_state)}</p>
            <p className="text-sm">Selected chunks only. Materiality is a review candidate, not a legal or semantic certification.</p>
            {!change.source_available&&<p role="status">Source evidence is unavailable. Content and new actions are withheld.</p>}
            <div className="grid min-w-0 gap-3 md:grid-cols-2">{[["Before",change.before_text_preview],["After",change.after_text_preview]].map(([name,preview])=><div key={name} className="min-w-0 rounded-lg border border-[var(--border)] p-3"><h4 className="text-sm font-semibold">{name}</h4><p className="whitespace-pre-wrap break-words text-sm">{preview??(name==="Before"&&!change.before?"No earlier snapshot":"Content withheld")}</p></div>)}</div>
            {change.preview_truncated&&<p className="text-xs">Preview shortened. Inspect the retained originals before reviewing.</p>}
            <details><summary className="cursor-pointer text-sm">Exact versions and comparison hashes</summary><div className="space-y-2 py-2 text-xs">{[change.before,change.after].filter(Boolean).map(snapshot=><p className="break-all" key={snapshot!.id}>Snapshot {snapshot!.revision} · Version {snapshot!.version_id} · Normalized selected hash {snapshot!.normalized_hash} · Original file hash {snapshot!.document_original_hash}</p>)}</div></details>
            <p className="break-all text-xs">Compared before hash: {change.previous_hash??"No baseline"} · Compared after hash: {change.current_hash}. A selected before subset can differ from the saved snapshot selection hash.</p>
            <h4 className="text-sm font-semibold">Review this snapshot pair</h4><p className="text-xs">The reviewer must be different from the capturing actor. Review does not change global provider rights.</p>
            <label className="block text-sm">Review decision<select className={control} value={decision} disabled={busy||!canWrite} onChange={event=>setDecision(event.target.value as typeof decision)}><option value="approved">Approve reviewed change</option><option value="changes_requested">Request changes</option></select></label>
            <label className="block text-sm">Review comment<textarea className={control} rows={3} maxLength={8000} value={comment} onChange={event=>setComment(event.target.value)} disabled={busy||!canWrite}/></label>
            <label className="block text-sm">Affected workflows (one per line)<textarea className={control} rows={3} value={affected} onChange={event=>setAffected(event.target.value)} disabled={busy||!canWrite}/></label>
            <button className={button} disabled={busy||!canWrite||!change.source_available||change.after.actor_id===user||change.before?.actor_id===user||change.status!=="CHANGED"} onClick={()=>void review()}>Save exact-pair review</button>
            <ul className="space-y-1 text-xs">{change.reviews.map(r=><li key={r.id}>{r.decision.replaceAll("_"," ")} · {r.reviewer_id} · {new Date(r.created_at).toLocaleString()}<p className="whitespace-pre-wrap break-words">{r.comment}</p></li>)}</ul>
            {change.reviews_next_after!=null&&<button className={button} disabled={busy} onClick={()=>void operate(async current=>{const page=await listRadarReviews(change.id,context,change.reviews_next_after!);if(current())setChange(old=>old?{...old,reviews:[...old.reviews,...page.items.filter(row=>!old.reviews.some(p=>p.id===row.id))],reviews_next_after:page.next_after,review_count:page.review_count}:old);})}>Load more review history</button>}
            {change.finding_id?<Link className="inline-block text-sm underline" href={`/findings?finding=${change.finding_id}`}>Open source-linked Finding</Link>:<div className="space-y-3"><h4 className="text-sm font-semibold">Create a source-linked Finding</h4>
              <label className="block text-sm">Finding title<input className={control} value={findingTitle} maxLength={320} onChange={event=>setFindingTitle(event.target.value)} disabled={busy||!canWrite}/></label>
              <label className="block text-sm">Finding qualifications<textarea className={control} rows={3} maxLength={100000} value={findingNote} onChange={event=>setFindingNote(event.target.value)} disabled={busy||!canWrite}/></label>
              <button className={button} disabled={busy||!canWrite||!change.source_available||change.review_state!=="APPROVED"||!findingTitle.trim()} onClick={()=>void finding()}>Create reviewed-change Finding</button></div>}
          </section>}
        </>}
      </main>
    </div>
  </div></div>;
}
