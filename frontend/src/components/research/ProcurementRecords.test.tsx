import {fireEvent,render,screen,within} from "@testing-library/react";
import {expect,it} from "vitest";
import {procurementCapacity,procurementWire} from "../../../../tests/fixtures/research-procurement-data.mjs";
import {procurementWork,procurementResult} from "../../../../apps/gateway/src/research-procurement.js";
import type {ResearchProcurement} from "@/lib/research-procurement";
import {ProcurementRecords} from "./ProcurementRecords";

function fixture():ResearchProcurement {
  const data=procurementCapacity();
  return procurementResult(procurementWork(data.run),data.documents,data.sources,{answer:JSON.stringify(procurementWire(data.sources))}).analysis as ResearchProcurement;
}
it("retains all thirteen quoted fields,raw precision,qualifications and the fiftieth source without verifying eligibility",()=>{
  const analysis=fixture();render(<ProcurementRecords analysis={analysis} sourcePrefix="result"/>);
  const report=screen.getByRole("region",{name:"Procurement records"});expect(report).toBeVisible();
  const summaries=report.querySelectorAll("ol > li > details > summary");expect(summaries).toHaveLength(12);
  fireEvent.click(summaries[11]);const record=summaries[11].parentElement!;
  expect(record.querySelectorAll("dt")).toHaveLength(13);
  expect(within(record).getByText("Value wording",{exact:true})).toBeVisible();
  expect(within(record).getAllByText(/9007199254740993.25/)).toHaveLength(14);
  expect(within(record).getByText(analysis.records[11].limitations[3],{exact:true})).toBeVisible();
  expect(within(record).getAllByRole("link",{name:"[S12]"})).toHaveLength(13);
  expect(within(record).getAllByRole("link")[0]).toHaveAttribute("href","#result-S12");
  expect(screen.getByText(analysis.gaps[11].description,{exact:true})).toBeVisible();
  fireEvent.click(screen.getByText("Consulted source scope (50)",{exact:true}));
  expect(screen.getAllByText("Synthetic procurement 50.txt",{exact:true})).toHaveLength(3);
  expect(screen.getByText(/do not establish current eligibility/)).toBeVisible();
});
it("renders honest empty results and preserves unknown fields instead of inventing suppliers or deadlines",()=>{
  const analysis=fixture();analysis.records=analysis.records.slice(0,1);analysis.records[0].fields={notice_id:analysis.records[0].fields.notice_id};
  const view=render(<ProcurementRecords analysis={analysis}/>);
  fireEvent.click(view.container.querySelector("summary")!);
  expect(screen.getAllByText("Not established by this record",{exact:true})).toHaveLength(12);
  view.unmount();analysis.records=[];analysis.gaps=[];render(<ProcurementRecords analysis={analysis}/>);
  expect(screen.getByText(/not a complete market search or proof of no opportunities/)).toBeVisible();
  expect(screen.getByText(/does not prove complete coverage or eligibility/)).toBeVisible();
});
