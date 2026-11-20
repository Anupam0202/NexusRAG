"use client";
import {useEffect,useMemo,useRef,useState} from "react";
import {FileSearch,RefreshCw,Save} from "lucide-react";
import {createResearchQuantity,getDocumentChunks,listResearchQuantities} from "@/lib/api";
import {literalSourceSelections,numericSourceSelections,type QuantityCaptureInput,type QuantityCaptureRecord,type SourceQuantity,type TextSpan} from "@/lib/research-quantity";
import type {DocumentChunkPreview,DocumentMetadata} from "@/types";
const control="mt-1 w-full min-w-0 rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-2 text-sm";
const button="inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-sm disabled:opacity-50";
function MarkedText({text,spans}:{text:string;spans:TextSpan[]}){
  const points=Array.from(text),parts=[];let after=0;
  for(const span of [...spans].sort((a,b)=>a.start-b.start)){
    if(span.start<after)continue;
    parts.push(points.slice(after,span.start).join(""));parts.push(<mark key={span.start} className="bg-yellow-200 text-black">{points.slice(span.start,span.end).join("")}</mark>);after=span.end;
  }
  return <>{parts}{points.slice(after).join("")}</>;
}
export function SourceQuantities({planId,workspaceId,userId,canWrite,documents,privateSourceIds,onRecords}:{
  planId:string;workspaceId:string;userId:string;canWrite:boolean;documents:DocumentMetadata[];privateSourceIds:string[];onRecords:(rows:QuantityCaptureRecord[])=>void;
}){
  const [records,setRecords]=useState<QuantityCaptureRecord[]>([]),[next,setNext]=useState<string|null>(null),[reload,setReload]=useState(0);
  const [busy,setBusy]=useState(true),[error,setError]=useState<string|null>(null),[saving,setSaving]=useState(false);
  const [documentId,setDocumentId]=useState(""),[search,setSearch]=useState(""),[chunks,setChunks]=useState<DocumentChunkPreview[]>([]);
  const [version,setVersion]=useState(""),[after,setAfter]=useState<number|null>(null),[sourceBusy,setSourceBusy]=useState(false),[sourceError,setSourceError]=useState<string|null>(null),[sourceReload,setSourceReload]=useState(0);
  const [chunkKey,setChunkKey]=useState(""),[valueKey,setValueKey]=useState(""),[unitText,setUnitText]=useState(""),[unitKey,setUnitKey]=useState("");
  const alive=useRef(true),pending=useRef(false),sequence=useRef(0),identity=useRef<{body:string;key:string}|null>(null),heading=useRef<HTMLHeadingElement>(null);
  const notify=useRef(onRecords);
  useEffect(()=>{notify.current=onRecords;},[onRecords]);
  useEffect(()=>{alive.current=true;const counter=sequence;return()=>{alive.current=false;counter.current++;};},[]);
  useEffect(()=>{
    let current=true;pending.current=true;setBusy(true);setError(null);setRecords([]);setNext(null);notify.current([]);
    listResearchQuantities(planId,{workspaceId,expectedUserId:userId}).then(page=>{if(current){setRecords(page.items);setNext(page.next_after);notify.current(page.items);}})
      .catch(error=>{if(current)setError(error instanceof Error?error.message:"Source quantities are unavailable.");})
      .finally(()=>{if(current){pending.current=false;setBusy(false);}});
    return()=>{current=false;};
  },[planId,workspaceId,userId,reload]);
  useEffect(()=>{
    const current=++sequence.current;setChunks([]);setVersion("");setAfter(null);setChunkKey("");setValueKey("");setUnitKey("");setSourceError(null);
    if(!documentId){setSourceBusy(false);return;}
    setSourceBusy(true);
    const timer=setTimeout(()=>{getDocumentChunks(documentId,{search,limit:50},{workspaceId,expectedUserId:userId}).then(page=>{
      if(!alive.current || sequence.current!==current)return;
      if(page.authority!=="SUPABASE_HASH_VERIFIED" || !page.version_id || page.coverage?.state!=="COMPLETE_BOUNDED_DOCUMENT")throw new Error("Source text/version is not confirmed. Refresh the document.");
      setChunks(page.chunks);setVersion(page.version_id);setAfter(page.next_after??null);
    }).catch(error=>{if(alive.current && sequence.current===current)setSourceError(error instanceof Error?error.message:"Source text is unavailable.");})
      .finally(()=>{if(alive.current && sequence.current===current)setSourceBusy(false);});},250);
    return()=>clearTimeout(timer);
  },[documentId,search,workspaceId,userId,sourceReload]);
  const chunk=chunks.find(row=>String(row.chunk_index)===chunkKey);
  const values=useMemo(()=>numericSourceSelections(chunk?.content??""),[chunk?.content]);
  const units=useMemo(()=>literalSourceSelections(chunk?.content??"",unitText.trim()),[chunk?.content,unitText]);
  const value=values.find(item=>item.key===valueKey),unit=units.find(item=>item.key===unitKey);
  const overlap=!!value && !!unit && value.start<unit.end && unit.start<value.end;
  const choices=documents.filter(doc=>doc.status==="ready" && (!privateSourceIds.length || privateSourceIds.some(id=>id.toLowerCase()===doc.document_id.toLowerCase())));
  async function capture(){
    if(pending.current || busy || sourceBusy || !canWrite || !chunk?.original_content_hash || !value || !unit || overlap || !version)return;
    pending.current=true;setBusy(true);setSaving(true);setError(null);
    const input:QuantityCaptureInput={document_id:documentId,version_id:version,chunk_index:chunk.chunk_index,original_content_hash:chunk.original_content_hash,
      value_span:{start:value.start,end:value.end},unit_span:{start:unit.start,end:unit.end}};
    const body=JSON.stringify(input);if(identity.current?.body!==body)identity.current={body,key:crypto.randomUUID()};
    try{const row=await createResearchQuantity(planId,input,identity.current.key,{workspaceId,expectedUserId:userId});
      if(alive.current){const items=[row,...records.filter(old=>old.id!==row.id)];setRecords(items);notify.current(items);heading.current?.focus();heading.current?.scrollIntoView?.({block:"start"});}}
    catch(error){if(alive.current)setError(error instanceof Error?error.message:"Source capture was not confirmed.");}
    finally{if(alive.current){pending.current=false;setBusy(false);setSaving(false);}}
  }
  async function moreSources(){
    if(sourceBusy || after===null || !version)return;const current=++sequence.current;setSourceBusy(true);setSourceError(null);
    try{const page=await getDocumentChunks(documentId,{search,limit:50,after,versionId:version},{workspaceId,expectedUserId:userId});
      if(!alive.current || sequence.current!==current)return;
      if(page.version_id!==version || page.authority!=="SUPABASE_HASH_VERIFIED" || page.chunks.some(row=>chunks.some(old=>old.chunk_index===row.chunk_index)) || (page.next_after!=null && page.next_after<=after))throw new Error("The source inventory changed. Select the document again.");
      setChunks(old=>[...old,...page.chunks]);setAfter(page.next_after??null);
    }catch(error){if(alive.current && sequence.current===current)setSourceError(error instanceof Error?error.message:"More source text is unavailable.");}
    finally{if(alive.current && sequence.current===current)setSourceBusy(false);}
  }
  async function moreRecords(){
    if(pending.current || busy || !next)return;pending.current=true;setBusy(true);setError(null);
    try{const page=await listResearchQuantities(planId,{workspaceId,expectedUserId:userId},next);
      if(alive.current){const items=[...records,...page.items.filter(row=>!records.some(old=>old.id===row.id))];setRecords(items);setNext(page.next_after);notify.current(items);}}
    catch(error){if(alive.current)setError(error instanceof Error?error.message:"More source quantities are unavailable.");}
    finally{if(alive.current){pending.current=false;setBusy(false);}}
  }
  return <section aria-label="Captured source quantities" className="mt-5 min-w-0 border-t border-[var(--border)] pt-5">
    <header className="mb-4 flex flex-wrap items-center justify-between gap-3"><h3 className="flex items-center gap-2 text-base font-semibold"><FileSearch size={18}/>Source quantities</h3>
      <button className={button} disabled={busy} onClick={()=>{if(!pending.current){pending.current=true;setBusy(true);setReload(n=>n+1);}}}><RefreshCw size={16}/>Refresh captures</button></header>
    {error && <p role="alert" className="mb-3 text-sm text-red-700 dark:text-red-300">{error}</p>}
    <form onSubmit={event=>{event.preventDefault();void capture();}} className="space-y-4">
      <div className="grid min-w-0 gap-4 sm:grid-cols-2"><label className="min-w-0 text-sm">Source document<select aria-label="Quantity source document" className={control} disabled={busy||!canWrite} value={documentId} onChange={event=>{setSourceBusy(true);setChunkKey("");setDocumentId(event.target.value);setSearch("");}}><option value="">Choose a ready document</option>{choices.map(doc=><option key={doc.document_id} value={doc.document_id}>{doc.filename}</option>)}</select></label>
        <div className="flex min-w-0 items-end gap-2"><label className="min-w-0 flex-1 text-sm">Source text search<input aria-label="Quantity source search" className={control} type="search" maxLength={200} disabled={busy||!canWrite||!documentId} value={search} onChange={event=>{setSourceBusy(true);setChunkKey("");setSearch(event.target.value);}}/></label>
          <button type="button" aria-label="Refresh quantity source text" title="Refresh source text" className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] disabled:opacity-50" disabled={busy||sourceBusy||!documentId} onClick={()=>{setSourceBusy(true);setChunkKey("");setSourceReload(n=>n+1);}}><RefreshCw size={16}/></button></div></div>
      {sourceError && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{sourceError}</p>}
      {sourceBusy && <p role="status" className="text-sm">Loading source text...</p>}
      {!!documentId && !sourceBusy && !chunks.length && !sourceError && <p className="text-sm text-[var(--text-muted)]">No matching source chunks</p>}
      {!!chunks.length && <><label className="block text-sm">Source chunk<select aria-label="Quantity source chunk" className={control} disabled={busy||sourceBusy||!canWrite} value={chunkKey} onChange={event=>{setChunkKey(event.target.value);setValueKey("");setUnitText("");setUnitKey("");}}><option value="">Choose an exact chunk</option>{chunks.map(row=><option key={row.chunk_index} value={row.chunk_index}>Chunk {row.chunk_index+1}{row.page_number>0?` - page ${row.page_number}`:""}</option>)}</select></label>
        {after!==null && <button className={button} type="button" disabled={busy||sourceBusy} onClick={()=>void moreSources()}>Load more source chunks</button>}</>}
      {chunk && <><div role="textbox" aria-readonly="true" aria-multiline="true" tabIndex={0} aria-label="Exact quantity source text" className="max-h-56 overflow-y-auto whitespace-pre-wrap break-words border-l-2 border-[var(--border)] pl-3 text-sm"><MarkedText text={chunk.content} spans={[...(value?[value]:[]),...(unit?[unit]:[])]}/></div>
        <div className="grid min-w-0 gap-4 sm:grid-cols-3"><label className="min-w-0 text-sm">Numeric value<select aria-label="Quantity numeric selection" className={control} disabled={busy||!canWrite} value={valueKey} onChange={event=>setValueKey(event.target.value)}><option value="">Choose a numeric span</option>{values.map(item=><option key={item.key} value={item.key}>{item.text} - character {item.start+1}</option>)}</select></label>
          <label className="text-sm">Exact unit text<input aria-label="Quantity unit text" className={control} maxLength={64} disabled={busy||!canWrite} value={unitText} onChange={event=>{setUnitText(event.target.value);setUnitKey("");}}/></label>
          <label className="min-w-0 text-sm">Unit occurrence<select aria-label="Quantity unit selection" className={control} disabled={busy||!canWrite} value={unitKey} onChange={event=>setUnitKey(event.target.value)}><option value="">Choose a unit span</option>{units.map(item=><option key={item.key} value={item.key}>{item.text} - character {item.start+1}</option>)}</select></label></div>
        {!values.length && <p role="status" className="text-sm text-[var(--text-muted)]">No supported decimal spans in this chunk.</p>}
        {(values.length===200 || units.length===200) && <p role="status" className="text-sm text-[var(--text-muted)]">Showing the first 200 matching spans.</p>}
        {!!unitText.trim() && !units.length && <p role="status" className="text-sm text-[var(--text-muted)]">Unit text was not found in this chunk.</p>}
        {overlap && <p role="alert" className="text-sm text-red-700 dark:text-red-300">Numeric and unit spans must not overlap.</p>}
        <button className={button} type="submit" disabled={busy||sourceBusy||!canWrite||!value||!unit||overlap||!chunk.original_content_hash}><Save size={16}/>{saving?"Capturing...":"Capture source quantity"}</button></>}
    </form>
    <h4 ref={heading} tabIndex={-1} className="mb-2 mt-5 text-sm font-semibold">Stored source quantities</h4>
    {!records.length && <p className="text-sm text-[var(--text-muted)]">{busy?"Loading captures...":"No captured quantities"}</p>}
    <ol>{records.map(row=><li key={row.id} className="min-w-0 border-b border-[var(--border)] py-4">
      {row.quantity && row.source?<><p aria-label="Captured quantity" className="break-all font-semibold">{row.quantity.value} {row.quantity.unit}</p><p className="mt-1 break-words text-xs text-[var(--text-muted)]">{row.source.filename}; chunk {row.input.chunk_index+1}{row.source.page_number?`; page ${row.source.page_number}`:""}; {row.freshness}</p>
        <blockquote className="mt-2 whitespace-pre-wrap break-words text-sm"><MarkedText text={row.source.value_context.text} spans={[{start:row.source.value_context.span_start,end:row.source.value_context.span_end}]}/></blockquote>
        <blockquote aria-label="Captured unit context" className="mt-2 whitespace-pre-wrap break-words text-sm"><MarkedText text={row.source.unit_context.text} spans={[{start:row.source.unit_context.span_start,end:row.source.unit_context.span_end}]}/></blockquote>
        <p className="mt-2 break-all text-xs text-[var(--text-muted)]">{row.quantity.evidence_ids[0]}</p><p className="mt-2 text-xs text-amber-700 dark:text-amber-300">Source spans matched. Context and interpretation require review.</p></>:<p className="text-sm text-amber-700 dark:text-amber-300">Captured source unavailable. Numeric input withheld.</p>}
    </li>)}</ol>
    {next && <button className={`${button} mt-3`} disabled={busy} onClick={()=>void moreRecords()}>Load more captures</button>}
  </section>;
}

export function SourceQuantitySelect({records,label,disabled,onSelect}:{records:QuantityCaptureRecord[];label:string;disabled:boolean;onSelect:(quantity:SourceQuantity)=>void}){
  const available=records.filter(row=>row.source_state==="SOURCE_SPANS_MATCHED_REVIEW_REQUIRED" && row.freshness==="current" && row.quantity);
  if(!available.length)return null;
  return <label className="block min-w-0 text-sm">{label}<select aria-label={label} className={control} value="" disabled={disabled} onChange={event=>{const row=available.find(row=>row.id===event.target.value);if(row?.quantity)onSelect(row.quantity);}}><option value="">Choose a captured quantity</option>{available.map(row=><option key={row.id} value={row.id}>{row.quantity!.value} {row.quantity!.unit} - {row.source?.filename}</option>)}</select></label>;
}
