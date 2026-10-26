"use client";
import {useEffect,useRef,useState} from "react";
import {Download,RefreshCw} from "lucide-react";
import {createFindingPackage,listFindingPackages,readFindingExportRights,readFindingPackage,recordFindingExportRights,type ApiRequestContext,type FindingDetail} from "@/lib/api";
import {findingPackageDownload,type FindingExportPolicy,type FindingExportRights,type FindingPackage} from "@/lib/finding-package";

const button="rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-medium disabled:opacity-50";
const field="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-2 text-sm";
type Summary=Omit<FindingPackage,"manifest_text">;
const emptyPolicy:FindingExportPolicy={decision:"REVIEW_REQUIRED",basis:"UNKNOWN",rationale:"",evidence_reference:"",attribution:"",duties:[],review_by:null};
export function FindingPackages({finding,context,canExport,parentBusy}:{finding:FindingDetail;context:ApiRequestContext;canExport:boolean;parentBusy:boolean}) {
  const [rights,setRights]=useState<FindingExportRights|null>(null),[packages,setPackages]=useState<Summary[]>([]),[after,setAfter]=useState<string|null>(null);
  const [chosen,setChosen]=useState<string[]>([]),[policy,setPolicy]=useState(emptyPolicy),[error,setError]=useState<string|null>(null);
  const [busy,setBusy]=useState(false),[notice,setNotice]=useState<string|null>(null);
  const active=useRef(true),reviewIntent=useRef<string|null>(null),exportIntent=useRef<string|null>(null),inFlight=useRef(false);
  useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
  const blocked=busy||parentBusy;
  const approved=finding.reviews.some(row=>row.decision==="approved"&&row.reviewer_id!==finding.author_id&&row.revision===finding.revision)
    &&!finding.reviews.some(row=>row.decision==="changes_requested"&&row.revision===finding.revision);
  async function operate(action:()=>Promise<void>) {
    if(inFlight.current||parentBusy)return;
    inFlight.current=true;setBusy(true);setError(null);setNotice(null);
    try{await action();}catch(error){if(active.current)setError(error instanceof Error?error.message:"Evidence package operation failed.");}
    finally{inFlight.current=false;if(active.current)setBusy(false);}
  }
  async function load() {
    const [review,list]=await Promise.allSettled([readFindingExportRights(finding.id,context),listFindingPackages(finding.id,context)]);
    if(!active.current)return;
    setRights(review.status==="fulfilled"?review.value:null);
    setPackages(list.status==="fulfilled"?list.value.items:[]);setAfter(list.status==="fulfilled"?list.value.next_after:null);
    setChosen([]);reviewIntent.current=null;exportIntent.current=null;
    const failures=[review,list].flatMap(result=>result.status==="rejected"?[result.reason instanceof Error?result.reason.message:"Evidence package state could not be loaded."]:[]);
    if(failures.length)throw new Error([...new Set(failures)].join(" "));
  }
  function changePolicy(value:Partial<FindingExportPolicy>){setPolicy(previous=>({...previous,...value}));reviewIntent.current=null;}
  function download(value:FindingPackage) {
    if(value.state!=="ready")throw new Error(`Package withheld: ${value.reason??"expired"}. Downloaded copies cannot be recalled.`);
    const url=URL.createObjectURL(new Blob([findingPackageDownload(value)],{type:"application/ld+json"}));
    const link=document.createElement("a");link.href=url;link.download=`finding-${value.finding_id}-r${value.finding_revision}-${value.id}.jsonld`;link.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  return <section aria-label="Evidence packages" className="space-y-3 border-t border-[var(--border)] pt-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">Evidence packages</h3>
      <button className={button} disabled={blocked} onClick={()=>void operate(load)}><RefreshCw size={14} className="mr-2 inline"/>Load export rights & packages</button></div>
    {error&&<p role="alert" className="break-words text-sm text-red-600">{error}</p>}
    {(busy||notice)&&<p role="status" className="break-words text-sm">{busy?"Confirming durable package state…":notice}</p>}
    {!approved&&<p className="text-sm">Independent approval of this exact Finding revision is required.</p>}
    {rights&&<>
      <p className="text-sm">{rights.eligible?"Current source-version rights allow this export.":"Source-version rights are unknown, denied, expired or revoked."}</p>
      <ul className="space-y-3">{rights.items.map(item=><li key={item.version_id} className="min-w-0 space-y-1 text-sm">
        <label className="flex items-start gap-2"><input type="checkbox" disabled={blocked||!rights.can_review} checked={chosen.includes(item.version_id)}
          onChange={event=>{setChosen(previous=>event.target.checked?[...previous,item.version_id]:previous.filter(id=>id!==item.version_id));reviewIntent.current=null;}}/>
          <span className="min-w-0 break-words">{item.filename}</span></label>
        <p className="break-all font-mono text-xs">Version {item.version_id} · SHA256 {item.original_hash}</p>
        <p>{item.policy?.decision??"REVIEW_REQUIRED"} · {item.allowed?"current":"not exportable"}</p>
        {item.policy&&<><p className="whitespace-pre-wrap break-words">{item.policy.rationale}</p><p className="whitespace-pre-wrap break-words">{item.policy.attribution}</p>
          <p className="break-words">Rights evidence: {item.policy.evidence_reference}</p>
          {item.policy.review_by&&<p>Review by <time dateTime={item.policy.review_by}>{new Date(item.policy.review_by).toLocaleString()}</time></p>}
          {item.policy.duties.length>0&&<ul className="list-inside list-disc">{item.policy.duties.map((duty,index)=><li className="break-words" key={index}>{duty}</li>)}</ul>}</>}
      </li>)}</ul>
      {rights.can_review&&<form className="space-y-3" aria-label="Version export rights review" onSubmit={event=>{
        event.preventDefault();void operate(async()=>{
          reviewIntent.current??=crypto.randomUUID();
          const result=await recordFindingExportRights(finding.id,{revision:finding.revision,selections:rights.items.filter(item=>chosen.includes(item.version_id))
            .map(item=>({version_id:item.version_id,expected_review_id:item.review_id})),policy},reviewIntent.current,context);
          if(!active.current)return;setRights(result);setChosen([]);reviewIntent.current=null;exportIntent.current=null;setNotice("Export rights review saved for the selected source versions.");
        });}}>
        <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">Decision<select className={field} disabled={blocked} value={policy.decision}
          onChange={event=>changePolicy({decision:event.target.value as FindingExportPolicy["decision"]})}>
          <option value="REVIEW_REQUIRED">Review required</option><option value="ALLOW">Allow export</option><option value="DENY">Deny export</option><option value="REVOKED">Revoke export</option></select></label>
          <label className="text-sm">Rights basis<select className={field} disabled={blocked} value={policy.basis} onChange={event=>changePolicy({basis:event.target.value as FindingExportPolicy["basis"]})}>
            <option value="UNKNOWN">Unknown</option><option value="OWNED_CONTENT">Owned content</option><option value="LICENSE">Licence</option><option value="PERMISSION">Permission</option><option value="PUBLIC_DOMAIN">Public domain</option></select></label></div>
        <label className="block text-sm">Review rationale<textarea className={field} required maxLength={2000} disabled={blocked} value={policy.rationale} onChange={event=>changePolicy({rationale:event.target.value})}/></label>
        <label className="block text-sm">Rights evidence reference<input className={field} required={policy.decision==="ALLOW"} maxLength={2000} disabled={blocked} value={policy.evidence_reference} onChange={event=>changePolicy({evidence_reference:event.target.value})}/></label>
        <label className="block text-sm">Attribution<textarea className={field} required={policy.decision==="ALLOW"} maxLength={4000} disabled={blocked} value={policy.attribution} onChange={event=>changePolicy({attribution:event.target.value})}/></label>
        <label className="block text-sm">Duties<textarea className={field} disabled={blocked} value={policy.duties.join("\n")} onChange={event=>changePolicy({duties:event.target.value?event.target.value.split("\n"):[]})}/></label>
        <label className="block text-sm">Review by<input className={field} type="datetime-local" required={policy.decision==="ALLOW"} disabled={blocked}
          onChange={event=>changePolicy({review_by:event.target.value?new Date(event.target.value).toISOString():null})}/></label>
        <button className={button} disabled={blocked||chosen.length===0} type="submit">Save version rights review</button>
        <p className="text-xs text-[var(--text-muted)]">A workspace rights decision is not legal certification. It does not activate providers or change rights to third-party content.</p>
      </form>}
    </>}
    <button className={button} disabled={blocked||!canExport||!rights?.eligible||!approved||finding.source_unavailable} onClick={()=>void operate(async()=>{
      exportIntent.current??=crypto.randomUUID();const value=await createFindingPackage(finding.id,finding.revision,exportIntent.current,context);
      if(!active.current)return;download(value);setNotice("Exact package bytes and saved receipt confirmed.");
      const list=await listFindingPackages(finding.id,context);if(active.current){setPackages(list.items);setAfter(list.next_after);}
    })}><Download size={14} className="mr-2 inline"/>Export JSON-LD & receipt</button>
    <p className="text-xs text-[var(--text-muted)]">Packages retain evidence and qualifications, not certification. Revocation withholds future downloads; copies already downloaded cannot be recalled.</p>
    {packages.length>0&&<ul className="space-y-3" aria-label="Saved evidence packages">{packages.map(item=><li key={item.id} className="space-y-1 text-sm">
      <p className="break-words">Revision {item.finding_revision} · {item.state}{item.reason?` · ${item.reason}`:""}</p>
      <p className="break-all font-mono text-xs">SHA256 {item.manifest_hash}</p>
      <button className={button} disabled={blocked||!canExport||item.state!=="ready"} onClick={()=>void operate(async()=>{
        const saved=await readFindingPackage(finding.id,item.id,context);if(!active.current)return;
        setPackages(previous=>previous.map(row=>row.id===saved.id?saved:row));download(saved);
      })}>Download revision {item.finding_revision} package</button>
    </li>)}</ul>}
    {after&&<button className={button} disabled={blocked} onClick={()=>void operate(async()=>{
      const list=await listFindingPackages(finding.id,context,after);if(active.current){setPackages(previous=>[...previous,...list.items]);setAfter(list.next_after);}
    })}>Load more packages</button>}
  </section>;
}
