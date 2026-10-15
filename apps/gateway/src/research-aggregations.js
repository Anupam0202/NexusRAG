import { readBoundedJsonObject } from "./request-body.js";
import { workbenchContext } from "./workbench.js";

const UUID=/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const decimal=/^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d{1,3})?$/;
const resultNumber=/^-?\d+(\.\d+)?$/;
export const aggregationOperations=Object.freeze(["SUM","COUNT","AVERAGE","MEDIAN","MINIMUM","MAXIMUM","WEIGHTED_AVERAGE","RANK","DESCRIPTIVE_STATISTICS"]);
const invalid=message=>{throw Object.assign(new Error(message),{status:422,code:"INVALID_AGGREGATION"});};
function text(value,maximum,name){
  if(typeof value!=="string" || !value.trim() || value.length>maximum || value.includes("\0"))invalid(`${name} is required and must fit the documented input bound.`);
  return value.trim();
}
function number(value){if(typeof value!=="string" || value.length>270 || !decimal.test(value))invalid("Values and weights must be finite decimal text, not JSON numbers.");return value;}
export function validateAggregation(input){
  if(!input || typeof input!=="object" || Array.isArray(input) || !aggregationOperations.includes(input.operation) ||
    !Number.isInteger(input.precision) || input.precision<0 || input.precision>18 || typeof input.grouped!=="boolean" ||
    !["REJECT","EXCLUDE"].includes(input.missing_value_treatment) || !Array.isArray(input.values) || !input.values.length || input.values.length>10000)
    invalid("Choose an aggregate operation, 1 to 10,000 values, a missing-value policy and precision from 0 to 18.");
  const values=input.values.map(q=>{
    if(!q || !Array.isArray(q.evidence_ids) || !q.evidence_ids.length || q.evidence_ids.length>100)invalid("Each input requires bounded evidence references.");
    if(q.value===null && input.missing_value_treatment!=="EXCLUDE")invalid("Fill missing values or explicitly choose Exclude.");
    if(!input.grouped && Object.hasOwn(q,"group"))invalid("Enable grouping before supplying group labels.");
    return {value:q.value===null?null:number(q.value),unit:text(q.unit,64,"Unit"),evidence_ids:q.evidence_ids.map(id=>text(id,128,"Evidence reference")),
      ...(input.grouped?{group:text(q.group,128,"Group")}: {})};
  });
  const weights=input.weights??[];
  if(!Array.isArray(weights) || (input.operation==="WEIGHTED_AVERAGE"?weights.length!==values.length:weights.length!==0))invalid("Weights must align with every weighted-average input and be absent for other operations.");
  if(input.grouped && new Set(values.map(q=>q.group)).size>100)invalid("Split the input into at most 100 groups.");
  const command={operation:input.operation,values,weights:weights.map(number),precision:input.precision,missing_value_treatment:input.missing_value_treatment,grouped:input.grouped};
  if(new TextEncoder().encode(JSON.stringify(command,null,1)).length>40000)invalid("Formatted aggregate input exceeds the 40,000-byte stored worksheet limit. Split it into smaller worksheets.");
  return command;
}
function confirmed(record,args,plan){
  if(!record || !UUID.test(record.id||"") || record.plan_id!==plan || record.workspace_id!==args.workspace || record.owner_id!==args.user.id ||
    record.schema_version!=="research-aggregation/1" || record.state!=="calculated" || record.persistence_state!=="PERSISTED" ||
    record.input_evidence_state!=="CALLER_ASSERTED_NOT_VERIFIED")return false;
  try{
    const input=validateAggregation(record.input),result=record.result;
    if(!result || result.operation!==input.operation || result.precision!==input.precision || result.rounding!=="ROUND_HALF_EVEN" ||
      result.missing_value_treatment!==input.missing_value_treatment || !Array.isArray(result.groups) || !result.groups.length || result.groups.length>100)return false;
    const names=[...new Set(input.values.map(q=>input.grouped?q.group:null))];
    if(result.groups.length!==names.length || new Set(result.groups.map(g=>g.group)).size!==names.length)return false;
    return result.groups.every(g=>{
      if(!names.includes(g.group))return false;
      const quantities=input.values.map((q,index)=>({...q,index})).filter(q=>!input.grouped || q.group===g.group);
      const used=quantities.filter(q=>q.value!==null),excluded=quantities.filter(q=>q.value===null).map(q=>q.index);
      const refs=[...new Set(used.flatMap(q=>q.evidence_ids))];
      const byIndex=new Map(used.map(q=>[q.index,q]));
      if(!used.length || used.some(q=>q.unit!==used[0].unit) || g.total_count!==quantities.length || g.included_count!==used.length || g.excluded_count!==excluded.length ||
        JSON.stringify(g.evidence_ids)!==JSON.stringify(refs) || JSON.stringify(g.excluded_input_indices)!==JSON.stringify(excluded) ||
        g.unit!==(input.operation==="COUNT"?"":used[0].unit) || typeof g.expression!=="string" || !g.expression || g.expression.length>40000 || !Array.isArray(g.rows))return false;
      if(input.operation==="RANK")return g.value===null && g.value_display==="INPUT_VALUES_UNROUNDED" && g.rows.length===used.length &&
        new Set(g.rows.map(row=>row.input_index)).size===used.length && g.rows.every((row,index)=>{
          const source=byIndex.get(row.input_index);
          return !!source && row.position===index+1 && row.value===source.value && row.unit===source.unit && JSON.stringify(row.evidence_ids)===JSON.stringify(source.evidence_ids);
        });
      if(input.operation==="DESCRIPTIVE_STATISTICS")return g.value===null && g.value_display==="ROUND_HALF_EVEN" && g.rows.length===5 &&
        ["count","minimum","maximum","average","median"].every((key,index)=>g.rows[index].key===key && typeof g.rows[index].value==="string" &&
          g.rows[index].value.length<=300 && resultNumber.test(g.rows[index].value) && g.rows[index].unit===(index===0?"":used[0].unit));
      return typeof g.value==="string" && g.value.length<=300 && resultNumber.test(g.value) && g.rows.length===0 && g.value_display==="ROUND_HALF_EVEN";
    });
  }catch{return false;}
}
export async function handleResearchAggregations(args){
  const {request,env,member,serviceRequest,json}=args,url=new URL(request.url);
  const match=url.pathname.match(/^\/api\/v2\/research\/plans\/([0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12})\/aggregations$/i);
  if(!match)return null;
  const plan=match[1].toLowerCase(),creating=request.method==="POST";
  if(!creating && !["GET","HEAD"].includes(request.method))throw Object.assign(new Error("Aggregate worksheets support execution and reading saved results."),{status:405,code:"METHOD_NOT_ALLOWED"});
  if(creating && !["owner","admin","editor"].includes(member.role))throw Object.assign(new Error("Aggregate execution requires editor access."),{status:403,code:"FORBIDDEN"});
  const limit=Number(url.searchParams.get("limit")||20),after=url.searchParams.get("after");
  if(!Number.isInteger(limit) || limit<1 || limit>50 || (after && !UUID.test(after)))invalid("Choose a valid aggregate page.");
  const input=creating?validateAggregation(await readBoundedJsonObject(request)):null;
  const key=creating?text(request.headers.get("idempotency-key"),128,"Idempotency-Key"):null;
  let result;
  try{result=await serviceRequest(env,"rpc/nexus_research_aggregation",{method:"POST",body:JSON.stringify({p_context:await workbenchContext(args),
    p_operation:creating?"create":"list",p_plan_id:plan,p_input:input,p_key:key,p_limit:limit,p_after:after?.toLowerCase()||null})});}
  catch(error){
    if(error.code==="SOURCE_UNAVAILABLE" || error.code==="QUANTITY_MISMATCH")throw Object.assign(new Error("A captured source quantity changed, is unavailable or no longer matches the input. Refresh the source capture before calculating."),{status:409,code:error.code});
    if(["PGRST202","42883","42P01","42703"].includes(error.storageCode))throw Object.assign(new Error("Aggregate storage requires the reviewed research_aggregate_execution migration."),{status:503,code:"MIGRATION_REQUIRED"});
    if(["INVALID_SCOPE","CALCULATION_INVALID","CALCULATION_MODE_REQUIRED"].includes(error.code))invalid("Check the saved Calculation plan, decimal bounds, matching units, missing values and nonnegative weights. Each group needs at least one included value and positive total weight when weighted.");
    if(error.code==="NOT_FOUND")throw Object.assign(new Error("The saved Calculation plan is unavailable."),{status:404,code:"NOT_FOUND"});
    if(error.code==="TENANT_QUOTA_EXCEEDED")throw Object.assign(new Error("The stored calculation limit has been reached. No aggregate was saved."),{status:429,code:"TENANT_QUOTA_EXCEEDED"});
    throw error;
  }
  if(creating ? !confirmed(result,args,plan) || JSON.stringify(validateAggregation(result.input))!==JSON.stringify(input)
    : !result || !Array.isArray(result.items) || result.items.length>limit || result.items.some(item=>!confirmed(item,args,plan)) ||
      (result.next_after!==null && !UUID.test(result.next_after||"")))throw Object.assign(new Error("Stored aggregate result was not confirmed. Refresh before retrying."),{status:503,code:"PERSISTENCE_UNCONFIRMED"});
  return json(request,env,result,creating?201:200);
}
