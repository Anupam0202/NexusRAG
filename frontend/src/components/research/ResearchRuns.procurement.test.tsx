import {fireEvent,render,screen,waitFor} from "@testing-library/react";
import {beforeEach,expect,it,vi} from "vitest";
import {emptyResearchPlan,modeLimits,type ResearchPlanRecord} from "@/lib/research-plan";
const api=vi.hoisted(()=>({listResearchRuns:vi.fn(),researchRunCommand:vi.fn()}));
vi.mock("@/lib/api",()=>api);
import {ResearchRuns} from "./ResearchRuns";
const id="11111111-1111-4111-8111-111111111111";
const plan:ResearchPlanRecord={id,workspace_id:id,owner_id:id,
  plan:{...emptyResearchPlan(),mode:"PROCUREMENT_RESEARCH",question:"Review synthetic notices",subquestions:Array.from({length:10},(_,i)=>`Review criterion ${i+1}`),
    private_source_ids:Array.from({length:50},(_,i)=>`10000000-0000-4000-8000-${String(i+1).padStart(12,"0")}`),completion_criteria:["Review source-worded values,dates and qualifications"]},
  limits:modeLimits.PROCUREMENT_RESEARCH,state:"planned",created_at:"2026-10-25T00:00:00Z",schema_version:"research-plan/1",persistence_state:"PERSISTED",execution_supported:false};
const run={id,plan_id:id,workspace_id:id,owner_id:id,mode:"PROCUREMENT_RESEARCH",state:"queued",generation:1,position:0,
  questions:[plan.plan.question,...plan.plan.subquestions],results:[],source_state:"CURRENT",error_code:null,total_steps:11,created_at:"2026-10-25T00:00:00Z"};
beforeEach(()=>{vi.clearAllMocks();api.listResearchRuns.mockResolvedValue({items:[],next_after:null});api.researchRunCommand.mockResolvedValue(run);});
it("starts the saved fifty-source eleven-question scope with an explicit Procurement mode",async()=>{
  render(<ResearchRuns plan={plan} workspaceId={id} userId={id} canWrite/>);
  await waitFor(()=>expect(screen.getByRole("button",{name:"Refresh executions"})).toBeEnabled());
  const start=screen.getByRole("button",{name:"Start research"});expect(start).toBeDisabled();fireEvent.click(screen.getByRole("checkbox"));fireEvent.click(start);
  await waitFor(()=>expect(api.researchRunCommand).toHaveBeenCalledTimes(1));
  expect(api.researchRunCommand.mock.calls[0][5]).toBe("PROCUREMENT_RESEARCH");
  expect(plan.plan.private_source_ids).toHaveLength(50);expect(plan.plan.subquestions).toHaveLength(10);
  expect(screen.getByRole("status")).toHaveTextContent("0 of 11 questions saved");
});
it("leaves a missing hosted contract visible without reporting a saved or running execution",async()=>{
  api.researchRunCommand.mockRejectedValue(new Error("Procurement migration is required."));
  render(<ResearchRuns plan={plan} workspaceId={id} userId={id} canWrite/>);
  await waitFor(()=>expect(screen.getByRole("button",{name:"Refresh executions"})).toBeEnabled());
  fireEvent.click(screen.getByRole("checkbox"));fireEvent.click(screen.getByRole("button",{name:"Start research"}));
  expect(await screen.findByRole("alert")).toHaveTextContent("migration is required");
  expect(screen.getByText("No executions",{exact:true})).toBeVisible();expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
});
