import {readBoundedJsonObject} from './request-body.js';
import {workbenchContext} from './workbench.js';
const UUID=/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const problem=(code,message,status=422)=>Object.assign(new Error(message),{code,message,status});
const invalid=()=>{throw problem('INVALID_QUANTITY_CAPTURE','Choose an exact document version, chunk hash and nonoverlapping numeric/unit text spans.');};
function span(value,maximum){
  if(!value || !Number.isInteger(value.start) || !Number.isInteger(value.end) || value.start<0 || value.end>1000000 ||
    value.end-value.start<1 || value.end-value.start>maximum)invalid();
  return {start:value.start,end:value.end};
}
export function validateQuantityCapture(input){
  if(!input || typeof input.document_id!=='string' || !UUID.test(input.document_id) || typeof input.version_id!=='string' || !UUID.test(input.version_id) ||
    !Number.isInteger(input.chunk_index) || input.chunk_index<0 || input.chunk_index>999999 || !/^[a-f0-9]{64}$/.test(input.original_content_hash||''))invalid();
  const value=span(input.value_span,270),unit=span(input.unit_span,64);
  if(value.start<unit.end && unit.start<value.end)invalid();
  return {document_id:input.document_id.toLowerCase(),version_id:input.version_id.toLowerCase(),chunk_index:input.chunk_index,
    original_content_hash:input.original_content_hash,value_span:value,unit_span:unit};
}
function excerpt(value,expected,length){
  if(!value || typeof value.text!=='string' || value.text.length>800 || !Number.isInteger(value.span_start) || !Number.isInteger(value.span_end) ||
    value.span_start<0 || value.span_end-value.span_start!==length)return false;
  return Array.from(value.text).slice(value.span_start,value.span_end).join('')===expected;
}
function confirmed(row,args,plan){
  if(!row || !UUID.test(row.id||'') || row.plan_id!==plan || row.workspace_id!==args.workspace || row.owner_id!==args.user.id || !UUID.test(row.chunk_id||'') ||
    row.schema_version!=='research-quantity/1' || row.persistence_state!=='PERSISTED' || row.state!=='captured')return false;
  try{
    const input=validateQuantityCapture(row.input);
    if(row.document_id!==input.document_id || row.version_id!==input.version_id)return false;
    if(row.source_state==='SOURCE_UNAVAILABLE')return row.freshness==='unavailable' && row.quantity===null && row.source===null;
    const q=row.quantity,s=row.source;
    return row.source_state==='SOURCE_SPANS_MATCHED_REVIEW_REQUIRED' && ['current','stale'].includes(row.freshness) && !!q && !!s &&
      typeof q.value==='string' && q.value.length<=270 && /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d{1,3})?$/.test(q.value) &&
      typeof q.unit==='string' && q.unit.length>=1 && q.unit.length<=64 && q.unit.trim()===q.unit &&
      JSON.stringify(q.evidence_ids)===JSON.stringify([`urn:nexusrag:quantity:${row.id}`]) && typeof s.filename==='string' && s.filename.length<=1000 &&
      excerpt(s.value_context,q.value,input.value_span.end-input.value_span.start) && excerpt(s.unit_context,q.unit,input.unit_span.end-input.unit_span.start);
  }catch{return false;}
}
export async function handleResearchQuantities(args){
  const {request,env,member,serviceRequest,json}=args,url=new URL(request.url);
  const match=url.pathname.match(/^\/api\/v2\/research\/plans\/([0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12})\/quantities$/i);
  if(!match)return null;
  const plan=match[1].toLowerCase(),creating=request.method==='POST';
  if(!creating && !['GET','HEAD'].includes(request.method))throw problem('METHOD_NOT_ALLOWED','Source quantities support capture and reading stored records.',405);
  if(creating && !['owner','admin','editor'].includes(member.role))throw problem('FORBIDDEN','Source capture requires editor access.',403);
  const limit=Number(url.searchParams.get('limit')||20),after=url.searchParams.get('after');
  if(!Number.isInteger(limit) || limit<1 || limit>50 || (after && !UUID.test(after)))invalid();
  const input=creating?validateQuantityCapture(await readBoundedJsonObject(request,{maxBytes:4000})):null;
  const key=creating?request.headers.get('idempotency-key'):null;
  if(creating && (!key || key.length>128 || key.includes('\0')))invalid();
  let result;
  try{result=await serviceRequest(env,'rpc/nexus_research_quantity',{method:'POST',body:JSON.stringify({p_context:await workbenchContext(args),
    p_operation:creating?'create':'list',p_plan_id:plan,p_input:input,p_key:key,p_limit:limit,p_after:after?.toLowerCase()||null})});}
  catch(error){
    if(['PGRST202','42883','42P01','42703'].includes(error.storageCode))throw problem('MIGRATION_REQUIRED','Source quantity storage requires the reviewed research_source_quantities migration.',503);
    if(['INVALID_SCOPE','CALCULATION_INVALID','CALCULATION_MODE_REQUIRED'].includes(error.code))invalid();
    if(error.code==='SOURCE_UNAVAILABLE')throw problem('SOURCE_UNAVAILABLE','The selected source changed or is unavailable. Refresh the document before capturing.',409);
    if(error.code==='NOT_FOUND')throw problem('NOT_FOUND','The saved Calculation plan is unavailable.',404);
    if(error.code==='TENANT_QUOTA_EXCEEDED')throw problem('TENANT_QUOTA_EXCEEDED','The source quantity storage limit has been reached. No new capture was saved.',429);
    throw error;
  }
  if(creating?!confirmed(result,args,plan) || JSON.stringify(validateQuantityCapture(result.input))!==JSON.stringify(input)
    :!result || !Array.isArray(result.items) || result.items.length>limit || result.items.some(row=>!confirmed(row,args,plan)) ||
      (result.next_after!==null && !UUID.test(result.next_after||'')))throw problem('PERSISTENCE_UNCONFIRMED','Source quantity persistence was not confirmed. Refresh before retrying.',503);
  return json(request,env,result,creating?201:200);
}
