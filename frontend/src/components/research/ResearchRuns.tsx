"use client";
import { useEffect, useRef, useState } from "react";
import { Copy, ExternalLink, Play, RefreshCw, Square } from "lucide-react";
import Link from "@/components/layout/StaticLink";
import { listResearchRuns, researchRunCommand } from "@/lib/api";
import type { ResearchRun } from "@/lib/research-run";
import type { ResearchPlanRecord } from "@/lib/research-plan";
import { ResearchFindingAction } from "./ResearchFindingAction";

const button="inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-sm disabled:opacity-50";
export function ResearchRuns({plan,workspaceId,userId,canWrite}:{plan:ResearchPlanRecord;workspaceId:string;userId:string;canWrite:boolean}) {
  const [items,setItems]=useState<ResearchRun[]>([]),[selected,setSelected]=useState<ResearchRun|null>(null),[after,setAfter]=useState<string|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[attested,setAttested]=useState(false),[copied,setCopied]=useState(false);
  const alive=useRef(true),pending=useRef(false),sequence=useRef(0),startKey=useRef<string|null>(null),heading=useRef<HTMLHeadingElement>(null);
  const context={workspaceId,expectedUserId:userId};
  const supported=["QUICK_LOOKUP","EVIDENCE_ANSWER"].includes(plan.plan.mode);
  const unsupported=plan.plan.public_provider_ids.length||plan.plan.entity_scope.length||plan.plan.rights_constraints.length||plan.plan.expected_calculations.length
    ||plan.plan.date_from||plan.plan.date_to||plan.plan.jurisdiction;
  const active=selected&&["queued","running"].includes(selected.state);
  useEffect(()=>{const counter=sequence;alive.current=true;return()=>{alive.current=false;counter.current++;};},[]);
  useEffect(()=>{
    let current=true;setBusy(true);setError(null);
    listResearchRuns(plan.id,{workspaceId,expectedUserId:userId}).then(page=>{if(current){setItems(page.items);setAfter(page.next_after);}})
      .catch(error=>{if(current)setError(error instanceof Error?error.message:"Research runs are unavailable.");}).finally(()=>{if(current)setBusy(false);});
    return()=>{current=false;};
  },[plan.id,workspaceId,userId]);
  useEffect(()=>{
    if(!selected||!active||busy||error)return;
    let current=true;
    const timer=setTimeout(()=>{
      researchRunCommand(plan.id,{workspaceId,expectedUserId:userId},"read",selected.id).then(value=>{
        if(current){setSelected(value);setItems(items=>items.map(item=>item.id===value.id?value:item));}
      }).catch(error=>{if(current)setError(error instanceof Error?error.message:"Run refresh failed.");});
    },1500);
    return()=>{current=false;clearTimeout(timer);};
  },[selected,active,busy,error,plan.id,workspaceId,userId]);
  async function operate(action:()=>Promise<ResearchRun|void>) {
    if(pending.current||busy)return;
    pending.current=true;setBusy(true);setError(null);setCopied(false);
    const operation=++sequence.current,current=()=>alive.current&&sequence.current===operation;
    try {
      const result=await action();
      if(current()&&result){setSelected(result);setItems(items=>[result,...items.filter(item=>item.id!==result.id)]);heading.current?.focus({preventScroll:true});}
    } catch(error){if(current())setError(error instanceof Error?error.message:"Run operation failed.");}
    finally{if(current()){pending.current=false;setBusy(false);}}
  }
  return <section aria-label="Research executions" className="mt-6 min-w-0 border-t border-[var(--border)] pt-5">
    <header className="mb-3 flex flex-wrap items-center justify-between gap-3"><h3 ref={heading} tabIndex={-1} className="text-base font-semibold">Executions</h3>
      <button className={button} disabled={busy} onClick={()=>void operate(async()=>{
        const page=await listResearchRuns(plan.id,context);if(alive.current){setItems(page.items);setAfter(page.next_after);}
        if(selected)return researchRunCommand(plan.id,context,"read",selected.id);
      })}><RefreshCw size={16}/>Refresh executions</button></header>
    {error&&<p role="alert" className="mb-3 rounded-lg border border-red-300 p-3 text-sm text-red-700 dark:text-red-300">{error}</p>}
    {!supported?<p className="text-sm text-[var(--text-muted)]">Execution is not implemented for this mode. The saved plan remains available.</p>:<>
      {unsupported?<p role="status" className="mb-3 text-sm text-amber-700 dark:text-amber-300">This plan includes constraints that execution cannot yet honor. No processing will start.</p>:!plan.plan.private_source_ids.length?<p className="mb-3 text-sm">A selected-document scope is required.</p>:null}
      <label className="mb-3 flex items-start gap-2 text-sm"><input type="checkbox" checked={attested} disabled={busy||!canWrite} onChange={event=>setAttested(event.target.checked)} className="mt-1"/>
        <span>I confirm that all questions and selected documents contain only non-sensitive information and consent to Gemini processing. One account query is admitted per run; provider quotas also apply.</span></label>
      <button className={button} disabled={busy||!canWrite||!attested||Boolean(unsupported)||!plan.plan.private_source_ids.length||Boolean(active)} onClick={()=>void operate(async()=>{
        startKey.current??=crypto.randomUUID();const result=await researchRunCommand(plan.id,context,"create",undefined,startKey.current);startKey.current=null;return result;
      })}><Play size={16}/>{busy?"Working...":"Start research"}</button>
    </>}
    {!items.length&&<p className="my-3 text-sm text-[var(--text-muted)]">{busy?"Loading executions...":"No executions"}</p>}
    <ul aria-label="Saved executions" className="my-4 divide-y divide-[var(--border)]">{items.map(item=><li key={item.id}>
      <button disabled={busy} className="w-full break-words py-2 text-left text-sm disabled:opacity-50" aria-label={`Open execution ${item.id}`} onClick={()=>void operate(()=>researchRunCommand(plan.id,context,"read",item.id))}>
        {item.state} / {item.position} of {item.questions.length} questions <span className="block text-xs text-[var(--text-muted)]">{new Date(item.created_at).toLocaleString()}</span></button>
    </li>)}</ul>
    {after&&<button className={button} disabled={busy} onClick={()=>void operate(async()=>{
      const page=await listResearchRuns(plan.id,context,after);if(alive.current){setItems(items=>[...items,...page.items.filter(item=>!items.some(old=>old.id===item.id))]);setAfter(page.next_after);}
    })}>Load more executions</button>}
    {selected&&<div className="min-w-0 border-t border-[var(--border)] pt-4">
      <div role="status" className="mb-2 text-sm font-medium">{selected.state==="completed"?"Execution finished; completion criteria still require review.":`Execution ${selected.state}`} / {selected.position} of {selected.questions.length} questions saved</div>
      <progress aria-label="Research progress" value={selected.position} max={selected.questions.length} className="mb-3 h-2 w-full"/>
      {selected.dispatch_state==="PENDING_RECOVERY"&&<p role="status" className="mb-3 text-sm text-amber-700 dark:text-amber-300">Saved, but queue dispatch was not confirmed. Scheduled recovery can redispatch queued work; no generation result is confirmed yet.</p>}
      {selected.error_code&&<p role="status" className="mb-3 break-words text-sm">Execution stopped: {selected.error_code}. Saved answers are retained. A resume may repeat an unconfirmed provider request and consume quota.</p>}
      <div className="mb-4 flex flex-wrap gap-2">
        {selected.state==="queued"&&<button className={button} disabled={busy||!canWrite||!attested} onClick={()=>void operate(()=>researchRunCommand(plan.id,context,"resume",selected.id))}><RefreshCw size={16}/>Retry queued dispatch</button>}
        {active&&<button className={button} disabled={busy||!canWrite} onClick={()=>void operate(()=>researchRunCommand(plan.id,context,"cancel",selected.id))}><Square size={16}/>Cancel execution</button>}
        {["cancelled","interrupted"].includes(selected.state)&&<button className={button} disabled={busy||!canWrite||!attested||selected.source_state!=="CURRENT"||selected.generation>=10}
          onClick={()=>void operate(()=>researchRunCommand(plan.id,context,"resume",selected.id))}><Play size={16}/>Resume remaining questions</button>}
        <button className={button} disabled={!selected.results.length} onClick={()=>void navigator.clipboard.writeText(selected.results.map(result=>`${result.question}\n${result.answer}\n${result.sources.map(s=>`[${s.citation_id}] ${s.filename}, chunk ${s.chunk_index}, ${s.original_content_hash}`).join("\n")}`).join("\n\n"))
          .then(()=>setCopied(true)).catch(()=>setError("The clipboard was unavailable."))}><Copy size={16}/>{copied?"Copied":"Copy results"}</button>
      </div>
      {selected.source_state!=="CURRENT"?<p role="status" className="text-sm text-amber-700 dark:text-amber-300">Evidence was removed or changed. Stored answers are unavailable; create a new plan against current sources.</p>:selected.results.map((result,index)=><article key={`${selected.id}:${index}`} className="mb-5 min-w-0 border-t border-[var(--border)] pt-4">
        <h4 className="mb-2 whitespace-pre-wrap break-words font-medium">{result.question}</h4>
        <p className="mb-2 text-xs text-[var(--text-muted)]">{result.claim_state==="UNSUPPORTED"?"No supported answer":"Review required; citation presence is not entailment"}</p>
        <p className="mb-3 whitespace-pre-wrap break-words text-sm">{result.answer}</p>
        <ResearchFindingAction runId={selected.id} index={index} result={result} workspaceId={workspaceId} userId={userId} canWrite={canWrite}/>
        {result.sources.map(source=><details key={source.citation_id} className="mb-2 min-w-0 rounded-lg border border-[var(--border)] p-3">
          <summary className="cursor-pointer break-words text-sm">[{source.citation_id}] {source.filename} / chunk {source.chunk_index}{source.page_number>0?` / page ${source.page_number}`:""}</summary>
          <p className="my-2 whitespace-pre-wrap break-words text-sm">{source.content}</p>
          {source.excerpt&&<p className="text-xs">Excerpt; inspect the original chunk for full content.</p>}
          <p className="my-2 break-all font-mono text-xs text-[var(--text-muted)]">SHA256 {source.original_content_hash}</p>
          <Link href={`/documents/${encodeURIComponent(source.document_id)}`} className={button}><ExternalLink size={14}/>Inspect document</Link>
        </details>)}
        <p className="text-xs text-[var(--text-muted)]">{result.coverage.chunks_considered} chunks considered / bounded retrieval, not exhaustive / provider cost {result.provider_cost_status.toLowerCase()}</p>
      </article>)}
    </div>}
  </section>;
}
