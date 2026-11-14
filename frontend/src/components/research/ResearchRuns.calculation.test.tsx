import {fireEvent,render,screen,waitFor} from "@testing-library/react";
import {beforeEach,expect,it,vi} from "vitest";
import {emptyResearchPlan,modeLimits,type ResearchPlanRecord} from "@/lib/research-plan";
const api=vi.hoisted(()=>({listResearchRuns:vi.fn(),researchRunCommand:vi.fn()}));
vi.mock("@/lib/api",()=>api);
import {ResearchRuns} from "./ResearchRuns";
const id="11111111-1111-4111-8111-111111111111";
const plan=(changes:Partial<ResearchPlanRecord["plan"]>={}):ResearchPlanRecord=>({id,workspace_id:id,owner_id:id,
  plan:{...emptyResearchPlan(),mode:"CALCULATION",question:"By what percentage did revenue grow?",subquestions:["Revenue per person?"],
    private_source_ids:Array.from({length:30},(_,i)=>`10000000-0000-4000-8000-${String(i+1).padStart(12,"0")}`),
    expected_calculations:["Percent change in revenue from fiscal 2022 to fiscal 2023"],completion_criteria:["Every figure is checked against its passage"],...changes},
  limits:modeLimits.CALCULATION,state:"planned",created_at:"2026-11-14T00:00:00Z",schema_version:"research-plan/1",persistence_state:"PERSISTED",execution_supported:false});
const run={id,plan_id:id,workspace_id:id,owner_id:id,mode:"CALCULATION",state:"queued",generation:1,position:0,questions:["By what percentage did revenue grow?","Revenue per person?"],
  results:[],source_state:"CURRENT",error_code:null,total_steps:2,requested_calculations:["Percent change in revenue from fiscal 2022 to fiscal 2023"],created_at:"2026-11-14T00:00:00Z"};
beforeEach(()=>{vi.clearAllMocks();api.listResearchRuns.mockResolvedValue({items:[],next_after:null});api.researchRunCommand.mockResolvedValue(run);});

it("runs a Calculation plan, whose expected calculations guide the run",async()=>{
  render(<ResearchRuns plan={plan()} workspaceId={id} userId={id} canWrite/>);
  await waitFor(()=>expect(screen.getByRole("button",{name:"Refresh executions"})).toBeEnabled());
  expect(screen.queryByText(/Execution is not implemented/)).not.toBeInTheDocument();
  expect(screen.queryByText(/constraints that execution cannot yet honor/)).not.toBeInTheDocument();
  const start=screen.getByRole("button",{name:"Start research"});expect(start).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox"));fireEvent.click(start);
  await waitFor(()=>expect(api.researchRunCommand).toHaveBeenCalledTimes(1));
  expect(api.researchRunCommand.mock.calls[0][5]).toBe("CALCULATION");
  expect(screen.getByRole("status")).toHaveTextContent("0 of 2 questions saved");
});

it("still refuses a Calculation plan with dates it cannot honour",async()=>{
  render(<ResearchRuns plan={plan({date_from:"2023-01-01"})} workspaceId={id} userId={id} canWrite/>);
  await waitFor(()=>expect(screen.getByRole("button",{name:"Refresh executions"})).toBeEnabled());
  expect(screen.getByText(/constraints that execution cannot yet honor/)).toBeVisible();
  fireEvent.click(screen.getByRole("checkbox"));
  expect(screen.getByRole("button",{name:"Start research"})).toBeDisabled();
});

it("says what to review when a run finishes, and why a run stopped",async()=>{
  const finished={...run,state:"completed",position:2,results:[]};
  api.listResearchRuns.mockResolvedValue({items:[finished],next_after:null});api.researchRunCommand.mockResolvedValue(finished);
  const view=render(<ResearchRuns plan={plan()} workspaceId={id} userId={id} canWrite/>);
  fireEvent.click(await screen.findByRole("button",{name:`Open execution ${id}`}));
  const review=await screen.findByRole("region",{name:"Review this run"});
  expect(review).toHaveTextContent("Completion criteria still require review");
  expect(review).toHaveTextContent("Every figure is checked against its passage");
  expect(screen.getByRole("status")).toHaveTextContent("Execution finished / 2 of 2 questions saved");
  view.unmount();
  const stopped={...run,state:"interrupted",position:1,error_code:"RUN_DEADLINE",results:[]};
  api.listResearchRuns.mockResolvedValue({items:[stopped],next_after:null});api.researchRunCommand.mockResolvedValue(stopped);
  render(<ResearchRuns plan={plan()} workspaceId={id} userId={id} canWrite/>);
  fireEvent.click(await screen.findByRole("button",{name:`Open execution ${id}`}));
  expect(await screen.findByText(/Execution stopped: the time allowed for this run ran out \(RUN_DEADLINE\)\. Saved answers are kept; resume/)).toBeVisible();
  expect(screen.queryByRole("region",{name:"Review this run"})).not.toBeInTheDocument();
});
