import { fireEvent,render,screen } from "@testing-library/react";
import { expect,it } from "vitest";
import { obligationFixture } from "@/test/obligation-fixture";
import { ObligationCandidates } from "./ObligationCandidates";
it("shows source-linked provisions, qualifiers, gaps and proposed controls without certification",()=>{
  render(<ObligationCandidates analysis={obligationFixture().results[0].obligations!} sourcePrefix="run-0"/>);
  expect(screen.getByText(/applicability undetermined/)).toBeVisible();expect(screen.getByText("except public summaries")).toBeVisible();
  expect(screen.getByText("30 days")).toBeVisible();expect(screen.getAllByText("Not found in retrieved evidence").length).toBeGreaterThan(1);
  expect(screen.getByText("Not implemented or certified")).toBeVisible();expect(screen.getByRole("link",{name:"[S2]"})).toHaveAttribute("href","#run-0-S2");
});
it("preserves the no-candidate distinction from proof that no obligations apply",()=>{
  const analysis=obligationFixture().results[0].obligations!;analysis.candidates=[];
  render(<ObligationCandidates analysis={analysis}/>);
  expect(screen.getByText(/0 candidates/)).toBeVisible();expect(screen.getByText(/not a complete obligation register or legal certification/)).toBeVisible();
});
it("mounts one candidate's qualifiers initially, with remaining candidates available through native disclosure",async()=>{
  const analysis=obligationFixture().results[0].obligations!;
  analysis.candidates=Array.from({length:12},(_,index)=>({...analysis.candidates[0],control_candidate:`Proposed control ${index+1}`}));
  render(<ObligationCandidates analysis={analysis}/>);
  expect(screen.getByText("Proposed control 1")).toBeVisible();
  expect(screen.queryByText("Proposed control 12")).not.toBeInTheDocument();
  const summary=screen.getByText(/^Candidate 12:/),details=summary.closest("details")!;
  fireEvent.click(summary);fireEvent(details,new Event("toggle"));
  expect(await screen.findByText("Proposed control 12")).toBeVisible();
  expect(screen.getAllByText("except public summaries")).toHaveLength(2);
});
