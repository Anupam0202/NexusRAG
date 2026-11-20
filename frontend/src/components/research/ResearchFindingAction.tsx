"use client";
import { useEffect,useRef,useState } from "react";
import { FilePlus2,ExternalLink } from "lucide-react";
import Link from "@/components/layout/StaticLink";
import { createResearchFinding } from "@/lib/api";
import type { ResearchRunResult } from "@/lib/research-run";

const button="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-sm disabled:opacity-50";
export function ResearchFindingAction({runId,index,result,workspaceId,userId,canWrite}:{runId:string;index:number;result:ResearchRunResult;workspaceId:string;userId:string;canWrite:boolean}) {
  const [finding,setFinding]=useState<string|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
  const key=useRef<string|null>(null),pending=useRef(false),alive=useRef(true);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  const supported=!result.abstained&&result.claim_state==="REVIEW_REQUIRED"&&result.validated_citation_ids.length>0;
  async function save() {
    if(pending.current||!canWrite||!supported)return;
    pending.current=true;setBusy(true);setError(null);key.current??=crypto.randomUUID();
    try {
      // Keep the existing UTF-16 title limit without cutting an emoji in half.
      const title=result.question.slice(0,160).replace(/[\uD800-\uDBFF]$/,"");
      const saved=await createResearchFinding(title,runId,index,key.current,{workspaceId,expectedUserId:userId});
      if(alive.current)setFinding(saved.id);
    } catch(error){
      const code=(error as {code?:string}|null)?.code;
      if(alive.current)setError(["PERSISTENCE_UNAVAILABLE","PERSISTENCE_UNCONFIRMED"].includes(code||"")
        ?"Finding save was not confirmed; it may already have been saved.":error instanceof Error?error.message:"Finding persistence was not confirmed.");
    }
    finally{pending.current=false;if(alive.current)setBusy(false);}
  }
  return <div className="my-3 min-w-0">
    {finding?<Link className={button} href={`/findings?finding=${encodeURIComponent(finding)}`}><ExternalLink size={16}/>Open saved finding</Link>
      :<button className={button} disabled={busy||!canWrite||!supported} onClick={()=>void save()}><FilePlus2 size={16}/>{busy?"Saving finding...":"Save as finding"}</button>}
    {finding&&<p role="status" className="mt-2 text-xs text-[var(--text-muted)]">Finding saved. Independent review is still required.</p>}
    {error&&<p role="alert" className="mt-2 break-words text-sm text-red-700 dark:text-red-300">{error}</p>}
  </div>;
}
