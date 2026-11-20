import { fireEvent,render,screen,waitFor } from "@testing-library/react";
import { beforeEach,expect,it,vi } from "vitest";
const api=vi.hoisted(()=>({createResearchCalculation:vi.fn(),listResearchCalculations:vi.fn()}));
vi.mock("@/lib/api",()=>api);
import { CalculationWorksheet } from "./CalculationWorksheet";
const props={planId:"plan-a",workspaceId:"workspace-a",userId:"user-a",canWrite:true};
const input={operation:"ADD",left:{value:"9007199254740993.1",unit:"USD",evidence_ids:["source-a"]},right:{value:"0.2",unit:"USD",evidence_ids:["source-b"]},precision:2};
const record={id:"saved-a",input,result:{value:"9007199254740993.30",unit:"USD",formula:"9007199254740993.1+0.2",evidence_ids:["source-a","source-b"],precision:2}};
beforeEach(()=>{vi.clearAllMocks();api.listResearchCalculations.mockResolvedValue({items:[]});api.createResearchCalculation.mockResolvedValue(record);});
async function fill() {
  await waitFor(()=>expect(screen.getByRole("button",{name:"Calculate and save"})).toBeEnabled());
  for(const [label,value] of [["Left value","9007199254740993.1"],["Right value","0.2"],["Left unit","USD"],["Right unit","USD"],
    ["Left evidence references","source-a"],["Right evidence references","source-b"],["Decimal places","2"]])fireEvent.change(screen.getByLabelText(label),{target:{value}});
}
it("executes and presents the confirmed decimal result, formula, references and review limitation",async()=>{
  render(<CalculationWorksheet {...props}/>);await fill();fireEvent.click(screen.getByRole("button",{name:"Calculate and save"}));
  expect(await screen.findByLabelText("Calculation result")).toHaveTextContent("9007199254740993.30 USD");
  expect(api.createResearchCalculation.mock.calls[0][1]).toEqual(input);
  expect(screen.getByText("9007199254740993.1+0.2")).toBeVisible();
  expect(screen.getByText(/caller-supplied, not verified/)).toBeVisible();
  expect(screen.getByRole("heading",{name:"Calculation worksheet"})).toHaveFocus();
});
it("retains input and retry key when execution response is unconfirmed, then shows only one saved record",async()=>{
  api.createResearchCalculation.mockRejectedValueOnce(new Error("Response not confirmed"));
  render(<CalculationWorksheet {...props}/>);await fill();fireEvent.click(screen.getByRole("button",{name:"Calculate and save"}));
  expect(await screen.findByRole("alert")).toHaveTextContent("not confirmed");
  expect(screen.getByLabelText("Left value")).toHaveValue(input.left.value);
  expect(screen.queryByLabelText("Calculation result")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button",{name:"Calculate and save"}));await screen.findByLabelText("Calculation result");
  expect(api.createResearchCalculation.mock.calls[0][2]).toBe(api.createResearchCalculation.mock.calls[1][2]);
  expect(screen.getAllByLabelText("Calculation result")).toHaveLength(1);
});
it("reloads stored calculations for an ordinary read-only role without offering execution",async()=>{
  api.listResearchCalculations.mockResolvedValue({items:[record]});render(<CalculationWorksheet {...props} canWrite={false}/>);
  await screen.findByLabelText("Calculation result");expect(screen.getByRole("button",{name:"Calculate and save"})).toBeDisabled();
  expect(api.createResearchCalculation).not.toHaveBeenCalled();
});
