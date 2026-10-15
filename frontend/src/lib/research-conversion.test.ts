import {expect,it} from "vitest";
import {confirmedConversion} from "./research-conversion";
const input={quantity:{value:"1.005",unit:"kg",evidence_ids:["a"]},factor:"1000",target_unit:"g",conversion_evidence_id:"factor-a",factor_effective_on:"2026-10-15",precision:2};
const row={id:"result-a",plan_id:"plan-a",input,result:{operation:"CONVERT_UNIT",value:"1005.00",unit:"g",formula:"1.005*1000",evidence_ids:["a","factor-a"],precision:2,rounding:"ROUND_HALF_EVEN"},
  schema_version:"research-conversion/1",state:"calculated",persistence_state:"PERSISTED",input_evidence_state:"CALLER_ASSERTED_NOT_VERIFIED"};
it("confirms exact unit conversion lineage and an explicitly optional factor date",()=>{
  expect(confirmedConversion(row,"plan-a")).toBe(true);expect(confirmedConversion({...row,input:{...input,factor_effective_on:null}},"plan-a")).toBe(true);
});
it.each([null,{}, {...row,plan_id:"other"},{...row,persistence_state:"NOT_PERSISTED"},
  ...[{unit:"kg"},{value:1005},{formula:"model output"},{evidence_ids:["a"]},{precision:6}].map(change=>({...row,result:{...row.result,...change}})),
  ...[{factor:"0"},{factor:"-1"},{factor:"0e128"},{factor_effective_on:"2026-02-30"},{factor_effective_on:"0000-01-01"}].map(change=>({...row,input:{...input,...change}})),
])("rejects incomplete/undefined conversion receipts %j",value=>expect(confirmedConversion(value,"plan-a")).toBe(false));
