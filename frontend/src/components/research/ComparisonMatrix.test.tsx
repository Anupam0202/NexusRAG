import { fireEvent,render,screen } from "@testing-library/react";
import { expect,it } from "vitest";
import { ComparisonMatrix } from "./ComparisonMatrix";
import type { ResearchComparison } from "@/lib/research-run";
const matrix:ResearchComparison={schema_version:"research-comparison/1",criterion_index:1,batch_index:2,batch_count:5,total_documents:40,
  interpretation:"REVIEW_REQUIRED_NO_AUTOMATIC_EQUIVALENCE_OR_RANKING",cells:[
    {document_id:"a",filename:"Policy A",answer:"30 days [S1]",claim_state:"REVIEW_REQUIRED",abstained:false,validated_citation_ids:["S1"],gap:null},
    {document_id:"b",filename:"Policy B",answer:"Not reported.",claim_state:"UNSUPPORTED",abstained:true,validated_citation_ids:[],gap:"NO_INDEXED_EVIDENCE"}]};
it("shows per-document evidence and missing-data state without claiming equivalence",()=>{
  render(<ComparisonMatrix matrix={matrix} sourcePrefix="source"/>);
  expect(screen.getByRole("columnheader",{name:"Document"})).toBeVisible();
  expect(screen.getByRole("rowheader",{name:"Policy A"})).toBeVisible();
  expect(screen.getByText("No indexed evidence")).toBeVisible();expect(screen.getByText("Review required")).toBeVisible();
  expect(screen.getByText(/Batch 3 of 5/)).toHaveTextContent("40 documents");
  expect(screen.getByRole("link",{name:"[S1]"})).toHaveAttribute("href","#source-S1");
});
it("opens and focuses the exact linked source for ordinary keyboard or pointer inspection",()=>{
  render(<><ComparisonMatrix matrix={matrix} sourcePrefix="source"/><details id="source-S1" tabIndex={-1}><summary>Exact source</summary>30 days</details></>);
  fireEvent.click(screen.getByRole("link",{name:"[S1]"}));
  expect(document.getElementById("source-S1")).toHaveAttribute("open");expect(document.activeElement?.id).toBe("source-S1");
});
