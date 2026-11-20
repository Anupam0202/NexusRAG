import { readBoundedJsonObject } from "./request-body.js";
import { workbenchContext } from "./workbench.js";
const UUID=/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const operations=["ADD","SUBTRACT","MULTIPLY","DIVIDE","PERCENT_CHANGE","RATIO","DIFFERENCE"];
const invalid=()=>{throw Object.assign(new Error("Choose an operation, decimal-text values, units, evidence references and precision from 0 to 18."),{status:422,code:"INVALID_CALCULATION"});};
export function validateCalculation(value) {
  if(!value || !operations.includes(value.operation) || !Number.isInteger(value.precision) || value.precision<0 || value.precision>18) invalid();
  const quantity=q=>{
    if(!q || typeof q.value!=="string" || q.value.length>270 || !/^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d{1,3})?$/.test(q.value) ||
      typeof q.unit!=="string" || !q.unit.trim() || q.unit.length>64 || q.unit.includes("\0") ||
      !Array.isArray(q.evidence_ids) || !q.evidence_ids.length || q.evidence_ids.length>100 ||
      q.evidence_ids.some(id=>typeof id!=="string" || !id.trim() || id.length>128 || id.includes("\0"))) invalid();
    return {value:q.value,unit:q.unit.trim(),evidence_ids:q.evidence_ids.map(id=>id.trim())};
  };
  return {operation:value.operation,left:quantity(value.left),right:quantity(value.right),precision:value.precision};
}
function confirmed(value,args,plan) {
  if(!value || !UUID.test(value.id||"") || value.plan_id!==plan || value.workspace_id!==args.workspace || value.owner_id!==args.user.id ||
    value.schema_version!=="research-calculation/1" || value.persistence_state!=="PERSISTED" || value.state!=="calculated" ||
    value.input_evidence_state!=="CALLER_ASSERTED_NOT_VERIFIED")return false;
  try {
    const input=validateCalculation(value.input),r=value.result;
    return !!r && r.operation===input.operation && r.precision===input.precision && r.rounding==="ROUND_HALF_EVEN" &&
      typeof r.value==="string" && r.value.length<=300 && /^-?\d+(\.\d+)?$/.test(r.value) &&
      typeof r.unit==="string" && !!r.unit && r.unit.length<=129 && typeof r.formula==="string" && r.formula.length<=600 &&
      Array.isArray(r.evidence_ids) && JSON.stringify(r.evidence_ids)===JSON.stringify([...new Set([...input.left.evidence_ids,...input.right.evidence_ids])]);
  }catch{return false;}
}
export async function handleResearchCalculations(args) {
  const {request,env,member,serviceRequest,json}=args;
  const match=new URL(request.url).pathname.match(/^\/api\/v2\/research\/plans\/([0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12})\/calculations$/i);
  if(!match)return null;
  const plan=match[1].toLowerCase(),creating=request.method==="POST";
  if(!creating && !["GET","HEAD"].includes(request.method))throw Object.assign(new Error("Calculations support execution and reading stored results."),{status:405,code:"METHOD_NOT_ALLOWED"});
  if(creating && !["editor","admin","owner"].includes(member.role))throw Object.assign(new Error("Calculation execution requires editor access."),{status:403,code:"FORBIDDEN"});
  const input=creating?validateCalculation(await readBoundedJsonObject(request)):null;
  const key=creating?request.headers.get("idempotency-key"):null;
  if(creating && (typeof key!=="string" || !key.trim() || key.length>128))invalid();
  let result;
  try {result=await serviceRequest(env,"rpc/nexus_research_calculation",{method:"POST",body:JSON.stringify({
    p_context:await workbenchContext(args),p_operation:creating?"create":"list",p_plan_id:plan,p_input:input,p_key:key})});}
  catch(error){
    if(error.code==="SOURCE_UNAVAILABLE" || error.code==="QUANTITY_MISMATCH")throw Object.assign(new Error("A captured source quantity changed, is unavailable or no longer matches the input. Refresh the source capture before calculating."),{status:409,code:error.code});
    if(["PGRST202","42883","42P01"].includes(error.storageCode))throw Object.assign(new Error("Calculation storage requires the reviewed research_calculation_execution migration."),{status:503,code:"MIGRATION_REQUIRED"});
    if(error.code==="CALCULATION_INVALID")throw Object.assign(new Error("Calculation is undefined. Check matching units and nonzero denominators."),{status:422,code:"INVALID_CALCULATION"});
    if(error.code==="CALCULATION_MODE_REQUIRED")throw Object.assign(new Error("Choose a saved Calculation plan."),{status:422,code:"INVALID_CALCULATION"});
    if(error.code==="INVALID_SCOPE")throw Object.assign(new Error("Calculation input exceeds the supported decimal, reference or precision bounds."),{status:422,code:"INVALID_CALCULATION"});
    if(error.code==="NOT_FOUND")throw Object.assign(new Error("The saved Calculation plan is unavailable."),{status:404,code:"NOT_FOUND"});
    if(error.code==="TENANT_QUOTA_EXCEEDED")throw Object.assign(new Error("The stored calculation limit has been reached. No new result was saved."),{status:429,code:"TENANT_QUOTA_EXCEEDED"});
    throw error;
  }
  if(creating ? !confirmed(result,args,plan) || JSON.stringify(validateCalculation(result.input))!==JSON.stringify(input)
    : !result || !Array.isArray(result.items) || result.items.length>100 || result.items.some(item=>!confirmed(item,args,plan)))
    throw Object.assign(new Error("Stored calculation could not be confirmed. Refresh before retrying."),{status:503,code:"PERSISTENCE_UNCONFIRMED"});
  return json(request,env,result,creating?201:200);
}
