export interface TextSpan {start:number;end:number}
export interface QuantityCaptureInput {document_id:string;version_id:string;chunk_index:number;original_content_hash:string;value_span:TextSpan;unit_span:TextSpan}
export interface SourceQuantity {value:string;unit:string;evidence_ids:string[]}
export interface SourceContext {text:string;span_start:number;span_end:number}
export interface QuantityCaptureRecord {
  id:string;workspace_id:string;owner_id:string;plan_id:string;document_id:string;version_id:string;chunk_id:string;
  input:QuantityCaptureInput;quantity:SourceQuantity|null;created_at:string;
  source:{filename:string;page_number:number|null;location:unknown;value_context:SourceContext;unit_context:SourceContext}|null;
  state:"captured";schema_version:"research-quantity/1";persistence_state:"PERSISTED";
  source_state:"SOURCE_SPANS_MATCHED_REVIEW_REQUIRED"|"SOURCE_UNAVAILABLE";freshness:"current"|"stale"|"unavailable";
}
export function canonicalQuantityCapture(input:QuantityCaptureInput):QuantityCaptureInput {
  return {document_id:input.document_id,version_id:input.version_id,chunk_index:input.chunk_index,original_content_hash:input.original_content_hash,
    value_span:{start:input.value_span.start,end:input.value_span.end},unit_span:{start:input.unit_span.start,end:input.unit_span.end}};
}
export function confirmedQuantityCapture(value:unknown,planId:string):value is QuantityCaptureRecord {
  try{
    const row=value as QuantityCaptureRecord,q=row.quantity,s=row.source,input=row.input;
    if(!row || !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(row.id) || row.plan_id!==planId || row.state!=="captured" ||
      row.schema_version!=="research-quantity/1" || row.persistence_state!=="PERSISTED" || row.document_id!==input.document_id || row.version_id!==input.version_id ||
      !Number.isInteger(input.chunk_index) || input.chunk_index<0 || !/^[a-f0-9]{64}$/.test(input.original_content_hash))return false;
    for(const [span,max] of [[input.value_span,270],[input.unit_span,64]] as const)if(!span || !Number.isInteger(span.start) || !Number.isInteger(span.end) || span.start<0 || span.end>1000000 || span.end-span.start<1 || span.end-span.start>max)return false;
    if(row.source_state==="SOURCE_UNAVAILABLE")return row.freshness==="unavailable" && q===null && s===null;
    const context=(context:SourceContext,expected:string,length:number)=>typeof context?.text==="string" && context.text.length<=800 && Number.isInteger(context.span_start) && context.span_start>=0 &&
      context.span_end-context.span_start===length && Array.from(context.text).slice(context.span_start,context.span_end).join("")===expected;
    return row.source_state==="SOURCE_SPANS_MATCHED_REVIEW_REQUIRED" && ["current","stale"].includes(row.freshness) && !!q && !!s &&
      typeof q.value==="string" && q.value.length<=270 && /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d{1,3})?$/.test(q.value) &&
      typeof q.unit==="string" && !!q.unit.trim() && q.unit.trim()===q.unit && q.unit.length<=64 &&
      JSON.stringify(q.evidence_ids)===JSON.stringify([`urn:nexusrag:quantity:${row.id}`]) && typeof s.filename==="string" &&
      context(s.value_context,q.value,input.value_span.end-input.value_span.start) && context(s.unit_context,q.unit,input.unit_span.end-input.unit_span.start);
  }catch{return false;}
}
export interface SourceSelection extends TextSpan {text:string;key:string}
function selections(text:string,matches:Iterable<RegExpMatchArray|{index:number;0:string}>):SourceSelection[]{
  const points=Array.from(text),result:SourceSelection[]=[];let utf16=0,index=0;
  function advance(offset:number){while(utf16<offset && index<points.length)utf16+=points[index++].length;return index;}
  for(const match of matches){
    const start=advance(match.index??0),end=advance((match.index??0)+match[0].length);
    result.push({start,end,text:match[0],key:`${start}:${end}`});if(result.length===200)break;
  }
  return result;
}
export function numericSourceSelections(text:string):SourceSelection[]{
  function* matches(){for(const match of text.matchAll(/[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d{1,3})?/g)){
    const before=text.slice(Math.max(0,match.index-2),match.index),after=text.slice(match.index+match[0].length,match.index+match[0].length+2);
    if(/[0-9.]$|[0-9],$/.test(before) || /^[0-9.]|^,[0-9]/.test(after))continue;
    yield match;
  }}
  return selections(text,matches());
}
export function literalSourceSelections(text:string,term:string):SourceSelection[]{
  if(!term || term.length>64)return [];
  function* matches(){let offset=0;while(offset<=text.length){const index=text.indexOf(term,offset);if(index<0)return;yield {index,0:term};offset=index+term.length;}}
  return selections(text,matches());
}
