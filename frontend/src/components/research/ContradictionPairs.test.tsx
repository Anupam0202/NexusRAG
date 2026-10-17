import {fireEvent,render,screen} from "@testing-library/react";
import {expect,it} from "vitest";
import {ContradictionPairs} from "./ContradictionPairs";
import type {ResearchContradiction} from "@/lib/research-run";
const analysis:ResearchContradiction={schema_version:"research-contradiction/1",criterion_index:0,total_documents:2,
  interpretation:"REVIEW_REQUIRED_NO_AUTOMATIC_CONFLICT_VERDICT",coverage:"BOUNDED_RETRIEVAL_AT_MOST_SIX_PAIRS_NOT_EXHAUSTIVE",rejected_pairs:1,
  pairs:[{left:{document_id:"a",citation_id:"S1",quote:"Mass 1 kg",quote_start:2,quote_end:11},right:{document_id:"b",citation_id:"S2",quote:"Mass 2 kg",quote_start:0,quote_end:9},
    relationship:"INSUFFICIENT_CONTEXT",explanation:"Measurement context is missing.",claim_state:"REVIEW_REQUIRED"}],
  documents:["a","b"].map((id,i)=>({document_id:id,filename:`Policy ${id}`,evidence_state:"PAIRED_CANDIDATE",
    consulted_sources:[{version_id:id,chunk_id:id,original_content_hash:"a".repeat(64),chunk_index:i,page_number:2}]}))};
it("renders exact paired quotations, per-document receipts and provisional limits",()=>{
  render(<ContradictionPairs analysis={analysis} sourcePrefix="source"/>);
  expect(screen.getByRole("region",{name:"Source-paired analysis"})).toHaveTextContent("not exhaustive");
  expect(screen.getByText("Mass 1 kg")).toBeVisible();expect(screen.getByText("Mass 2 kg")).toBeVisible();
  expect(screen.getByRole("status")).toHaveTextContent("1 unconfirmed or duplicate pair was excluded.");
  fireEvent.click(screen.getByText("Consulted scope (2 documents)"));
  expect(screen.getByRole("link",{name:"Policy a"})).toHaveAttribute("href","/documents/a");
});
it("opens and focuses the cited original for keyboard or pointer inspection",()=>{
  render(<><ContradictionPairs analysis={analysis} sourcePrefix="source"/><details id="source-S1" tabIndex={-1}><summary>Original</summary>Mass 1 kg</details></>);
  fireEvent.click(screen.getByRole("link",{name:"[S1]"}));
  expect(document.getElementById("source-S1")).toHaveAttribute("open");expect(document.activeElement?.id).toBe("source-S1");
});
it("never presents absent pairs as an established consistency finding",()=>{
  render(<ContradictionPairs analysis={{...analysis,pairs:[],rejected_pairs:0}} sourcePrefix="source"/>);
  expect(screen.getByText("No source-anchored pairs returned. This does not establish consistency.")).toBeVisible();
  expect(screen.queryByText("Mass 1 kg")).not.toBeInTheDocument();
});
