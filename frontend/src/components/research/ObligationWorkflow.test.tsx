import { fireEvent,render,screen,waitFor } from "@testing-library/react";
import { beforeEach,expect,it,vi } from "vitest";
import { emptyResearchPlan,modeLimits,type ResearchPlanRecord } from "@/lib/research-plan";
import { obligationFixture } from "@/test/obligation-fixture";
const api=vi.hoisted(()=>({listResearchRuns:vi.fn(),researchRunCommand:vi.fn()}));
vi.mock("@/lib/api",()=>api);
import { ResearchRuns } from "./ResearchRuns";

const id="11111111-1111-4111-8111-111111111111";
const plan={id,workspace_id:id,owner_id:id,plan:{...emptyResearchPlan(),mode:"OBLIGATION_ANALYSIS",question:"Which synthetic duties need review?",
  private_source_ids:[id],completion_criteria:["Review each original clause and its exceptions."]},limits:modeLimits.OBLIGATION_ANALYSIS,
  state:"planned",schema_version:"research-plan/1",persistence_state:"PERSISTED",execution_supported:false} as ResearchPlanRecord;
beforeEach(()=>{vi.clearAllMocks();api.listResearchRuns.mockResolvedValue({items:[],next_after:null});});
it("offers an explicitly confirmed Obligation Analysis execution instead of a plan-only shell",async()=>{
  render(<ResearchRuns plan={plan} workspaceId={id} userId={id} canWrite/>);
  await waitFor(()=>expect(screen.getByRole("button",{name:"Refresh executions"})).toBeEnabled());
  const start=screen.getByRole("button",{name:"Start research"});
  expect(start).toBeDisabled();fireEvent.click(screen.getByRole("checkbox"));
  expect(start).toBeEnabled();fireEvent.click(start);
  await waitFor(()=>expect(api.researchRunCommand).toHaveBeenCalledTimes(1));
  expect(api.researchRunCommand.mock.calls[0][5]).toBe("OBLIGATION_ANALYSIS");
});
it("reopens persisted candidates and copies their exceptions, definitions and undetermined applicability",async()=>{
  const saved=obligationFixture(),writeText=vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText}});
  api.listResearchRuns.mockResolvedValue({items:[saved],next_after:null});api.researchRunCommand.mockResolvedValue(saved);
  render(<ResearchRuns plan={{...plan,id:saved.plan_id}} workspaceId={saved.workspace_id} userId={saved.owner_id} canWrite/>);
  fireEvent.click(await screen.findByRole("button",{name:`Open execution ${saved.id}`}));
  expect(await screen.findByText("except public summaries")).toBeVisible();
  expect(screen.queryByText(saved.results[0].answer)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button",{name:"Copy results"}));
  await waitFor(()=>expect(writeText).toHaveBeenCalledTimes(1));
  expect(writeText.mock.calls[0][0]).toContain('"exceptions"');expect(writeText.mock.calls[0][0]).toContain("except public summaries");
  expect(writeText.mock.calls[0][0]).toContain("A report is a synthetic retained record.");expect(writeText.mock.calls[0][0]).toContain("NOT_DETERMINED");
});
