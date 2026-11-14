import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { emptyResearchPlan, modeLimits } from "@/lib/research-plan";
const api=vi.hoisted(()=>({createResearchPlan:vi.fn(),listResearchPlans:vi.fn(),readResearchPlan:vi.fn(),getCurrentWorkspace:vi.fn(),listResearchRuns:vi.fn()}));
vi.mock("@/lib/api",()=>api);
vi.mock("@/hooks/useDocuments",()=>({useDocuments:()=>({documents:[],loading:false,error:null})}));
import {useStore} from "@/hooks/useStore";
import ResearchPage from "./page";
const subject={product_id:"synthetic-id",product_name:"Synthetic sensor",product_version:"2.1",supplier:"Synthetic supplier"};
const stored={id:"33333333-3333-4333-8333-333333333333",workspace_id:"workspace-a",owner_id:"user-a",
  plan:{...emptyResearchPlan(),mode:"PRODUCT_PASSPORT",question:"Inspect the supplied product evidence",completion_criteria:["Inspect exact sources"],passport_subject:subject},
  limits:modeLimits.PRODUCT_PASSPORT,state:"planned",schema_version:"research-plan/1",persistence_state:"PERSISTED",execution_supported:false};
beforeEach(()=>{
  vi.clearAllMocks();useStore.setState({authMode:"authenticated",authUser:{id:"user-a",email:null},workspaceId:"workspace-a"});
  api.getCurrentWorkspace.mockResolvedValue({role:"owner"});api.listResearchPlans.mockResolvedValue({items:[],next_after:null});
  api.listResearchRuns.mockResolvedValue({items:[],next_after:null});api.readResearchPlan.mockResolvedValue(stored);
  api.createResearchPlan.mockResolvedValue(stored);
});
async function fillSubject(){
  await waitFor(()=>expect(screen.getByRole("button",{name:"Save plan"})).toBeEnabled());
  fireEvent.change(screen.getByLabelText("Mode"),{target:{value:"PRODUCT_PASSPORT"}});
  for(const [label,value] of [["Product identifier",subject.product_id],["Product name",subject.product_name],["Product version",subject.product_version],["Supplier",subject.supplier]])
    fireEvent.change(screen.getByLabelText(label),{target:{value}});
  fireEvent.change(screen.getByLabelText("Question"),{target:{value:stored.plan.question}});
  fireEvent.change(screen.getByLabelText("Completion criteria"),{target:{value:"Inspect exact sources"}});
}
it("saves, inspects and copies a declared product/version/supplier without claiming verification",async()=>{
  render(<ResearchPage/>);await fillSubject();fireEvent.click(screen.getByRole("button",{name:"Save plan"}));
  await screen.findByText("Declared product");expect(api.createResearchPlan.mock.calls[0][0].passport_subject).toEqual(subject);
  expect(screen.getByText(subject.product_id)).toBeVisible();expect(screen.getByText(subject.product_version)).toBeVisible();
  fireEvent.click(screen.getByRole("button",{name:"Copy to a new plan"}));
  expect(screen.getByLabelText("Product name")).toHaveValue(subject.product_name);
  fireEvent.change(screen.getByLabelText("Product version"),{target:{value:"3.0"}});
  fireEvent.click(screen.getByRole("button",{name:"Save plan"}));await waitFor(()=>expect(api.createResearchPlan).toHaveBeenCalledTimes(2));
  expect(api.createResearchPlan.mock.calls[1][0].passport_subject.product_version).toBe("3.0");
  expect(stored.plan.passport_subject.product_version).toBe("2.1");
});
it("retains declared identity and the same retry intent after an unconfirmed save",async()=>{
  api.createResearchPlan.mockRejectedValueOnce(new Error("Save unconfirmed"));render(<ResearchPage/>);await fillSubject();
  fireEvent.click(screen.getByRole("button",{name:"Save plan"}));expect(await screen.findByRole("alert")).toHaveTextContent("Save unconfirmed");
  expect(screen.getByLabelText("Supplier")).toHaveValue(subject.supplier);fireEvent.click(screen.getByRole("button",{name:"Save plan"}));
  await screen.findByText("Declared product");expect(api.createResearchPlan.mock.calls[0][1]).toBe(api.createResearchPlan.mock.calls[1][1]);
});
it("keeps legacy drafts readable and supplies identity only when copying into a new passport plan",async()=>{
  const legacy={...stored,plan:{...stored.plan,passport_subject:undefined}};
  api.listResearchPlans.mockResolvedValue({items:[legacy],next_after:null});api.readResearchPlan.mockResolvedValue(legacy);
  render(<ResearchPage/>);fireEvent.click(await screen.findByRole("button",{name:`Open research plan: ${stored.plan.question}`}));
  await screen.findByText("Product identity not recorded");fireEvent.click(screen.getByRole("button",{name:"Copy to a new plan"}));
  expect(screen.getByLabelText("Product identifier")).toHaveValue("");
});
it("does not send leftover passport identity when switching to another mode",async()=>{
  render(<ResearchPage/>);await fillSubject();fireEvent.change(screen.getByLabelText("Mode"),{target:{value:"QUICK_LOOKUP"}});
  expect(screen.queryByLabelText("Product identifier")).not.toBeInTheDocument();fireEvent.click(screen.getByRole("button",{name:"Save plan"}));
  await waitFor(()=>expect(api.createResearchPlan).toHaveBeenCalled());expect(api.createResearchPlan.mock.calls[0][0]).not.toHaveProperty("passport_subject");
});
it("retains an over-limit declared field and reports it before starting a save",async()=>{
  render(<ResearchPage/>);await fillSubject();fireEvent.change(screen.getByLabelText("Product version"),{target:{value:"x".repeat(129)}});
  fireEvent.click(screen.getByRole("button",{name:"Save plan"}));
  expect(await screen.findByRole("alert")).toHaveTextContent("Product version is required and must contain at most 128 characters.");
  expect(api.createResearchPlan).not.toHaveBeenCalled();expect(screen.getByLabelText("Product version")).toHaveValue("x".repeat(129));
});
