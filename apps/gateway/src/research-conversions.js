import {readBoundedJsonObject} from "./request-body.js";
import {workbenchContext} from "./workbench.js";
const UUID=/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const decimal=/^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d{1,3})?$/;
const invalid=()=>{throw Object.assign(new Error("Enter finite decimal-text values, a positive supplied factor, units, source/factor references, an optional valid ISO date and precision from 0 to 18."),{status:422,code:"INVALID_CONVERSION"});};
function text(value,max){if(typeof value!=="string" || !value.trim() || value.length>max || value.includes("\0"))invalid();return value.trim();}
function number(value){if(typeof value!=="string" || value.length>270 || !decimal.test(value))invalid();return value;}
function date(value){
  if(value===null)return null;
  if(typeof value!=="string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000") ||
    !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0,10)!==value)invalid();
  return value;
}
export function validateConversion(input){
  const q=input?.quantity;
  if(!q || !Array.isArray(q.evidence_ids) || !q.evidence_ids.length || q.evidence_ids.length>100 ||
    !Number.isInteger(input.precision) || input.precision<0 || input.precision>18)invalid();
  const factor=number(input.factor);
  if(factor.startsWith("-") || !/[1-9]/.test(factor.split(/[eE]/)[0]))invalid();
  return {quantity:{value:number(q.value),unit:text(q.unit,64),evidence_ids:q.evidence_ids.map(id=>text(id,128))},
    factor,target_unit:text(input.target_unit,64),conversion_evidence_id:text(input.conversion_evidence_id,128),
    factor_effective_on:date(input.factor_effective_on),precision:input.precision};
}
function confirmed(row,args,plan){
  if(!row || !UUID.test(row.id||"") || row.plan_id!==plan || row.owner_id!==args.user.id || row.workspace_id!==args.workspace ||
    row.schema_version!=="research-conversion/1" || row.state!=="calculated" || row.persistence_state!=="PERSISTED" || row.input_evidence_state!=="CALLER_ASSERTED_NOT_VERIFIED")return false;
  try{const input=validateConversion(row.input),r=row.result;
    return !!r && r.operation==="CONVERT_UNIT" && typeof r.value==="string" && r.value.length<=300 && /^-?\d+(\.\d+)?$/.test(r.value) &&
      r.unit===input.target_unit && r.formula===`${input.quantity.value}*${input.factor}` && r.precision===input.precision && r.rounding==="ROUND_HALF_EVEN" &&
      JSON.stringify(r.evidence_ids)===JSON.stringify([...new Set([...input.quantity.evidence_ids,input.conversion_evidence_id])]);
  }catch{return false;}
}
export async function handleResearchConversions(args){
  const {request,env,member,serviceRequest,json}=args,url=new URL(request.url);
  const match=url.pathname.match(/^\/api\/v2\/research\/plans\/([0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12})\/conversions$/i);
  if(!match)return null;
  const plan=match[1].toLowerCase(),creating=request.method==="POST";
  if(!creating && !["GET","HEAD"].includes(request.method))throw Object.assign(new Error("Conversions support execution and reading stored results."),{status:405,code:"METHOD_NOT_ALLOWED"});
  if(creating && !["owner","admin","editor"].includes(member.role))throw Object.assign(new Error("Conversion execution requires editor access."),{status:403,code:"FORBIDDEN"});
  const limit=Number(url.searchParams.get("limit")||20),after=url.searchParams.get("after");
  if(!Number.isInteger(limit) || limit<1 || limit>50 || (after && !UUID.test(after)))invalid();
  const input=creating?validateConversion(await readBoundedJsonObject(request)):null;
  const key=creating?text(request.headers.get("idempotency-key"),128):null;
  let result;
  try{result=await serviceRequest(env,"rpc/nexus_research_conversion",{method:"POST",body:JSON.stringify({p_context:await workbenchContext(args),
    p_operation:creating?"create":"list",p_plan_id:plan,p_input:input,p_key:key,p_limit:limit,p_after:after?.toLowerCase()||null})});}
  catch(error){
    if(error.code==="SOURCE_UNAVAILABLE" || error.code==="QUANTITY_MISMATCH")throw Object.assign(new Error("A captured source quantity changed, is unavailable or no longer matches the input. Refresh the source capture before calculating."),{status:409,code:error.code});
    if(["PGRST202","42883","42P01","42703"].includes(error.storageCode))throw Object.assign(new Error("Conversion storage requires the reviewed research_conversion_execution migration."),{status:503,code:"MIGRATION_REQUIRED"});
    if(["INVALID_SCOPE","CALCULATION_INVALID","CALCULATION_MODE_REQUIRED"].includes(error.code))invalid();
    if(error.code==="NOT_FOUND")throw Object.assign(new Error("The saved Calculation plan is unavailable."),{status:404,code:"NOT_FOUND"});
    if(error.code==="TENANT_QUOTA_EXCEEDED")throw Object.assign(new Error("The stored calculation limit has been reached. No conversion was saved."),{status:429,code:"TENANT_QUOTA_EXCEEDED"});
    throw error;
  }
  if(creating?!confirmed(result,args,plan) || JSON.stringify(validateConversion(result.input))!==JSON.stringify(input)
    :!result || !Array.isArray(result.items) || result.items.length>limit || result.items.some(row=>!confirmed(row,args,plan)) ||
      (result.next_after!==null && !UUID.test(result.next_after||"")))throw Object.assign(new Error("Stored conversion was not confirmed. Refresh before retrying."),{status:503,code:"PERSISTENCE_UNCONFIRMED"});
  return json(request,env,result,creating?201:200);
}
