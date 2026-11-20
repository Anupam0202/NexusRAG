import {expect,it} from "vitest";
import {researchCopyRun} from "@/test/research-copy-fixtures";
import {reuseResearchRunResults} from "./research-run-reconcile";
import type {ResearchRun} from "./research-run";

it("reuses only exact saved result content while retaining fresh progress and run metadata",()=>{
  const previous=researchCopyRun("COMPARE"),next=structuredClone(previous);
  next.state="interrupted";next.error_code="PROVIDER_UNAVAILABLE";next.dispatch_state="PENDING_RECOVERY";
  const reconciled=reuseResearchRunResults(previous,next);
  expect(reconciled).toEqual(next);expect(reconciled).not.toBe(previous);
  expect(reconciled.results[0]).toBe(previous.results[0]);
  expect(reconciled.error_code).toBe("PROVIDER_UNAVAILABLE");
});

it("keeps new and changed results and removes results no longer present",()=>{
  const previous=researchCopyRun("COMPARE"),next=structuredClone(previous);
  previous.results.push(structuredClone(previous.results[0]));
  next.results[0].sources[0].content="A changed original must be rendered.";
  const changed=reuseResearchRunResults(previous,next);
  expect(changed.results).toHaveLength(1);expect(changed.results[0]).toBe(next.results[0]);
  const appended=structuredClone(next);appended.results.push(structuredClone(next.results[0]));
  const extended=reuseResearchRunResults(next,appended);
  expect(extended.results[0]).toBe(next.results[0]);expect(extended.results[1]).toBe(appended.results[1]);
});

it.each<[string,(run:ResearchRun)=>void]>([
  ["run",run=>{run.id="00000000-0000-4000-8000-000000000001";}],
  ["plan",run=>{run.plan_id="00000000-0000-4000-8000-000000000001";}],
  ["workspace",run=>{run.workspace_id="00000000-0000-4000-8000-000000000001";}],
  ["owner",run=>{run.owner_id="00000000-0000-4000-8000-000000000001";}],
  ["generation",run=>{run.generation++;}],
  ["mode",run=>{run.mode="EVIDENCE_ANSWER";}],
  ["questions",run=>{run.questions[0]="A different question";}],
  ["source version",run=>{run.source_snapshot![0].version_id="00000000-0000-4000-8000-000000000001";}],
  ["source generation",run=>{run.source_snapshot![0].index_generation="new-generation";}],
  ["source epoch",run=>{run.source_snapshot![0].lifecycle_epoch++;}],
  ["source availability",run=>{run.source_state="UNAVAILABLE_OR_CHANGED";run.results=[];}],
])("does not reuse results after the %s changes",(_name,change)=>{
  const previous=researchCopyRun("COMPARE"),next=structuredClone(previous);change(next);
  expect(reuseResearchRunResults(previous,next)).toBe(next);
});

it("does not restore references from previously unavailable evidence or a missing run",()=>{
  const next=researchCopyRun("COMPARE"),previous=structuredClone(next);previous.source_state="UNAVAILABLE_OR_CHANGED";
  expect(reuseResearchRunResults(previous,next)).toBe(next);
  expect(reuseResearchRunResults(null,next)).toBe(next);
});
