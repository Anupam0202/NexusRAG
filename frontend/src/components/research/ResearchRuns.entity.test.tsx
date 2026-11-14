import { fireEvent,render,screen,waitFor } from "@testing-library/react";
import { beforeEach,expect,it,vi } from "vitest";
import { emptyResearchPlan,modeLimits,type ResearchPlanRecord } from "@/lib/research-plan";
const api=vi.hoisted(()=>({listResearchRuns:vi.fn(),researchRunCommand:vi.fn()}));
vi.mock("@/lib/api",()=>api);
import { ResearchRuns } from "./ResearchRuns";

const id="11111111-1111-4111-8111-111111111111";
const plan:ResearchPlanRecord={id,workspace_id:id,owner_id:id,
  plan:{...emptyResearchPlan(),mode:"ENTITY_INVESTIGATION",question:"What does the synthetic registry actually report about Example Works?",
    private_source_ids:[id],entity_scope:["Example Works"],completion_criteria:["Inspect exact identifiers and explicit relationships; review uncertain matches."]},
  limits:modeLimits.ENTITY_INVESTIGATION,state:"planned",created_at:"2026-10-21T00:00:00Z",schema_version:"research-plan/1",persistence_state:"PERSISTED",execution_supported:false};
const run={id,plan_id:id,workspace_id:id,owner_id:id,mode:"ENTITY_INVESTIGATION",state:"queued",generation:1,position:0,
  questions:[plan.plan.question],results:[],source_state:"CURRENT",error_code:null,created_at:"2026-10-21T00:00:00Z"};
beforeEach(()=>{vi.clearAllMocks();api.listResearchRuns.mockResolvedValue({items:[],next_after:null});api.researchRunCommand.mockResolvedValue(run);});

it("starts the explicitly confirmed selected-source Entity Investigation without discarding its saved entity scope",async()=>{
  render(<ResearchRuns plan={plan} workspaceId={id} userId={id} canWrite/>);
  await waitFor(()=>expect(screen.getByRole("button",{name:"Refresh executions"})).toBeEnabled());
  const start=screen.getByRole("button",{name:/^Start research$/});
  expect(start).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox"));
  expect(start).toBeEnabled();fireEvent.click(start);
  await waitFor(()=>expect(api.researchRunCommand).toHaveBeenCalledTimes(1));
  expect(api.researchRunCommand.mock.calls[0][0]).toBe(plan.id);
  expect(api.researchRunCommand.mock.calls[0][5]).toBe("ENTITY_INVESTIGATION");
  expect(plan.plan.entity_scope).toEqual(["Example Works"]);
  expect(screen.getByRole("status")).toHaveTextContent("Execution queued");
});
