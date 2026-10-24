import { render,screen } from "@testing-library/react";
import { expect,it } from "vitest";
import type { ResearchDeep } from "@/lib/research-run";
import { DeepResearchReport } from "./DeepResearchReport";
const report:ResearchDeep={schema_version:"research-deep/1",phase:"SYNTHESIS",criterion_index:12,question_count:13,
  interpretation:"REVIEW_REQUIRED_CITATIONS_NOT_ENTAILMENT",coverage:"BOUNDED_CANDIDATES_AND_CONTEXT_NOT_EXHAUSTIVE",
  limitations:["Independent review required."],gaps:["One reporting period is unresolved."],
  prior_results:Array.from({length:12},(_,i)=>({result_index:i,question:`Subquestion ${i+1}`,claim_state:i===11?"UNSUPPORTED":"REVIEW_REQUIRED",abstained:i===11})),
  documents:Array.from({length:60},(_,i)=>({document_id:`synthetic-${i}`,filename:`Source ${i+1}`,evidence_state:i===0?"CITED":"NO_INDEXED_EVIDENCE",context_citation_ids:i===0?["S1"]:[],consulted_sources:[]}))};
it("renders the full synthesis lineage, distinct gaps and60source scope with exact in-page references",()=>{
  render(<DeepResearchReport report={report} sourcePrefix="run-12" runPrefix="run"/>);
  expect(screen.getByRole("heading",{name:"Synthesis"})).toBeVisible();
  expect(screen.getByText("Independent review required.")).toBeVisible();
  expect(screen.getByText("One reporting period is unresolved.")).toBeVisible();
  expect(screen.getByText("Earlier analyses (12)")).toBeVisible();expect(screen.getByText("Source scope (60)")).toBeVisible();
  expect(screen.getByRole("link",{name:"Subquestion 12",hidden:true})).toHaveAttribute("href","#run-11");
  expect(screen.getByRole("link",{name:"[S1]",hidden:true})).toHaveAttribute("href","#run-12-S1");
  expect(screen.getByText("Source 60")).toBeInTheDocument();expect(screen.getByText("No supported answer")).toBeInTheDocument();
});
it("Finding metadata preserves provenance without inventing links to invisible previous-run articles",()=>{
  render(<DeepResearchReport report={report}/>);
  expect(screen.getByText("Source scope (60)")).toBeVisible();expect(screen.queryByRole("link",{hidden:true})).not.toBeInTheDocument();
  expect(screen.getByText("Subquestion 12")).toBeInTheDocument();
});
