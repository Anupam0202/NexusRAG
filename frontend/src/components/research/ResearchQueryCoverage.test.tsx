import {render,screen,fireEvent} from "@testing-library/react";
import {expect,it} from "vitest";
import {ResearchQueryCoverage} from "./ResearchQueryCoverage";
import {confirmedQueryRetrieval,type ResearchQueryRetrieval} from "@/lib/research-run";
const value:ResearchQueryRetrieval={schema_version:"research-query-retrieval/1",queries:["Original?","Alternative?"],max_queries:2,completed_queries:2,
  expansion_status:"EXPANDED",rejected_queries:0,expansion_model:"synthetic",expansion_usage:{},evidence_interpretation:"SEARCH_QUERIES_NOT_EVIDENCE",paid_fallback:false};
it("shows persisted original and alternate queries without claiming evidence or known cost",()=>{
  render(<ResearchQueryCoverage retrieval={value}/>);fireEvent.click(screen.getByText("Search queries (2 of 2 completed)"));
  expect(screen.getByText(/Original\?/)).toBeVisible();expect(screen.getByText(/Alternative\?/)).toBeVisible();
  expect(screen.getByText(/Search queries are not evidence/)).toBeVisible();expect(screen.getByText(/actual cost can remain unknown/)).toBeVisible();
});
it("keeps an explicit original-only fallback and excluded alternatives visible",()=>{
  render(<ResearchQueryCoverage retrieval={{...value,queries:["Original?"],completed_queries:1,expansion_status:"INVALID_RESPONSE_ORIGINAL_ONLY",rejected_queries:1}}/>);
  fireEvent.click(screen.getByText("Search queries (1 of 1 completed)"));
  expect(screen.getByText(/Only the original query was searched/)).toBeVisible();expect(screen.getByText(/1 duplicate or nonconforming/)).toBeVisible();
});
it("validates exact per-mode bounds, original query, completion and distinct alternatives",()=>{
  expect(confirmedQueryRetrieval(value,"Original?","QUICK_LOOKUP")).toBe(true);
  for(const change of [{completed_queries:1},{max_queries:8},{queries:["Original?","Original?"]},{queries:["Changed?","Alternative?"]},
    {queries:["Original?",null]},{expansion_status:"SUPPORTED"},{expansion_usage:[]},{paid_fallback:true}])
    expect(confirmedQueryRetrieval({...value,...change},"Original?","QUICK_LOOKUP")).toBe(false);
});
