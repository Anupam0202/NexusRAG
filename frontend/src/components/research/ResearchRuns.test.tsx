import { fireEvent,render,screen,waitFor } from "@testing-library/react";
import { beforeEach,expect,it,vi } from "vitest";
import { emptyResearchPlan,modeLimits,type ResearchPlanRecord } from "@/lib/research-plan";
const api=vi.hoisted(()=>({listResearchRuns:vi.fn(),researchRunCommand:vi.fn()}));
vi.mock("@/lib/api",()=>api);
import { ResearchRuns } from "./ResearchRuns";
const id="11111111-1111-4111-8111-111111111111";
const plan={id,workspace_id:id,owner_id:id,plan:{...emptyResearchPlan(),question:"Synthetic mass?",private_source_ids:[id],completion_criteria:["Inspect source."]},limits:modeLimits.QUICK_LOOKUP,
  state:"planned",schema_version:"research-plan/1",persistence_state:"PERSISTED",execution_supported:false} as ResearchPlanRecord;
const run={id,plan_id:id,workspace_id:id,owner_id:id,state:"queued",generation:1,position:0,questions:[plan.plan.question],results:[],source_state:"CURRENT",error_code:null,
  created_at:"2026-10-15T00:00:00Z",dispatch_state:"PENDING_RECOVERY"};
beforeEach(()=>{vi.clearAllMocks();api.listResearchRuns.mockResolvedValue({items:[],next_after:null});api.researchRunCommand.mockResolvedValue(run);});
const props={plan,workspaceId:id,userId:id,canWrite:true};
it("requires confirmation and reuses a start key after an interrupted response",async()=>{
  api.researchRunCommand.mockRejectedValueOnce(new Error("Start unconfirmed")).mockResolvedValue(run);
  render(<ResearchRuns {...props}/>);
  const start=await screen.findByRole("button",{name:"Start research"});
  await waitFor(()=>expect(screen.getByRole("button",{name:"Refresh executions"})).toBeEnabled());
  expect(start).toBeDisabled();fireEvent.click(screen.getByRole("checkbox"));fireEvent.click(start);
  expect(await screen.findByRole("alert")).toHaveTextContent("unconfirmed");
  fireEvent.click(start);await screen.findByText(/queue dispatch was not confirmed/);
  expect(api.researchRunCommand.mock.calls[0][4]).toBe(api.researchRunCommand.mock.calls[1][4]);
  expect(start).toBeDisabled();
  fireEvent.click(screen.getByRole("button",{name:"Retry queued dispatch"}));
  await waitFor(()=>expect(api.researchRunCommand).toHaveBeenCalledTimes(3));
  expect(api.researchRunCommand.mock.calls[2][2]).toBe("resume");expect(api.researchRunCommand.mock.calls[2][3]).toBe(run.id);
});
it("refreshes a failed execution list without losing the stored plan",async()=>{
  api.listResearchRuns.mockRejectedValueOnce(new Error("List unavailable")).mockResolvedValue({items:[run],next_after:null});
  render(<ResearchRuns {...props}/>);
  await screen.findByRole("alert");fireEvent.click(screen.getByRole("button",{name:"Refresh executions"}));
  expect(await screen.findByRole("button",{name:`Open execution ${id}`})).toBeVisible();
});
it("ordinary viewer inspection never enables run mutations",async()=>{
  api.listResearchRuns.mockResolvedValue({items:[run],next_after:null});render(<ResearchRuns {...props} canWrite={false}/>);
  await screen.findByRole("button",{name:`Open execution ${id}`});
  expect(screen.getByRole("checkbox")).toBeDisabled();expect(screen.getByRole("button",{name:"Start research"})).toBeDisabled();
  expect(api.researchRunCommand).not.toHaveBeenCalled();
});
it("does not silently ignore date-constrained or unimplemented mode plans",async()=>{
  const view=render(<ResearchRuns {...props} plan={{...plan,plan:{...plan.plan,date_from:"2026-10-15"}}}/>);
  await screen.findByText(/constraints that execution cannot yet honor/);
  fireEvent.click(screen.getByRole("checkbox"));expect(screen.getByRole("button",{name:"Start research"})).toBeDisabled();
  view.unmount();render(<ResearchRuns {...props} plan={{...plan,plan:{...plan.plan,mode:"DEEP_RESEARCH"}}}/>);
  expect(await screen.findByText(/Execution is not implemented for this mode/)).toBeVisible();
  expect(screen.queryByRole("button",{name:"Start research"})).not.toBeInTheDocument();
});
