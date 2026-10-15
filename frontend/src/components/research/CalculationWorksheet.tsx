"use client";

import { useEffect, useRef, useState } from "react";
import { Calculator, RefreshCw } from "lucide-react";
import { createResearchCalculation, listResearchCalculations } from "@/lib/api";
import { calculationOperations, type CalculationInput, type CalculationOperation, type CalculationRecord } from "@/lib/research-calculation";

const control="mt-1 w-full min-w-0 rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-2 text-sm";
const button="inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-sm disabled:opacity-50";
export function CalculationWorksheet({planId,workspaceId,userId,canWrite}: {
  planId:string;workspaceId:string;userId:string;canWrite:boolean;
}) {
  const [operation,setOperation]=useState<CalculationOperation>("ADD"),[precision,setPrecision]=useState(6);
  const [quantities,setQuantities]=useState({left:{value:"",unit:"",references:""},right:{value:"",unit:"",references:""}});
  const [items,setItems]=useState<CalculationRecord[]>([]),[error,setError]=useState<string|null>(null),[busy,setBusy]=useState(true);
  const [reload,setReload]=useState(0);
  const [executing,setExecuting]=useState(false);
  const pending=useRef(false),alive=useRef(true),identity=useRef<{body:string;key:string}|null>(null);
  const heading=useRef<HTMLHeadingElement>(null);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  useEffect(()=>{
    let current=true;setBusy(true);setError(null);
    listResearchCalculations(planId,{workspaceId,expectedUserId:userId}).then(result=>{if(current)setItems(result.items);})
      .catch(error=>{if(current)setError(error instanceof Error?error.message:"Calculations are unavailable.");})
      .finally(()=>{if(current)setBusy(false);});
    return()=>{current=false;};
  },[planId,workspaceId,userId,reload]);
  async function calculate() {
    if(pending.current || busy || !canWrite)return;
    pending.current=true;setBusy(true);setExecuting(true);setError(null);
    const quantity=(side:"left"|"right")=>({value:quantities[side].value.trim(),unit:quantities[side].unit.trim(),
      evidence_ids:quantities[side].references.split("\n").map(value=>value.trim()).filter(Boolean)});
    const input:CalculationInput={operation,left:quantity("left"),right:quantity("right"),precision};
    const body=JSON.stringify(input);
    if(identity.current?.body!==body)identity.current={body,key:crypto.randomUUID()};
    try {
      const result=await createResearchCalculation(planId,input,identity.current.key,{workspaceId,expectedUserId:userId});
      if(alive.current){setItems(items=>[result,...items.filter(item=>item.id!==result.id)]);heading.current?.focus({preventScroll:true});}
    }catch(error){if(alive.current)setError(error instanceof Error?error.message:"Calculation save failed.");}
    finally{if(alive.current){pending.current=false;setBusy(false);setExecuting(false);}}
  }
  return <section aria-label="Calculation worksheet" className="mt-6 border-t border-[var(--border)] pt-5">
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h3 ref={heading} tabIndex={-1} className="flex items-center gap-2 text-base font-semibold"><Calculator size={18}/>Calculation worksheet</h3>
      <button className={button} disabled={busy} onClick={()=>setReload(value=>value+1)} title="Refresh stored calculations"><RefreshCw size={16}/>Refresh calculations</button></div>
    {error && <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
    <form onSubmit={event=>{event.preventDefault();void calculate();}} className="space-y-4">
      <div className="grid min-w-0 gap-4 sm:grid-cols-2"><label className="text-sm">Operation<select aria-label="Calculation operation" className={control} value={operation} disabled={busy||!canWrite}
        onChange={event=>setOperation(event.target.value as CalculationOperation)}>{calculationOperations.map(op=><option key={op} value={op}>{op.toLowerCase().replaceAll("_"," ")}</option>)}</select></label>
        <label className="text-sm">Decimal places<input aria-label="Decimal places" type="number" min={0} max={18} step={1} required className={control} value={precision} disabled={busy||!canWrite}
          onChange={event=>setPrecision(event.target.valueAsNumber)}/></label></div>
      <div className="grid min-w-0 gap-4 sm:grid-cols-2">{(["left","right"] as const).map(side=><fieldset key={side} className="min-w-0 space-y-3">
        <legend className="mb-1 text-sm font-semibold">{side==="left"?"Left input":"Right input"}</legend>
        {(["value","unit","references"] as const).map(field=>{
          const label=`${side==="left"?"Left":"Right"} ${field==="references"?"evidence references":field}`;
          return <label className="block text-sm" key={field}>{label}{field==="references"?<textarea aria-label={label} rows={2} maxLength={13000} required className={control} value={quantities[side][field]} disabled={busy||!canWrite}
            onChange={event=>setQuantities({...quantities,[side]:{...quantities[side],[field]:event.target.value}})}/>:
            <input aria-label={label} type="text" inputMode={field==="value"?"decimal":undefined} maxLength={field==="value"?270:64} required className={control} value={quantities[side][field]} disabled={busy||!canWrite}
              onChange={event=>setQuantities({...quantities,[side]:{...quantities[side],[field]:event.target.value}})}/>}</label>;
        })}
      </fieldset>)}</div>
      <button type="submit" className={button} disabled={busy||!canWrite}><Calculator size={16}/>{executing?"Calculating...":"Calculate and save"}</button>
    </form>
    <h4 className="mb-2 mt-6 text-sm font-semibold">Stored calculations</h4>
    {!items.length && <p className="text-sm text-[var(--text-muted)]">{busy?"Loading calculations...":"No stored calculations"}</p>}
    <ol>{items.map(item=><li key={item.id} className="min-w-0 border-b border-[var(--border)] py-4">
      <p className="break-all text-lg font-semibold" aria-label="Calculation result">{item.result.value} {item.result.unit}</p>
      <dl className="mt-2 space-y-2 text-sm"><div><dt className="font-medium">Formula</dt><dd className="break-all">{item.result.formula}</dd></div>
        <div><dt className="font-medium">Inputs</dt><dd className="break-all">{item.input.left.value} {item.input.left.unit}; {item.input.right.value} {item.input.right.unit}</dd></div>
        <div><dt className="font-medium">Evidence references</dt><dd className="break-all whitespace-pre-wrap">{item.result.evidence_ids.join("\n")}</dd></div>
        <div><dt className="font-medium">Rounding</dt><dd>Half even; {item.result.precision} decimal places</dd></div></dl>
      <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">Saved calculation. Review required. Input evidence is caller-supplied, not verified.</p>
    </li>)}</ol>
  </section>;
}
