"use client";
import {useEffect,useRef,useState} from "react";
import {ArrowLeftRight,Copy,Plus,RefreshCw} from "lucide-react";
import {createResearchConversion,listResearchConversions} from "@/lib/api";
import {type ConversionInput,type ConversionRecord} from "@/lib/research-conversion";
import {SourceQuantitySelect} from "./SourceQuantities";
import type {QuantityCaptureRecord} from "@/lib/research-quantity";
const control="mt-1 w-full min-w-0 rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-2 text-sm";
const button="inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-sm disabled:opacity-50";
const empty=()=>({value:"",unit:"",references:"",factor:"",target:"",factorReference:"",date:"",precision:6});
export function ConversionWorksheet({planId,workspaceId,userId,canWrite,captures=[]}:{planId:string;workspaceId:string;userId:string;canWrite:boolean;captures?:QuantityCaptureRecord[]}) {
  const [draft,setDraft]=useState(empty),[items,setItems]=useState<ConversionRecord[]>([]),[nextAfter,setNextAfter]=useState<string|null>(null);
  const [busy,setBusy]=useState(true),[executing,setExecuting]=useState(false),[error,setError]=useState<string|null>(null),[reload,setReload]=useState(0);
  const pending=useRef(false),alive=useRef(true),identity=useRef<{body:string;key:string}|null>(null),heading=useRef<HTMLHeadingElement>(null),valueInput=useRef<HTMLInputElement>(null);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  useEffect(()=>{
    let current=true;pending.current=true;setBusy(true);setError(null);
    listResearchConversions(planId,{workspaceId,expectedUserId:userId}).then(result=>{if(current){setItems(result.items);setNextAfter(result.next_after);}})
      .catch(error=>{if(current)setError(error instanceof Error?error.message:"Conversions are unavailable.");})
      .finally(()=>{if(current){pending.current=false;setBusy(false);}});
    return()=>{current=false;};
  },[planId,workspaceId,userId,reload]);
  function populate(input?:ConversionInput){
    setDraft(input?{value:input.quantity.value,unit:input.quantity.unit,references:input.quantity.evidence_ids.join("\n"),factor:input.factor,
      target:input.target_unit,factorReference:input.conversion_evidence_id,date:input.factor_effective_on??"",precision:input.precision}:empty());
    identity.current=null;setError(null);valueInput.current?.focus();valueInput.current?.scrollIntoView?.({block:"center"});
  }
  async function execute(){
    if(pending.current || busy || !canWrite)return;pending.current=true;setBusy(true);setExecuting(true);setError(null);
    const input:ConversionInput={quantity:{value:draft.value.trim(),unit:draft.unit.trim(),evidence_ids:draft.references.split("\n").map(id=>id.trim()).filter(Boolean)},
      factor:draft.factor.trim(),target_unit:draft.target.trim(),conversion_evidence_id:draft.factorReference.trim(),factor_effective_on:draft.date||null,precision:draft.precision};
    const body=JSON.stringify(input);if(identity.current?.body!==body)identity.current={body,key:crypto.randomUUID()};
    try{const record=await createResearchConversion(planId,input,identity.current.key,{workspaceId,expectedUserId:userId});
      if(alive.current){setItems(items=>[record,...items.filter(item=>item.id!==record.id)]);heading.current?.focus();heading.current?.scrollIntoView?.({block:"start"});}}
    catch(error){if(alive.current)setError(error instanceof Error?error.message:"Conversion save was not confirmed.");}
    finally{if(alive.current){pending.current=false;setBusy(false);setExecuting(false);}}
  }
  async function loadMore(){
    if(pending.current || busy || !nextAfter)return;pending.current=true;setBusy(true);setError(null);
    try{const page=await listResearchConversions(planId,{workspaceId,expectedUserId:userId},nextAfter);
      if(alive.current){setItems(items=>[...items,...page.items.filter(row=>!items.some(old=>old.id===row.id))]);setNextAfter(page.next_after);}}
    catch(error){if(alive.current)setError(error instanceof Error?error.message:"More conversions are unavailable.");}
    finally{if(alive.current){pending.current=false;setBusy(false);}}
  }
  return <section aria-label="Unit conversion worksheet" className="mt-5 min-w-0 border-t border-[var(--border)] pt-5">
    <header className="mb-4 flex flex-wrap items-center justify-between gap-3"><h3 className="flex items-center gap-2 text-base font-semibold"><ArrowLeftRight size={18}/>Unit conversion</h3>
      <div className="flex flex-wrap gap-2"><button className={button} disabled={busy} onClick={()=>{if(!pending.current&&!busy){pending.current=true;setBusy(true);setReload(v=>v+1);}}}><RefreshCw size={16}/>Refresh conversions</button>
        <button className={button} disabled={busy||!canWrite} onClick={()=>populate()}><Plus size={16}/>New conversion</button></div></header>
    {error && <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
    <form onSubmit={event=>{event.preventDefault();void execute();}} className="space-y-4">
      <SourceQuantitySelect records={captures} label="Conversion captured quantity" disabled={busy||!canWrite} onSelect={q=>setDraft(old=>({...old,value:q.value,unit:q.unit,references:q.evidence_ids.join("\n")}))}/>
      <SourceQuantitySelect records={captures.filter(row=>row.quantity?.unit===`${draft.target}/${draft.unit}`)} label="Conversion captured factor" disabled={busy||!canWrite||!draft.target||!draft.unit} onSelect={q=>setDraft(old=>({...old,factor:q.value,factorReference:q.evidence_ids[0]}))}/>
      <div className="grid min-w-0 gap-4 sm:grid-cols-2">{([['value','Conversion value',270],['unit','Source unit',64],['factor','Supplied factor',270],['target','Target unit',64],['factorReference','Factor evidence reference',128]] as const).map(([field,label,max])=><label className="text-sm" key={field}>{label}
        <input ref={field==="value"?valueInput:undefined} aria-label={label} type="text" inputMode={field==="value"||field==="factor"?"decimal":undefined} maxLength={max} required className={control} disabled={busy||!canWrite} value={draft[field]} onChange={event=>setDraft({...draft,[field]:event.target.value})}/></label>)}
        <label className="text-sm">Factor effective date<input aria-label="Factor effective date" type="date" min="0001-01-01" max="9999-12-31" className={control} disabled={busy||!canWrite} value={draft.date} onChange={event=>setDraft({...draft,date:event.target.value})}/></label>
        <label className="text-sm">Decimal places<input aria-label="Conversion decimal places" type="number" min={0} max={18} step={1} required className={control} disabled={busy||!canWrite} value={draft.precision} onChange={event=>setDraft({...draft,precision:event.target.valueAsNumber})}/></label>
        <label className="text-sm">Input evidence references<textarea aria-label="Conversion evidence references" rows={2} maxLength={13000} required className={control} disabled={busy||!canWrite} value={draft.references} onChange={event=>setDraft({...draft,references:event.target.value})}/></label></div>
      <button type="submit" className={button} disabled={busy||!canWrite}><ArrowLeftRight size={16}/>{executing?"Converting...":"Convert and save"}</button>
    </form>
    <h4 ref={heading} tabIndex={-1} className="mb-2 mt-6 text-sm font-semibold">Stored conversions</h4>
    {!items.length && <p className="text-sm text-[var(--text-muted)]">{busy?"Loading conversions...":"No stored conversions"}</p>}
    <ol>{items.map(item=><li key={item.id} className="min-w-0 border-b border-[var(--border)] py-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><p aria-label="Conversion result" className="break-all text-lg font-semibold">{item.result.value} {item.result.unit}</p><button className={button} disabled={busy||!canWrite} onClick={()=>populate(item.input)}><Copy size={16}/>Use conversion inputs</button></div>
      <dl className="mt-3 space-y-2 text-sm"><div><dt className="font-medium">Formula</dt><dd className="break-all">{item.result.formula}</dd></div>
        <div><dt className="font-medium">Input</dt><dd className="break-all">{item.input.quantity.value} {item.input.quantity.unit}</dd></div>
        <div><dt className="font-medium">Factor</dt><dd className="break-all">{item.input.factor}; {item.input.quantity.unit} to {item.input.target_unit}</dd></div>
        <div><dt className="font-medium">Factor effective date</dt><dd>{item.input.factor_effective_on??"Not supplied"}</dd></div>
        <div><dt className="font-medium">Evidence references</dt><dd className="whitespace-pre-wrap break-all">{item.result.evidence_ids.join("\n")}</dd></div>
        <div><dt className="font-medium">Rounding</dt><dd>Half even; {item.result.precision} decimal places</dd></div></dl>
      <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">Saved supplied-factor conversion. Review required. Input and factor evidence are caller-supplied, not verified.</p>
    </li>)}</ol>
    {nextAfter && <button className={`${button} mt-4`} disabled={busy} onClick={()=>void loadMore()}>Load more conversions</button>}
  </section>;
}
