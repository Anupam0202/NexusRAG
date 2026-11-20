import {fireEvent,render,screen,waitFor} from "@testing-library/react";
import {beforeEach,expect,it,vi} from "vitest";
import {emptyResearchPlan,modeLimits,type ResearchPlanRecord} from "@/lib/research-plan";
const api=vi.hoisted(()=>({listResearchRuns:vi.fn(),researchRunCommand:vi.fn()}));
vi.mock("@/lib/api",()=>api);
import {ResearchRuns} from "./ResearchRuns";

const id="11111111-1111-4111-8111-111111111111";
const subject={product_id:"P-42",product_name:"Synthetic sensor",product_version:"2.1",supplier:"Example Components"};
const plan:ResearchPlanRecord={id,workspace_id:id,owner_id:id,
  plan:{...emptyResearchPlan(),mode:"PRODUCT_PASSPORT",question:"Inspect qualified product evidence",passport_subject:subject,
    subquestions:Array.from({length:12},(_,i)=>`Review synthetic product criterion ${i+1}`),
    private_source_ids:Array.from({length:60},(_,i)=>`10000000-0000-4000-8000-${String(i+1).padStart(12,"0")}`),
    completion_criteria:["Independently review product version,source wording and qualifications"]},
  limits:modeLimits.PRODUCT_PASSPORT,state:"planned",created_at:"2026-10-24T11:00:00Z",schema_version:"research-plan/1",persistence_state:"PERSISTED",execution_supported:false};
const run={id,plan_id:id,workspace_id:id,owner_id:id,mode:"PRODUCT_PASSPORT",passport_subject:subject,state:"queued",generation:1,position:0,
  questions:[plan.plan.question,...plan.plan.subquestions],results:[],source_state:"CURRENT",error_code:null,total_steps:13,created_at:"2026-10-24T11:00:00Z"};
beforeEach(()=>{vi.clearAllMocks();api.listResearchRuns.mockResolvedValue({items:[],next_after:null});api.researchRunCommand.mockResolvedValue(run);});
it("starts a confirmed product run without losing the declared version,sixty sources or twelve subquestions",async()=>{
  render(<ResearchRuns plan={plan} workspaceId={id} userId={id} canWrite/>);
  await waitFor(()=>expect(screen.getByRole("button",{name:"Refresh executions"})).toBeEnabled());
  const start=screen.getByRole("button",{name:/^Start research$/});expect(start).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox"));expect(start).toBeEnabled();fireEvent.click(start);
  await waitFor(()=>expect(api.researchRunCommand).toHaveBeenCalledTimes(1));
  expect(api.researchRunCommand.mock.calls[0][5]).toBe("PRODUCT_PASSPORT");
  expect(plan.plan.passport_subject).toEqual(subject);expect(plan.plan.private_source_ids).toHaveLength(60);
  expect(plan.plan.subquestions).toHaveLength(12);expect(screen.getByRole("status")).toHaveTextContent("0 of 13 questions saved");
});
it("keeps legacy drafts readable but does not execute without complete declared product fields",async()=>{
  render(<ResearchRuns plan={{...plan,plan:{...plan.plan,passport_subject:undefined}}} workspaceId={id} userId={id} canWrite/>);
  await waitFor(()=>expect(screen.getByRole("button",{name:"Refresh executions"})).toBeEnabled());
  fireEvent.click(screen.getByRole("checkbox"));expect(screen.getByRole("button",{name:/^Start research$/})).toBeDisabled();
  expect(screen.getByRole("status")).toHaveTextContent("no complete declared product");expect(api.researchRunCommand).not.toHaveBeenCalled();
});
it("provides ordinary viewer inspection without starting product processing",async()=>{
  render(<ResearchRuns plan={plan} workspaceId={id} userId={id} canWrite={false}/>);
  await waitFor(()=>expect(screen.getByRole("button",{name:"Refresh executions"})).toBeEnabled());
  expect(screen.getByRole("button",{name:/^Start research$/})).toBeDisabled();
  expect(screen.getByRole("checkbox")).toBeDisabled();expect(api.researchRunCommand).not.toHaveBeenCalled();
});
