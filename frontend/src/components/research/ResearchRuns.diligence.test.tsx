import {fireEvent,render,screen,waitFor} from "@testing-library/react";
import {beforeEach,expect,it,vi} from "vitest";
import {emptyResearchPlan,modeLimits,type ResearchPlanRecord} from "@/lib/research-plan";
const api=vi.hoisted(()=>({listResearchRuns:vi.fn(),researchRunCommand:vi.fn()}));
vi.mock("@/lib/api",()=>api);
import {ResearchRuns} from "./ResearchRuns";

const id="11111111-1111-4111-8111-111111111111";
const sourceIds=Array.from({length:60},(_,i)=>`10000000-0000-4000-8000-${String(i+1).padStart(12,"0")}`);
const plan:ResearchPlanRecord={id,workspace_id:id,owner_id:id,
  plan:{...emptyResearchPlan(),mode:"DUE_DILIGENCE",question:"Which source assertions and unresolved evidence gaps require independent counterparty review?",
    subquestions:Array.from({length:12},(_,i)=>`Review synthetic source criterion ${i+1}.`),private_source_ids:sourceIds,
    entity_scope:["Example Components"],completion_criteria:["Inspect exact evidence,qualifications,contradictions and missing information;do not issue an eligibility decision."]},
  limits:modeLimits.DUE_DILIGENCE,state:"planned",created_at:"2026-10-21T14:00:00Z",schema_version:"research-plan/1",persistence_state:"PERSISTED",execution_supported:false};
const run={id,plan_id:id,workspace_id:id,owner_id:id,mode:"DUE_DILIGENCE",state:"queued",generation:1,position:0,
  questions:[plan.plan.question,...plan.plan.subquestions],results:[],source_state:"CURRENT",error_code:null,total_steps:13,created_at:"2026-10-21T14:00:00Z"};
beforeEach(()=>{vi.clearAllMocks();api.listResearchRuns.mockResolvedValue({items:[],next_after:null});api.researchRunCommand.mockResolvedValue(run);});

it("starts explicitly confirmed Due Diligence without discarding60sources,12subquestions or the subject scope",async()=>{
  render(<ResearchRuns plan={plan} workspaceId={id} userId={id} canWrite/>);
  await waitFor(()=>expect(screen.getByRole("button",{name:"Refresh executions"})).toBeEnabled());
  const start=screen.getByRole("button",{name:/^Start research$/});expect(start).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox"));expect(start).toBeEnabled();fireEvent.click(start);
  await waitFor(()=>expect(api.researchRunCommand).toHaveBeenCalledTimes(1));
  expect(api.researchRunCommand.mock.calls[0][0]).toBe(plan.id);expect(api.researchRunCommand.mock.calls[0][5]).toBe("DUE_DILIGENCE");
  expect(plan.plan.private_source_ids).toHaveLength(60);expect(plan.plan.subquestions).toHaveLength(12);
  expect(plan.plan.entity_scope).toEqual(["Example Components"]);
  expect(screen.getByRole("status")).toHaveTextContent("0 of 13 questions saved");
});
it("offers ordinary viewer inspection without a Due Diligence mutation",async()=>{
  render(<ResearchRuns plan={plan} workspaceId={id} userId={id} canWrite={false}/>);
  await waitFor(()=>expect(screen.getByRole("button",{name:"Refresh executions"})).toBeEnabled());
  expect(screen.getByRole("button",{name:/^Start research$/})).toBeDisabled();
  expect(screen.getByRole("checkbox")).toBeDisabled();expect(api.researchRunCommand).not.toHaveBeenCalled();
});
