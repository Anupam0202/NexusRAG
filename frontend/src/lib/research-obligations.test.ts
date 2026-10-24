import { expect,it,vi } from "vitest";
import { obligationFixture } from "@/test/obligation-fixture";
import { confirmedResearchRun } from "./research-run";
import {obligationCapacity} from "../../../tests/fixtures/research-obligation-capacity.mjs";
import {obligationResult,obligationWork} from "../../../apps/gateway/src/research-obligations.js";
import {confirmedObligations} from "./research-obligations";
it("converts each original excerpt to Unicode codepoints once per maximum result, not once per repeated anchor",()=>{
  const fixture=obligationCapacity(),run=obligationFixture();run.source_snapshot=fixture.run.source_snapshot;
  type Source=(typeof run.results)[number]["sources"][number];
  const built=obligationResult(obligationWork(fixture.run),fixture.documents,fixture.sources,{answer:JSON.stringify({candidates:fixture.candidates})});
  const result={...run.results[0],sources:built.sources,obligations:built.analysis,validated_citation_ids:built.sources.map((source:Source)=>source.citation_id)} as typeof run.results[0];
  const conversion=vi.spyOn(Array,"from");
  try {
    expect(confirmedObligations(result,0,run)).toBe(true);
    const sourceConversions=conversion.mock.calls.filter(([value])=>built.sources.some((source:Source)=>source.content===value));
    expect(sourceConversions.length).toBeLessThanOrEqual(50);
  }finally{conversion.mockRestore();}
});
it("confirms literal obligation fields, their definitions, nullable original pages and review-required state",()=>{
  const run=obligationFixture();expect(confirmedResearchRun(run,run.plan_id)).toBe(true);
  expect(run.results[0].obligations!.candidates[0].provision.quote_start).toBe(2);
});
it("accepts the whole50source11question queue without lowering the adopted mode bounds",()=>{
  const run=obligationFixture();run.state="queued";run.position=0;run.results=[];run.questions=Array(11).fill("Which synthetic duty?");run.total_steps=11;
  run.source_snapshot=Array.from({length:50},(_,i)=>({...run.source_snapshot![0],document_id:`20000000-0000-4000-8000-${String(i).padStart(12,"0")}`}));
  expect(confirmedResearchRun(run,run.plan_id)).toBe(true);
  run.source_snapshot.push({...run.source_snapshot[0],document_id:"20000000-0000-4000-8000-999999999999"});expect(confirmedResearchRun(run,run.plan_id)).toBe(false);
});
it("rejects missing analysis or interpretations that pretend the register establishes legal compliance",()=>{
  const run=obligationFixture();delete run.results[0].obligations;expect(confirmedResearchRun(run,run.plan_id)).toBe(false);
  const changed=obligationFixture();Object.assign(changed.results[0].obligations!,{interpretation:"AUTOMATIC_COMPLIANCE"});expect(confirmedResearchRun(changed,changed.plan_id)).toBe(false);
});
it("does not confirm paraphrases or broken Unicode offsets as exact source quotations",()=>{
  for(const mutate of [()=>({quote:"Operators should retain everything"}),()=>({quote_start:3}),()=>({document_id:"10000000-0000-4000-8000-999999999999"})]){
    const run=obligationFixture();Object.assign(run.results[0].obligations!.candidates[0].exceptions[0],mutate());expect(confirmedResearchRun(run,run.plan_id)).toBe(false);
  }
});
it("requires every quoted definition source to remain in the consulted receipt and citation set",()=>{
  const run=obligationFixture();run.results[0].obligations!.documents[1].consulted_sources=[];expect(confirmedResearchRun(run,run.plan_id)).toBe(false);
  const changed=obligationFixture();changed.results[0].validated_citation_ids.pop();expect(confirmedResearchRun(changed,changed.plan_id)).toBe(false);
});
it("keeps missing jurisdiction distinct from an automatic applicability decision",()=>{
  const run=obligationFixture();expect(run.results[0].obligations!.candidates[0].jurisdiction).toBeNull();
  Object.assign(run.results[0].obligations!.candidates[0],{applicability_state:"APPLIES"});expect(confirmedResearchRun(run,run.plan_id)).toBe(false);
});
it("reopens actual maximum-field Unicode obligations across50sources and all11saved questions",()=>{
  const fixture=obligationCapacity(),run=obligationFixture(),template=run.results[0];
  run.questions=fixture.run.questions;run.source_snapshot=fixture.run.source_snapshot;run.total_steps=11;run.position=11;
  run.results=run.questions.map((question,index)=>{
    const built=obligationResult(obligationWork({...fixture.run,position:index}),fixture.documents,fixture.sources,{answer:JSON.stringify({candidates:fixture.candidates})});
    expect(built.analysis.candidates).toHaveLength(12);expect(built.sources).toHaveLength(50);
    return {...template,question,answer:built.checked.answer,sources:built.sources,validated_citation_ids:built.sources.map((source:typeof template.sources[number])=>source.citation_id),
      obligations:built.analysis} as typeof template;
  });
  expect(run.results[0].answer.length).toBeGreaterThan(16000);
  expect(Array.from(run.results[0].answer).length).toBeLessThanOrEqual(16000);
  expect(confirmedResearchRun(run,run.plan_id)).toBe(true);
  run.results[0].answer="\u{1f4ca}".repeat(16001);expect(confirmedResearchRun(run,run.plan_id)).toBe(false);
});
