export interface ConversionInput {
  quantity:{value:string;unit:string;evidence_ids:string[]};factor:string;target_unit:string;
  conversion_evidence_id:string;factor_effective_on:string|null;precision:number;
}
export interface ConversionRecord {
  id:string;plan_id:string;workspace_id:string;owner_id:string;created_at:string;input:ConversionInput;
  result:{operation:"CONVERT_UNIT";value:string;unit:string;formula:string;evidence_ids:string[];precision:number;rounding:"ROUND_HALF_EVEN"};
  schema_version:"research-conversion/1";state:"calculated";persistence_state:"PERSISTED";input_evidence_state:"CALLER_ASSERTED_NOT_VERIFIED";
}
export function canonicalConversionInput(input:ConversionInput):ConversionInput {
  return {quantity:{value:input.quantity.value,unit:input.quantity.unit,evidence_ids:[...input.quantity.evidence_ids]},factor:input.factor,
    target_unit:input.target_unit,conversion_evidence_id:input.conversion_evidence_id,factor_effective_on:input.factor_effective_on,precision:input.precision};
}
export function confirmedConversion(value:unknown,planId:string):value is ConversionRecord {
  try {
    if(!value || typeof value!=="object")return false;
    const row=value as ConversionRecord,input=row.input,r=row.result;
    const text=(value:unknown,max:number):value is string=>typeof value==="string" && !!value.trim() && value.length<=max;
    const decimal=(value:unknown):value is string=>typeof value==="string" && value.length<=270 && /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d{1,3})?$/.test(value);
    if(!text(row.id,128) || row.plan_id!==planId || row.schema_version!=="research-conversion/1" || row.state!=="calculated" ||
      row.persistence_state!=="PERSISTED" || row.input_evidence_state!=="CALLER_ASSERTED_NOT_VERIFIED" || !input?.quantity ||
      !decimal(input.quantity.value) || !text(input.quantity.unit,64) || !Array.isArray(input.quantity.evidence_ids) ||
      !input.quantity.evidence_ids.length || input.quantity.evidence_ids.length>100 || input.quantity.evidence_ids.some(id=>!text(id,128)) ||
      !decimal(input.factor) || input.factor.startsWith("-") || !/[1-9]/.test(input.factor.split(/[eE]/)[0]) ||
      !text(input.target_unit,64) || !text(input.conversion_evidence_id,128) || !Number.isInteger(input.precision) || input.precision<0 || input.precision>18)return false;
    const date=input.factor_effective_on;
    if(date!==null && (typeof date!=="string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date.startsWith("0000") ||
      !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10)!==date))return false;
    return !!r && r.operation==="CONVERT_UNIT" && typeof r.value==="string" && r.value.length<=300 && /^-?\d+(\.\d+)?$/.test(r.value) &&
      r.unit===input.target_unit && r.formula===`${input.quantity.value}*${input.factor}` && r.precision===input.precision && r.rounding==="ROUND_HALF_EVEN" &&
      JSON.stringify(r.evidence_ids)===JSON.stringify([...new Set([...input.quantity.evidence_ids,input.conversion_evidence_id])]);
  }catch{return false;}
}
