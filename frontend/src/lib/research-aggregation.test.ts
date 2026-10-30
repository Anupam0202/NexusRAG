import {expect,it} from "vitest";
import {confirmedAggregation,type AggregationRecord} from "./research-aggregation";
const input={operation:"AVERAGE" as const,values:[{value:"0.1",unit:"USD",evidence_ids:["a"]},{value:"0.2",unit:"USD",evidence_ids:["b"]}],weights:[],precision:2,missing_value_treatment:"REJECT" as const,grouped:false};
const group={group:null,value:"0.15",rows:[],unit:"USD",expression:"average(0.1,0.2)",evidence_ids:["a","b"],total_count:2,included_count:2,excluded_count:0,excluded_input_indices:[],value_display:"ROUND_HALF_EVEN" as const};
export const aggregateFixture:AggregationRecord={id:"saved-a",plan_id:"plan-a",workspace_id:"workspace-a",owner_id:"user-a",created_at:"2026-10-15T00:00:00Z",input,
  result:{operation:"AVERAGE",groups:[group],precision:2,rounding:"ROUND_HALF_EVEN",missing_value_treatment:"REJECT"},schema_version:"research-aggregation/1",state:"calculated",persistence_state:"PERSISTED",input_evidence_state:"CALLER_ASSERTED_NOT_VERIFIED"};
it("confirms decimal text and complete input lineage without claiming evidence verification",()=>expect(confirmedAggregation(aggregateFixture,"plan-a")).toBe(true));
it.each([
  null,{}, {...aggregateFixture,plan_id:"other"},
  ...[{value:0.15},{unit:"kg"},{evidence_ids:["b","a"]},{excluded_input_indices:[0]},{total_count:3},{value_display:"INPUT_VALUES_UNROUNDED"},{rows:[{value:"0.15",unit:"USD"}]}]
    .map(change=>({...aggregateFixture,result:{...aggregateFixture.result,groups:[{...group,...change}]}})),
  {...aggregateFixture,result:{...aggregateFixture.result,groups:[group,group]}},
  {...aggregateFixture,input:{...input,weights:["1","1"]}},
  {...aggregateFixture,input:{...input,values:[{...input.values[0],value:"NaN"},input.values[1]]}},
])("rejects an incomplete stored aggregate %j",value=>expect(confirmedAggregation(value,"plan-a")).toBe(false));
it("requires every group, explicit excluded input indices and included-only references",()=>{
  const row=structuredClone(aggregateFixture);row.input.grouped=true;row.input.missing_value_treatment="EXCLUDE";row.result.missing_value_treatment="EXCLUDE";
  row.input.values=[{...input.values[0],group:"A"},{...input.values[1],value:null,group:"A"}];
  row.result.groups=[{...group,group:"A",value:"0.10",evidence_ids:["a"],included_count:1,excluded_count:1,excluded_input_indices:[1]}];
  expect(confirmedAggregation(row,"plan-a")).toBe(true);
  row.result.groups[0].evidence_ids.push("b");expect(confirmedAggregation(row,"plan-a")).toBe(false);
});
it("requires stable rank indices, positions, exact unrounded inputs and metric units",()=>{
  const row=structuredClone(aggregateFixture);row.input.operation="RANK";row.result.operation="RANK";
  row.result.groups=[{...group,value:null,value_display:"INPUT_VALUES_UNROUNDED",rows:[
    {input_index:1,position:1,value:"0.2",unit:"USD",evidence_ids:["b"]},{input_index:0,position:2,value:"0.1",unit:"USD",evidence_ids:["a"]}]}];
  expect(confirmedAggregation(row,"plan-a")).toBe(true);
  delete row.result.groups[0].rows[0].input_index;expect(confirmedAggregation(row,"plan-a")).toBe(false);
  row.input.operation="DESCRIPTIVE_STATISTICS";row.result.operation="DESCRIPTIVE_STATISTICS";
  row.result.groups=[{...group,value:null,rows:["count","minimum","maximum","average","median"].map((key,index)=>({key,value:index===0?"2":"0.15",unit:index===0?"":"USD"}))}];
  expect(confirmedAggregation(row,"plan-a")).toBe(true);row.result.groups[0].rows[0].unit="USD";expect(confirmedAggregation(row,"plan-a")).toBe(false);
});
