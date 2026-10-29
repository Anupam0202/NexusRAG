"use client";
import {useEffect,useRef,useState} from "react";
import Link from "@/components/layout/StaticLink";
import {readFindingServingRights,recordFindingServingRights,type ApiRequestContext,type FindingDetail} from "@/lib/api";
import {confirmedServingPolicy,servingActionLabel,type FindingServingRights as Rights,type ServingAction} from "@/lib/obligation-evidence";
import type {FindingExportPolicy} from "@/lib/finding-package";
const button="rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-medium disabled:opacity-50";
const field="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-2 text-sm";
const initialPolicy:FindingExportPolicy={decision:"REVIEW_REQUIRED",basis:"UNKNOWN",rationale:"",evidence_reference:"",attribution:"",duties:[],review_by:null};
type ServingFinding=Pick<FindingDetail,"id"|"revision">;
export function FindingServingRights({finding,context,parentBusy,initialAction="SERVE_API",onRightsConfirmed}:{finding:ServingFinding;context:ApiRequestContext;parentBusy:boolean;initialAction?:ServingAction;onRightsConfirmed?:(rights:Rights)=>void}) {
  const [action,setAction]=useState<ServingAction>(initialAction);
  return <section aria-label="API and MCP serving rights" className="min-w-0 space-y-3 border-t border-[var(--border)] pt-4">
    <h3 className="font-semibold">API and MCP serving rights</h3>
    <p className="text-sm">Review permission for every disclosed source version. Export rights and Finding approval do not grant permission for these actions.</p>
    <label className="block text-sm">Serving action<select className={field} value={action} disabled={parentBusy} onChange={event=>setAction(event.target.value as ServingAction)}>
      <option value="SERVE_API">REST API</option><option value="SERVE_MCP">Custom MCP</option></select></label>
    <RightsReview key={`${finding.id}:${finding.revision}:${context.workspaceId}:${context.expectedUserId}:${action}`} finding={finding} context={context} action={action} parentBusy={parentBusy} onRightsConfirmed={onRightsConfirmed}/>
    <Link className="inline-block text-sm underline" href={`/evidence-api?finding=${encodeURIComponent(finding.id)}&revision=${finding.revision}`}>Inspect in the obligation evidence reader</Link>
  </section>;
}
function RightsReview({finding,context,action,parentBusy,onRightsConfirmed}:{finding:ServingFinding;context:ApiRequestContext;action:ServingAction;parentBusy:boolean;onRightsConfirmed?:(rights:Rights)=>void}) {
  const [rights,setRights]=useState<Rights|null>(null),[chosen,setChosen]=useState<string[]>([]),[policy,setPolicy]=useState(initialPolicy);
  const [busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[notice,setNotice]=useState<string|null>(null);
  const [outcomeUnknown,setOutcomeUnknown]=useState(false);
  const alive=useRef(true),inFlight=useRef(false),intent=useRef<string|null>(null);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  const blocked=busy||parentBusy;
  function change(value:Partial<FindingExportPolicy>){setPolicy(previous=>({...previous,...value}));intent.current=null;}
  async function operate(callback:()=>Promise<void>) {
    if(inFlight.current||parentBusy)return;
    inFlight.current=true;setBusy(true);setError(null);setNotice(null);
    try{await callback();}catch(error){if(alive.current)setError(error instanceof Error?error.message:"Serving rights could not be confirmed.");}
    finally{inFlight.current=false;if(alive.current)setBusy(false);}
  }
  return <div className="min-w-0 space-y-3">
    <button className={button} disabled={blocked} onClick={()=>void operate(async()=>{
      setRights(null);setChosen([]);intent.current=null;
      const value=await readFindingServingRights(finding.id,action,context);if(alive.current){setRights(value);setOutcomeUnknown(false);onRightsConfirmed?.(value);}
    })}>Load {servingActionLabel(action)} rights</button>
    {busy&&<p role="status" className="text-sm">Confirming current serving rights…</p>}
    {error&&<p role="alert" className="break-words text-sm text-red-600">{error}</p>}
    {notice&&<p role="status" className="break-words text-sm">{notice}</p>}
    {rights&&<>
      <p className="text-sm">{outcomeUnknown?"The latest serving decision is unconfirmed. Retry the same decision or reload current rights.":rights.eligible?`Source rights allow ${servingActionLabel(action)}. Independent revision approval is also required.`:`${servingActionLabel(action)} is withheld by source rights or source availability.`}</p>
      <p className="text-xs text-[var(--text-muted)]">Revision {rights.revision} · {rights.items.length} disclosed source versions · {rights.source_state==="CURRENT"?"Sources current":"Source evidence changed or unavailable"}</p>
      {rights.can_review&&<label className="flex items-start gap-2 text-sm"><input type="checkbox" disabled={blocked||!rights.items.some(row=>row.original_hash!==null)}
        checked={rights.items.some(row=>row.original_hash!==null)&&rights.items.filter(row=>row.original_hash!==null).every(row=>chosen.includes(row.version_id))}
        onChange={event=>{setChosen(event.target.checked?rights.items.filter(row=>row.original_hash!==null).map(row=>row.version_id):[]);intent.current=null;}}/>Select all versions with retained hashes</label>}
      <ul className="space-y-3" aria-label="Source serving decisions">{rights.items.map((row,index)=><li key={row.version_id} className="min-w-0 space-y-1 rounded-lg border border-[var(--border)] p-3 text-sm">
        <label className="flex items-start gap-2"><input type="checkbox" disabled={blocked||!rights.can_review||row.original_hash===null} checked={chosen.includes(row.version_id)}
          onChange={event=>{setChosen(previous=>event.target.checked?[...previous,row.version_id]:previous.filter(id=>id!==row.version_id));intent.current=null;}}/>
          <span className="min-w-0 break-words">{row.filename??`Unavailable source version ${index+1}`}</span></label>
        <p className="break-all font-mono text-xs">Version {row.version_id} · SHA256 {row.original_hash??"Unavailable"}</p><p>{row.policy_erased_at?"WITHDRAWN BY SOURCE LIFECYCLE":row.state.replaceAll("_"," ")}</p>
        {row.policy_erased_at&&<p>Source lifecycle withdrew this decision at <time dateTime={row.policy_erased_at}>{new Date(row.policy_erased_at).toLocaleString()}</time>. Its policy text has been removed.</p>}
        {row.policy&&<details><summary className="cursor-pointer">Inspect rights decision</summary><p className="whitespace-pre-wrap break-words">{row.policy.rationale}</p>
          <p className="whitespace-pre-wrap break-words">Attribution: {row.policy.attribution||"None recorded"}</p><p className="break-words">Evidence: {row.policy.evidence_reference||"None recorded"}</p>
          {row.policy.review_by&&<p>Review by <time dateTime={row.policy.review_by}>{new Date(row.policy.review_by).toLocaleString()}</time></p>}
          {row.policy.duties.length>0&&<ul className="list-inside list-disc">{row.policy.duties.map((duty,i)=><li className="break-words" key={i}>{duty}</li>)}</ul>}</details>}
      </li>)}</ul>
      {rights.can_review&&<form aria-label="Source serving rights review" className="space-y-3" onSubmit={event=>{
        event.preventDefault();void operate(async()=>{
          if(!confirmedServingPolicy(policy))throw new Error("Use a bounded rights policy: rationale up to 2,000 characters, evidence up to 2,000, attribution up to 4,000, ten duties of 500 characters, and 8,192 total UTF-8 bytes. Allow requires a rights basis, evidence, attribution and review date.");
          if(intent.current===null&&policy.decision==="ALLOW"&&(!policy.review_by||Date.parse(policy.review_by)<=Date.now()))throw new Error("Allow requires a future rights review date.");
          intent.current??=crypto.randomUUID();
          setOutcomeUnknown(true);
          const value=await recordFindingServingRights(finding.id,action,{revision:rights.revision,selections:rights.items.filter(row=>chosen.includes(row.version_id))
            .map(row=>({version_id:row.version_id,original_hash:row.original_hash!,expected_review_id:row.review_id})),policy},intent.current,context);
          if(!alive.current)return;setRights(value);setChosen([]);intent.current=null;setOutcomeUnknown(false);
          setNotice(`Serving decision recorded for ${servingActionLabel(action)} at revision ${value.confirmed_review!.finding_revision}. Current rights were rechecked.`);
          onRightsConfirmed?.(value);
        });}}>
        <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">Serving decision<select className={field} value={policy.decision} disabled={blocked} onChange={event=>change({decision:event.target.value as FindingExportPolicy["decision"]})}>
          <option value="REVIEW_REQUIRED">Review required</option><option value="ALLOW">Allow this action</option><option value="DENY">Deny this action</option><option value="REVOKED">Revoke this action</option></select></label>
          <label className="text-sm">Serving rights basis<select className={field} value={policy.basis} disabled={blocked} onChange={event=>change({basis:event.target.value as FindingExportPolicy["basis"]})}>
            <option value="UNKNOWN">Unknown</option><option value="OWNED_CONTENT">Owned content</option><option value="LICENSE">Licence</option><option value="PERMISSION">Permission</option><option value="PUBLIC_DOMAIN">Public domain</option></select></label></div>
        <label className="block text-sm">Serving review rationale<textarea className={field} required disabled={blocked} maxLength={4000} value={policy.rationale} onChange={event=>change({rationale:event.target.value})}/></label>
        <label className="block text-sm">Serving rights evidence<input className={field} required={policy.decision==="ALLOW"} disabled={blocked} maxLength={4000} value={policy.evidence_reference} onChange={event=>change({evidence_reference:event.target.value})}/></label>
        <label className="block text-sm">Serving attribution<textarea className={field} required={policy.decision==="ALLOW"} disabled={blocked} maxLength={8000} value={policy.attribution} onChange={event=>change({attribution:event.target.value})}/></label>
        <label className="block text-sm">Serving duties (one per line)<textarea className={field} disabled={blocked} value={policy.duties.join("\n")} onChange={event=>change({duties:event.target.value?event.target.value.split("\n"):[]})}/></label>
        <label className="block text-sm">Serving review by<input className={field} disabled={blocked} required={policy.decision==="ALLOW"} type="datetime-local" step="0.001" onChange={event=>change({review_by:event.target.value?new Date(event.target.value).toISOString():null})}/></label>
        <button type="submit" className={button} disabled={blocked||!chosen.length||rights.revision!==finding.revision||policy.decision==="ALLOW"&&rights.source_state!=="CURRENT"}>Save serving rights review</button>
        {rights.revision!==finding.revision&&<p role="alert" className="text-sm">This Finding changed. Reload the Finding before making a new rights decision.</p>}
      </form>}
      {!rights.can_review&&<p className="text-sm">A workspace owner or administrator must review source serving rights.</p>}
    </>}
    <p className="text-xs text-[var(--text-muted)]">These decisions do not activate providers or certify legal applicability. The reader rechecks current source rights and exact revision review on each request.</p>
  </div>;
}
