import {fireEvent,render,screen,within} from "@testing-library/react";
import {expect,it} from "vitest";
import {calculationRunFixture} from "../../../../tests/fixtures/research-calculation-run-data.mjs";
import {calculationRunResult,calculationRunWork} from "../../../../apps/gateway/src/research-calculation-runs.js";
import type {ResearchCalculationRun} from "@/lib/research-calculation-run";
import {CalculationRunResults} from "./CalculationRunResults";

function fixture(wireChange?:(wire:ReturnType<typeof calculationRunFixture>["wire"])=>void):ResearchCalculationRun {
  const {documents,sources,run,wire}=calculationRunFixture();wireChange?.(wire);
  return calculationRunResult(calculationRunWork({...run,position:0}),documents,sources,{answer:JSON.stringify(wire)}).analysis as ResearchCalculationRun;
}

it("shows each result with its formula, and each figure in its passage with the number, unit and period marked",()=>{
  const view=render(<CalculationRunResults analysis={fixture()} sourcePrefix="result"/>);
  const report=screen.getByRole("region",{name:"Calculations"});
  expect(report).toHaveTextContent("2 of 3 calculations computed / check every figure against its source");
  expect(screen.getByText("((1234.5-1100.0)/1100.0)*100 = 12.23",{exact:true})).toBeVisible();
  expect(screen.getByText("1234.5/120 = 10.288",{exact:true})).toBeVisible();
  expect(screen.getByText(/Not calculated: the units differ \(EUR million; people\), and figures are never converted/)).toBeVisible();
  const items=report.querySelectorAll("ol > li");expect(items).toHaveLength(3);
  const growth=within(items[0] as HTMLElement);
  expect(growth.getByText("Percent change / 2 decimal places, rounded half to even",{exact:true})).toBeVisible();
  expect([...items[0].querySelectorAll("mark")].map(mark=>mark.textContent)).toEqual(["1,100.0","1,234.5"]);
  expect([...items[0].querySelectorAll("u")].map(unit=>unit.textContent)).toEqual(["EUR","million","EUR","million"]);
  expect([...items[0].querySelectorAll("em")].map(period=>period.textContent)).toEqual(["fiscal 2022","fiscal 2023"]);
  expect(growth.getAllByRole("link",{name:"[S1]"})[0]).toHaveAttribute("href","#result-S1");
  expect(within(items[1] as HTMLElement).getByText("The passage does not say which period this figure is for.",{exact:true})).toBeVisible();
  fireEvent.click(screen.getByText("1 proposal set aside",{exact:true}));
  expect(screen.getByText("A proposed number is not written, as a whole number, in its passage.",{exact:true})).toBeVisible();
  fireEvent.click(screen.getByText("Documents read (2)",{exact:true}));
  expect(screen.getByText("Synthetic headcount.txt",{exact:true})).toBeVisible();
  expect(view.container.textContent).toContain("Figures quoted from it / 1 passage read");
});

it("says plainly when nothing could be calculated",()=>{
  const view=render(<CalculationRunResults analysis={fixture(wire=>{wire.calculations=[];})}/>);
  expect(screen.getByText("Figures were found, but no calculation was proposed from them.",{exact:true})).toBeVisible();
  expect(screen.getByText("Other figures found",{exact:true})).toBeVisible();
  view.unmount();
  render(<CalculationRunResults analysis={fixture(wire=>{wire.calculations=[];wire.quantities=[];})}/>);
  expect(screen.getByText(/does not show that the documents do not contain them/)).toBeVisible();
  expect(screen.getByText("0 of 0 calculations computed / check every figure against its source",{exact:true})).toBeVisible();
});
