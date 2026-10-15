"use client";

import {useEffect,useRef,useState} from "react";
import {ChevronDown,ChevronLeft,ChevronRight,Copy,Plus,RefreshCw,Sigma,Trash2} from "lucide-react";
import {createResearchAggregation,listResearchAggregations} from "@/lib/api";
import {aggregationOperations,type AggregateGroup,type AggregationInput,type AggregationOperation,type AggregationRecord} from "@/lib/research-aggregation";

const control="mt-1 w-full min-w-0 rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-2 text-sm";
const button="inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-sm disabled:opacity-50";
type InputRow={id:string;value:string;unit:string;references:string;weight:string;group:string};
const newRow=(unit=""):InputRow=>({id:crypto.randomUUID(),value:"",unit,references:"",weight:"",group:""});
const label=(value:string)=>value.toLowerCase().replaceAll("_"," ");

export function AggregationWorksheet({planId,workspaceId,userId,canWrite}:{planId:string;workspaceId:string;userId:string;canWrite:boolean}) {
  const [operation,setOperation]=useState<AggregationOperation>("SUM"),[precision,setPrecision]=useState(6);
  const [policy,setPolicy]=useState<"REJECT"|"EXCLUDE">("REJECT"),[grouped,setGrouped]=useState(false);
  const [values,setValues]=useState<InputRow[]>(()=>[newRow(),newRow()]);
  const [items,setItems]=useState<AggregationRecord[]>([]),[nextAfter,setNextAfter]=useState<string|null>(null),[latest,setLatest]=useState<string|null>(null);
  const [busy,setBusy]=useState(true),[executing,setExecuting]=useState(false),[error,setError]=useState<string|null>(null),[reload,setReload]=useState(0);
  const alive=useRef(true),pending=useRef(false),identity=useRef<{body:string;key:string}|null>(null);
  const pendingFocus=useRef<string|null>(null),inputs=useRef(new Map<string,HTMLInputElement>()),resultsHeading=useRef<HTMLHeadingElement>(null);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  useEffect(()=>{if(pendingFocus.current){inputs.current.get(pendingFocus.current)?.focus();pendingFocus.current=null;}},[values]);
  useEffect(()=>{
    let current=true;pending.current=true;setBusy(true);setError(null);
    listResearchAggregations(planId,{workspaceId,expectedUserId:userId}).then(page=>{if(current){setItems(page.items);setNextAfter(page.next_after);}})
      .catch(error=>{if(current)setError(error instanceof Error?error.message:"Series results are unavailable.");})
      .finally(()=>{if(current){pending.current=false;setBusy(false);}});
    return()=>{current=false;};
  },[planId,workspaceId,userId,reload]);
  function populateInputs(input?:AggregationInput) {
    const rows=input?input.values.map((q,index)=>({id:crypto.randomUUID(),value:q.value??"",unit:q.unit,references:q.evidence_ids.join("\n"),weight:input.weights[index]??"",group:q.group??""})):[newRow(),newRow()];
    setValues(rows);setOperation(input?.operation??"SUM");setPrecision(input?.precision??6);setPolicy(input?.missing_value_treatment??"REJECT");setGrouped(input?.grouped??false);
    identity.current=null;setError(null);pendingFocus.current=rows[0].id;
  }
  async function execute() {
    if(pending.current || busy || !canWrite)return;
    pending.current=true;setBusy(true);setExecuting(true);setError(null);
    const input:AggregationInput={operation,values:values.map(q=>({value:q.value.trim()||null,unit:q.unit.trim(),
      evidence_ids:q.references.split("\n").map(id=>id.trim()).filter(Boolean),...(grouped?{group:q.group.trim()}: {})})),
      weights:operation==="WEIGHTED_AVERAGE"?values.map(q=>q.weight.trim()):[],precision,missing_value_treatment:policy,grouped};
    const body=JSON.stringify(input);if(identity.current?.body!==body)identity.current={body,key:crypto.randomUUID()};
    try {
      const record=await createResearchAggregation(planId,input,identity.current.key,{workspaceId,expectedUserId:userId});
      if(alive.current){setLatest(record.id);setItems(items=>[record,...items.filter(item=>item.id!==record.id)]);resultsHeading.current?.focus();resultsHeading.current?.scrollIntoView?.({block:"start"});}
    }catch(error){if(alive.current)setError(error instanceof Error?error.message:"Aggregate execution was not confirmed.");}
    finally{if(alive.current){pending.current=false;setBusy(false);setExecuting(false);}}
  }
  async function loadMore() {
    if(pending.current || busy || !nextAfter)return;
    pending.current=true;setBusy(true);setError(null);
    try{const page=await listResearchAggregations(planId,{workspaceId,expectedUserId:userId},nextAfter);
      if(alive.current){setItems(items=>[...items,...page.items.filter(row=>!items.some(old=>old.id===row.id))]);setNextAfter(page.next_after);}}
    catch(error){if(alive.current)setError(error instanceof Error?error.message:"More results are unavailable.");}
    finally{if(alive.current){pending.current=false;setBusy(false);}}
  }
  function field(row:InputRow,key:Exclude<keyof InputRow,"id">,value:string){setValues(rows=>rows.map(q=>q.id===row.id?{...q,[key]:value}:q));}
  return <section aria-label="Series calculation worksheet" className="mt-5 min-w-0 border-t border-[var(--border)] pt-5">
    <header className="mb-4 flex flex-wrap items-center justify-between gap-3"><h3 className="flex items-center gap-2 text-base font-semibold"><Sigma size={18}/>Series calculations</h3>
      <div className="flex flex-wrap gap-2"><button className={button} disabled={busy} onClick={()=>{if(!pending.current&&!busy){pending.current=true;setBusy(true);setReload(value=>value+1);}}}><RefreshCw size={16}/>Refresh series</button>
        <button className={button} disabled={busy||!canWrite} onClick={()=>populateInputs()}><Plus size={16}/>New worksheet</button></div></header>
    {error && <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
    <form onSubmit={event=>{event.preventDefault();void execute();}} className="space-y-4">
      <div className="grid min-w-0 gap-4 sm:grid-cols-3"><label className="text-sm">Operation<select aria-label="Series operation" className={control} value={operation} disabled={busy||!canWrite} onChange={event=>setOperation(event.target.value as AggregationOperation)}>
        {aggregationOperations.map(op=><option key={op} value={op}>{label(op)}</option>)}</select></label>
        <label className="text-sm">Decimal places<input aria-label="Series decimal places" type="number" min={0} max={18} step={1} required className={control} value={precision} disabled={busy||!canWrite} onChange={event=>setPrecision(event.target.valueAsNumber)}/></label>
        <label className="text-sm">Missing values<select aria-label="Missing values" className={control} value={policy} disabled={busy||!canWrite} onChange={event=>setPolicy(event.target.value as "REJECT"|"EXCLUDE")}><option value="REJECT">Reject</option><option value="EXCLUDE">Exclude</option></select></label></div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={grouped} disabled={busy||!canWrite} onChange={event=>setGrouped(event.target.checked)}/>Group results</label>
      <div>{values.map((row,index)=><fieldset key={row.id} className="min-w-0 border-b border-[var(--border)] py-4">
        <legend className="px-1 text-sm font-semibold">Value {index+1}</legend>
        <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <label className="text-sm">Value<input aria-label={`Series value ${index+1}`} ref={element=>{if(element)inputs.current.set(row.id,element);else inputs.current.delete(row.id);}} type="text" inputMode="decimal" required={policy==="REJECT"} maxLength={270} className={control} value={row.value} disabled={busy||!canWrite} onChange={event=>field(row,"value",event.target.value)}/></label>
          <label className="text-sm">Unit<input aria-label={`Series unit ${index+1}`} type="text" maxLength={64} required className={control} value={row.unit} disabled={busy||!canWrite} onChange={event=>field(row,"unit",event.target.value)}/></label>
          <label className="text-sm">Evidence references<textarea aria-label={`Series evidence references ${index+1}`} rows={2} maxLength={13000} required className={control} value={row.references} disabled={busy||!canWrite} onChange={event=>field(row,"references",event.target.value)}/></label>
          {operation==="WEIGHTED_AVERAGE" && <label className="text-sm">Weight<input aria-label={`Series weight ${index+1}`} type="text" inputMode="decimal" required maxLength={270} className={control} value={row.weight} disabled={busy||!canWrite} onChange={event=>field(row,"weight",event.target.value)}/></label>}
          {grouped && <label className="text-sm">Group<input aria-label={`Series group ${index+1}`} type="text" required maxLength={128} className={control} value={row.group} disabled={busy||!canWrite} onChange={event=>field(row,"group",event.target.value)}/></label>}
          <div className="flex items-end"><button type="button" className={button} title={`Remove value ${index+1}`} aria-label={`Remove value ${index+1}`} disabled={busy||!canWrite||values.length===1} onClick={()=>{
            pendingFocus.current=values[index+1]?.id??values[index-1]?.id??null;setValues(rows=>rows.filter(q=>q.id!==row.id));
          }}><Trash2 size={16}/></button></div>
        </div></fieldset>)}</div>
      <div className="flex flex-wrap items-center justify-between gap-3"><button type="button" className={button} disabled={busy||!canWrite||values.length>=10000} onClick={()=>{
        const row=newRow(values.at(-1)?.unit);pendingFocus.current=row.id;setValues(rows=>[...rows,row]);
      }}><Plus size={16}/>Add value</button><button type="submit" className={button} disabled={busy||!canWrite}><Sigma size={16}/>{executing?"Calculating...":"Calculate and save series"}</button></div>
    </form>
    <h4 ref={resultsHeading} tabIndex={-1} className="mb-2 mt-6 text-sm font-semibold">Stored series results</h4>
    {!items.length && <p className="text-sm text-[var(--text-muted)]">{busy?"Loading series results...":"No stored series results"}</p>}
    <ol>{items.map(item=><SavedAggregation key={item.id} record={item} initiallyOpen={item.id===latest} onCopy={()=>populateInputs(item.input)} canWrite={canWrite&&!busy}/>)}</ol>
    {nextAfter && <button className={`${button} mt-4`} disabled={busy} onClick={()=>void loadMore()}>Load more series results</button>}
  </section>;
}

function SavedAggregation({record,initiallyOpen,onCopy,canWrite}:{record:AggregationRecord;initiallyOpen:boolean;onCopy:()=>void;canWrite:boolean}) {
  const [open,setOpen]=useState(initiallyOpen);
  useEffect(()=>{if(initiallyOpen)setOpen(true);},[initiallyOpen]);
  return <li className="min-w-0 border-b border-[var(--border)] py-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><button className="flex min-w-0 items-center gap-2 text-left text-sm font-semibold" aria-expanded={open} onClick={()=>setOpen(value=>!value)}>
      <ChevronDown size={16} className={open?"rotate-180":""}/>{label(record.result.operation)}; {record.result.groups.length} {record.result.groups.length===1?"group":"groups"}</button>
      <button className={button} disabled={!canWrite} onClick={onCopy}><Copy size={16}/>Use inputs</button></div>
    <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">Saved series calculation. Review required. Input evidence is caller-supplied, not verified.</p>
    {open && <div className="mt-4 space-y-5">{record.result.groups.map((group,index)=><GroupResult key={group.group??index} group={group}/>)}
      <p className="mt-3 text-xs text-[var(--text-muted)]">{record.result.missing_value_treatment}; {record.result.precision} decimal places; half even</p></div>}
  </li>;
}
function GroupResult({group}:{group:AggregateGroup}) {
  const [page,setPage]=useState(0),size=50;
  return <section aria-label={group.group?`Result group ${group.group}`:"Aggregate result"} className="min-w-0">
    {group.group && <h5 className="break-words text-sm font-semibold">{group.group}</h5>}
    {group.value!==null && <p aria-label="Aggregate value" className="break-all text-lg font-semibold">{group.value} {group.unit}</p>}
    <p className="mt-1 text-xs text-[var(--text-muted)]">{group.included_count} included; {group.excluded_count} excluded</p>
    {group.excluded_input_indices.length>0 && <p className="mt-1 break-words text-xs text-[var(--text-muted)]">Excluded inputs: {group.excluded_input_indices.map(index=>index+1).join(", ")}</p>}
    {group.rows.length>0 && <><div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>
      <th className="p-2 font-medium">{group.value_display==="INPUT_VALUES_UNROUNDED"?"Position / input":"Metric"}</th><th className="p-2 font-medium">Value</th><th className="p-2 font-medium">Unit</th>{group.value_display==="INPUT_VALUES_UNROUNDED" && <th className="p-2 font-medium">Evidence references</th>}</tr></thead>
      <tbody>{group.rows.slice(page*size,(page+1)*size).map((row,index)=><tr key={row.key??row.input_index??index} className="border-t border-[var(--border)]">
        <td className="p-2">{row.position!==undefined && row.input_index!==undefined?`${row.position} / ${row.input_index+1}`:row.key}</td><td className="break-all p-2">{row.value}</td><td className="break-all p-2">{row.unit}</td>{group.value_display==="INPUT_VALUES_UNROUNDED" && <td className="whitespace-pre-wrap break-all p-2">{row.evidence_ids?.join("\n")}</td>}</tr>)}</tbody></table></div>
      {group.rows.length>size && <div className="mt-2 flex items-center gap-3"><button className={button} title="Previous result rows" aria-label="Previous result rows" disabled={page===0} onClick={()=>setPage(value=>value-1)}><ChevronLeft size={16}/></button>
        <span className="text-xs">{page*size+1}-{Math.min((page+1)*size,group.rows.length)} of {group.rows.length}</span>
        <button className={button} title="Next result rows" aria-label="Next result rows" disabled={(page+1)*size>=group.rows.length} onClick={()=>setPage(value=>value+1)}><ChevronRight size={16}/></button></div>}</>}
    <details className="mt-3 text-sm"><summary className="cursor-pointer font-medium">Expression &amp; references</summary><p className="mt-2 break-all">{group.expression}</p>
      <p className="mt-2 whitespace-pre-wrap break-all">{group.evidence_ids.join("\n")}</p></details>
  </section>;
}
