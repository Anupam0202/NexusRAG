export const aggregationOperations=["SUM","COUNT","AVERAGE","MEDIAN","MINIMUM","MAXIMUM","WEIGHTED_AVERAGE","RANK","DESCRIPTIVE_STATISTICS"] as const;
export type AggregationOperation=(typeof aggregationOperations)[number];
export interface AggregateQuantity {value:string|null;unit:string;evidence_ids:string[];group?:string}
export interface AggregationInput {
  operation:AggregationOperation;values:AggregateQuantity[];weights:string[];precision:number;
  missing_value_treatment:"REJECT"|"EXCLUDE";grouped:boolean;
}
export interface AggregateRow {value:string;unit:string;key?:string;input_index?:number;position?:number;evidence_ids?:string[]}
export interface AggregateGroup {
  group:string|null;value:string|null;rows:AggregateRow[];unit:string;expression:string;evidence_ids:string[];
  total_count:number;included_count:number;excluded_count:number;excluded_input_indices:number[];
  value_display:"ROUND_HALF_EVEN"|"INPUT_VALUES_UNROUNDED";
}
export interface AggregationRecord {
  id:string;plan_id:string;workspace_id:string;owner_id:string;created_at:string;input:AggregationInput;
  result:{operation:AggregationOperation;groups:AggregateGroup[];precision:number;rounding:"ROUND_HALF_EVEN";missing_value_treatment:"REJECT"|"EXCLUDE"};
  schema_version:"research-aggregation/1";state:"calculated";persistence_state:"PERSISTED";input_evidence_state:"CALLER_ASSERTED_NOT_VERIFIED";
}
export function canonicalAggregationInput(input:AggregationInput):AggregationInput {
  return {operation:input.operation,values:input.values.map(q=>({value:q.value,unit:q.unit,evidence_ids:[...q.evidence_ids],...(input.grouped?{group:q.group}: {})})),
    weights:[...input.weights],precision:input.precision,missing_value_treatment:input.missing_value_treatment,grouped:input.grouped};
}
export function confirmedAggregation(value:unknown,planId:string):value is AggregationRecord {
  try {
    if(!value || typeof value!=="object")return false;
    const row=value as AggregationRecord,input=row.input,result=row.result;
    if(typeof row.id!=="string" || row.plan_id!==planId || row.schema_version!=="research-aggregation/1" || row.state!=="calculated" ||
      row.persistence_state!=="PERSISTED" || row.input_evidence_state!=="CALLER_ASSERTED_NOT_VERIFIED" || !input ||
      !aggregationOperations.includes(input.operation) || !Number.isInteger(input.precision) || input.precision<0 || input.precision>18 ||
      typeof input.grouped!=="boolean" || !["REJECT","EXCLUDE"].includes(input.missing_value_treatment) ||
      !Array.isArray(input.values) || !input.values.length || input.values.length>10000 || !Array.isArray(input.weights))return false;
    const text=(v:unknown,max:number):v is string=>typeof v==="string" && v.trim().length>0 && v.length<=max;
    const decimal=(v:unknown):v is string=>typeof v==="string" && v.length<=270 && /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d{1,3})?$/.test(v);
    const resultNumber=(v:unknown):v is string=>typeof v==="string" && v.length<=300 && /^-?\d+(\.\d+)?$/.test(v);
    const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
    if(input.values.some(q=>!q || !(decimal(q.value) || (q.value===null && input.missing_value_treatment==="EXCLUDE")) ||
      !text(q.unit,64) || !Array.isArray(q.evidence_ids) || !q.evidence_ids.length || q.evidence_ids.length>100 || q.evidence_ids.some(id=>!text(id,128)) ||
      (input.grouped?!text(q.group,128):Object.hasOwn(q,"group"))))return false;
    if(input.operation==="WEIGHTED_AVERAGE"?input.weights.length!==input.values.length || input.weights.some(w=>!decimal(w)):input.weights.length!==0)return false;
    if(!result || result.operation!==input.operation || result.precision!==input.precision || result.rounding!=="ROUND_HALF_EVEN" ||
      result.missing_value_treatment!==input.missing_value_treatment || !Array.isArray(result.groups) || !result.groups.length)return false;
    const names=[...new Set(input.values.map(q=>input.grouped?q.group:null))];
    if(names.length>100 || result.groups.length!==names.length || new Set(result.groups.map(g=>g.group)).size!==names.length)return false;
    return result.groups.every(g=>{
      if(!g || !names.includes(g.group))return false;
      const quantities=input.values.map((q,index)=>({...q,index})).filter(q=>!input.grouped || q.group===g.group);
      const included=quantities.filter(q=>q.value!==null),excluded=quantities.filter(q=>q.value===null).map(q=>q.index);
      const refs=[...new Set(included.flatMap(q=>q.evidence_ids))],byIndex=new Map(included.map(q=>[q.index,q]));
      if(!included.length || included.some(q=>q.unit!==included[0].unit) || g.total_count!==quantities.length || g.included_count!==included.length ||
        g.excluded_count!==excluded.length || !same(g.excluded_input_indices,excluded) || !same(g.evidence_ids,refs) ||
        g.unit!==(input.operation==="COUNT"?"":included[0].unit) || !text(g.expression,40000) || !Array.isArray(g.rows))return false;
      if(input.operation==="RANK")return g.value===null && g.value_display==="INPUT_VALUES_UNROUNDED" && g.rows.length===included.length &&
        new Set(g.rows.map(r=>r.input_index)).size===included.length && g.rows.every((r,index)=>{
          const source=byIndex.get(r.input_index as number);
          return !!source && r.position===index+1 && r.value===source.value && r.unit===source.unit && same(r.evidence_ids,source.evidence_ids);
        });
      if(g.value_display!=="ROUND_HALF_EVEN")return false;
      if(input.operation==="DESCRIPTIVE_STATISTICS")return g.value===null && g.rows.length===5 &&
        ["count","minimum","maximum","average","median"].every((key,index)=>g.rows[index].key===key && resultNumber(g.rows[index].value) &&
          g.rows[index].unit===(index===0?"":included[0].unit));
      return resultNumber(g.value) && g.rows.length===0;
    });
  }catch{return false;}
}
