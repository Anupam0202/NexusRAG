import {fireEvent,render,screen,waitFor} from "@testing-library/react";
import {beforeEach,expect,it,vi} from "vitest";
const api=vi.hoisted(()=>({createResearchConversion:vi.fn(),listResearchConversions:vi.fn()}));
vi.mock("@/lib/api",()=>api);
import {ConversionWorksheet} from "./ConversionWorksheet";
const props={planId:"plan-a",workspaceId:"workspace-a",userId:"user-a",canWrite:true};
const input={quantity:{value:"1.005",unit:"kg",evidence_ids:["a"]},factor:"1000",target_unit:"g",conversion_evidence_id:"factor-a",factor_effective_on:"2026-10-15",precision:2};
const row={id:"result-a",input,result:{value:"1005.00",unit:"g",formula:"1.005*1000",evidence_ids:["a","factor-a"],precision:2}};
beforeEach(()=>{vi.clearAllMocks();api.listResearchConversions.mockResolvedValue({items:[],next_after:null});api.createResearchConversion.mockResolvedValue(row);});
async function fill(){
  await waitFor(()=>expect(screen.getByRole("button",{name:"Convert and save"})).toBeEnabled());
  for(const [label,value] of [["Conversion value","1.005"],["Source unit","kg"],["Supplied factor","1000"],["Target unit","g"],["Factor evidence reference","factor-a"],["Factor effective date","2026-10-15"],["Conversion decimal places","2"],["Conversion evidence references","a"]])fireEvent.change(screen.getByLabelText(label),{target:{value}});
}
it("saves exact input/factor/date and copies without converting twice",async()=>{
  render(<ConversionWorksheet {...props}/>);await fill();fireEvent.click(screen.getByRole("button",{name:"Convert and save"}));
  expect(await screen.findByLabelText("Conversion result")).toHaveTextContent("1005.00 g");expect(api.createResearchConversion.mock.calls[0][1]).toEqual(input);
  expect(screen.getByRole("heading",{name:"Stored conversions"})).toHaveFocus();expect(screen.getByText("2026-10-15",{exact:true})).toBeVisible();
  fireEvent.click(screen.getByRole("button",{name:"Use conversion inputs"}));expect(screen.getByLabelText("Conversion value")).toHaveFocus();expect(screen.getByLabelText("Supplied factor")).toHaveValue("1000");expect(api.createResearchConversion).toHaveBeenCalledTimes(1);
});
it("retains source/factor input and retry identity after unconfirmed response",async()=>{
  api.createResearchConversion.mockRejectedValueOnce(new Error("Response unconfirmed"));render(<ConversionWorksheet {...props}/>);await fill();
  fireEvent.click(screen.getByRole("button",{name:"Convert and save"}));expect(await screen.findByRole("alert")).toHaveTextContent("unconfirmed");
  expect(screen.getByLabelText("Factor effective date")).toHaveValue("2026-10-15");expect(screen.queryByLabelText("Conversion result")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button",{name:"Convert and save"}));await screen.findByLabelText("Conversion result");expect(api.createResearchConversion.mock.calls[0][2]).toBe(api.createResearchConversion.mock.calls[1][2]);
});
it("reads stored conversions for ordinary read-only roles and follows the cursor",async()=>{
  api.listResearchConversions.mockResolvedValueOnce({items:[row],next_after:"next-a"}).mockResolvedValueOnce({items:[{...row,id:"result-b"}],next_after:null});
  render(<ConversionWorksheet {...props} canWrite={false}/>);await screen.findByLabelText("Conversion result");expect(screen.getByRole("button",{name:"Convert and save"})).toBeDisabled();
  fireEvent.click(screen.getByRole("button",{name:"Load more conversions"}));await waitFor(()=>expect(screen.getAllByLabelText("Conversion result")).toHaveLength(2));expect(api.listResearchConversions.mock.calls[1][2]).toBe("next-a");expect(api.createResearchConversion).not.toHaveBeenCalled();
});
