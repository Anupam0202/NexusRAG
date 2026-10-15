import {fireEvent,render,screen,waitFor} from "@testing-library/react";
import {expect,it,vi} from "vitest";
vi.mock("@/lib/api",()=>({listResearchCalculations:vi.fn(async()=>({items:[]})),listResearchAggregations:vi.fn(async()=>({items:[],next_after:null})),listResearchConversions:vi.fn(async()=>({items:[],next_after:null})),createResearchCalculation:vi.fn(),createResearchAggregation:vi.fn(),createResearchConversion:vi.fn()}));
import {CalculationTools} from "./CalculationTools";
it("keeps unsaved pair and series inputs while switching calculation type",async()=>{
  render(<CalculationTools planId="plan-a" workspaceId="workspace-a" userId="user-a" canWrite/>);
  await waitFor(()=>expect(screen.getByLabelText("Left value")).toBeEnabled());
  fireEvent.change(screen.getByLabelText("Left value"),{target:{value:"123.45"}});fireEvent.click(screen.getByRole("radio",{name:/^Series$/}));
  await waitFor(()=>expect(screen.getByLabelText("Series value 1")).toBeEnabled());fireEvent.change(screen.getByLabelText("Series value 1"),{target:{value:"0.1"}});
  fireEvent.click(screen.getByRole("radio",{name:/^Pair$/}));expect(screen.getByLabelText("Left value")).toBeVisible();expect(screen.getByLabelText("Left value")).toHaveValue("123.45");
  expect(screen.getByLabelText("Series value 1")).not.toBeVisible();fireEvent.click(screen.getByRole("radio",{name:/^Series$/}));expect(screen.getByLabelText("Series value 1")).toHaveValue("0.1");
  fireEvent.click(screen.getByRole("radio",{name:/^Convert$/}));fireEvent.change(screen.getByLabelText("Supplied factor"),{target:{value:"1000"}});
  fireEvent.click(screen.getByRole("radio",{name:/^Series$/}));fireEvent.click(screen.getByRole("radio",{name:/^Convert$/}));expect(screen.getByLabelText("Supplied factor")).toHaveValue("1000");
});
