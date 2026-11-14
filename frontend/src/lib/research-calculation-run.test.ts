import {describe,expect,it} from "vitest";
import {calculationRunFixture} from "../../../tests/fixtures/research-calculation-run-data.mjs";
import {calculationRunResult,calculationRunWork} from "../../../apps/gateway/src/research-calculation-runs.js";
import {confirmedResearchRun,type ResearchRun,type ResearchRunResult} from "./research-run";
import {confirmedCalculationRun,type ResearchCalculationRun} from "./research-calculation-run";

// The step exactly as the gateway builds it, so the two cannot drift apart unnoticed.
function stored() {
  const {documents,sources,run,wire}=calculationRunFixture();
  const built=calculationRunResult(calculationRunWork({...run,position:0}),documents,sources,{answer:JSON.stringify(wire)});
  const result={question:run.questions[0],answer:built.checked.answer,claim_state:built.checked.claim_state,abstained:built.checked.abstained,
    sources:built.sources,validated_citation_ids:built.checked.citations.map((i:number)=>`S${i}`),model:"synthetic",
    coverage:{completeness:"NOT_EXHAUSTIVE",chunks_considered:2},provider_cost_status:"UNKNOWN",
    review_state:"COMPLETION_CRITERIA_NOT_AUTOMATICALLY_VERIFIED",calculation:built.analysis as ResearchCalculationRun} as ResearchRunResult;
  return {run:{...run,results:[result]} as ResearchRun,result};
}
const analysis=(result:ResearchRunResult)=>result.calculation!;

describe("a stored calculation step",()=>{
  it("is confirmed as the gateway builds it",()=>{
    const {run,result}=stored();
    expect(analysis(result).calculations.map(c=>[c.state,c.result?.value])).toEqual([["CALCULATED","12.23"],["CALCULATED","10.288"],["NOT_CALCULATED",undefined]]);
    expect(confirmedCalculationRun(result,0,run)).toBe(true);
    expect(confirmedResearchRun(run,run.plan_id)).toBe(true);
  });

  it.each<[string,(run:ResearchRun,result:ResearchRunResult)=>void]>([
    ["a quote that is not in its passage",(_,r)=>{analysis(r).quantities[0].quote="Revenue in fiscal 2024 was EUR 1,234.5 million";}],
    ["a figure that is not where the step says",(_,r)=>{analysis(r).quantities[0].value_start+=1;analysis(r).quantities[0].value_end+=1;}],
    ["a figure whose decimal differs from its wording",(_,r)=>{analysis(r).quantities[0].value="1234.6";}],
    ["a unit that is not the passage's wording",(_,r)=>{analysis(r).quantities[0].unit="USD million";}],
    ["a unit piece over the figure",(_,r)=>{analysis(r).quantities[0].unit_spans=[[analysis(r).quantities[0].value_start,analysis(r).quantities[0].value_end]];}],
    ["a period the passage does not state",(_,r)=>{analysis(r).quantities[0].period="fiscal 2024";}],
    ["the same figure twice",(_,r)=>{analysis(r).quantities.push({...analysis(r).quantities[0],quantity_id:"Q4"});}],
    ["a formula that is not the inputs'",(_,r)=>{analysis(r).calculations[0].result!.formula="((1234.5-1100)/1100)*100";}],
    ["a result unit that is not the inputs'",(_,r)=>{analysis(r).calculations[1].result!.unit="EUR million";}],
    ["a result with the wrong number of decimals",(_,r)=>{analysis(r).calculations[0].result!.value="12.2";}],
    ["a result where the units differ",(_,r)=>{Object.assign(analysis(r).calculations[2],{state:"CALCULATED",reason:null,result:{...analysis(r).calculations[1].result!,operation:"ADD"}});}],
    ["an input that is not the figures'",(_,r)=>{analysis(r).calculations[0].input.left.value="1100";}],
    ["a step answering without a computed result",(_,r)=>{analysis(r).calculations=analysis(r).calculations.slice(2);}],
    ["a step that claims to abstain",(_,r)=>{r.abstained=true;r.claim_state="UNSUPPORTED";}],
    ["a passage no figure is quoted from",(_,r)=>{r.sources.push({...r.sources[1],citation_id:"S3"});r.validated_citation_ids.push("S3");}],
    ["an unknown reason for setting a proposal aside",(_,r)=>{analysis(r).rejections[0].reason="GUESSED";}],
    ["a document read out of order",(_,r)=>{analysis(r).documents.reverse();}],
  ])("is refused with %s",(_name,change)=>{
    const {run,result}=stored();change(run,result);
    expect(confirmedCalculationRun(result,0,run)&&confirmedResearchRun(run,run.plan_id)).toBe(false);
  });

  it("belongs to a run of at most seven questions over at most thirty documents",()=>{
    const {run}=stored();
    for(const changed of [{questions:Array(8).fill(run.questions[0]),total_steps:8},{requested_calculations:[" "]},{requested_calculations:undefined},
      {source_snapshot:[...run.source_snapshot!,...Array.from({length:29},(_,i)=>({...run.source_snapshot![0],document_id:`ca1c0000-0000-4000-8100-${String(i+10).padStart(12,"0")}`}))]}])
      expect(confirmedResearchRun({...run,...changed} as ResearchRun,run.plan_id)).toBe(false);
    expect(confirmedResearchRun({...run,results:[],results_included:false},run.plan_id)).toBe(true);
  });
});
