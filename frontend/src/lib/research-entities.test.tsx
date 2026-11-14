import {fireEvent,render,screen} from "@testing-library/react";
import {expect,it} from "vitest";
import {EntityCandidates} from "@/components/research/EntityCandidates";
import {confirmedResearchRun,type ResearchQuoteAnchor,type ResearchRun,type ResearchRunResult} from "./research-run";
import {researchResultsClipboardText} from "./research-run-copy";

const id="11111111-1111-4111-8111-111111111111",content="\u{1F4CA} Example Works (EX-17) owns Example Holdings from 2025-01-01.";
function fixture():ResearchRun {
  const anchor=(quote:string):ResearchQuoteAnchor=>{const start=Array.from(content.slice(0,content.indexOf(quote))).length;
    return {document_id:id,citation_id:"S1",quote,quote_start:start,quote_end:start+Array.from(quote).length};};
  const result:ResearchRunResult={question:"Investigate synthetic entity evidence.",answer:"Entity identity requires review [S1].",claim_state:"REVIEW_REQUIRED",abstained:false,
    sources:[{citation_id:"S1",document_id:id,version_id:id,chunk_id:id,filename:"Synthetic registry.txt",content,original_content_hash:"a".repeat(64),
      location:{char_start:0,char_end:Array.from(content).length},page_number:null,chunk_index:0,excerpt:false}],validated_citation_ids:["S1"],model:"synthetic",
    coverage:{completeness:"NOT_EXHAUSTIVE",chunks_considered:1},provider_cost_status:"UNKNOWN",review_state:"COMPLETION_CRITERIA_NOT_AUTOMATICALLY_VERIFIED",
    entities:{schema_version:"research-entities/1",criterion_index:0,total_documents:1,requested_targets:["Example Works"],candidates:[{
      name:anchor("Example Works"),identifiers:[anchor("EX-17")],aliases:[],filings:[],jurisdiction:null,valid_from:anchor("2025-01-01"),valid_to:null,
      relationships:[{statement:anchor("Example Works (EX-17) owns Example Holdings from 2025-01-01."),subject:anchor("Example Works"),predicate:anchor("owns"),
        object:anchor("Example Holdings"),valid_from:anchor("2025-01-01"),valid_to:null,claim_state:"REVIEW_REQUIRED",identity_state:"NOT_RESOLVED"}],
      limitations:["No verified current identity or ownership is established."],claim_state:"REVIEW_REQUIRED",identity_state:"NOT_RESOLVED",confidence_state:"NOT_CALIBRATED",decision_state:"NO_AUTOMATIC_ADVERSE_DECISION"}],
      documents:[{document_id:id,filename:"Synthetic registry.txt",evidence_state:"CANDIDATE",consulted_sources:[{version_id:id,chunk_id:id,original_content_hash:"a".repeat(64),page_number:null,chunk_index:0}]}],
      rejections:[],interpretation:"REVIEW_REQUIRED_NO_VERIFIED_IDENTITY_OR_ADVERSE_DECISION",coverage:"BOUNDED_RETRIEVAL_NOT_COMPLETE_ENTITY_REGISTER"}};
  return {id,plan_id:id,workspace_id:id,owner_id:id,mode:"ENTITY_INVESTIGATION",entity_scope:["Example Works"],schema_version:"research-run/1",persistence_state:"PERSISTED",
    state:"completed",generation:1,position:1,total_steps:1,questions:[result.question],results:[result],source_state:"CURRENT",error_code:null,created_at:"2026-10-21T00:00:00Z",
    source_snapshot:[{document_id:id,version_id:id,index_generation:"synthetic",lifecycle_epoch:1}]};
}
it("confirms a complete saved source-anchored Entity Investigation, including literal Unicode offsets and entity scope",()=>{
  const run=fixture();expect(confirmedResearchRun(run,id)).toBe(true);
  expect(run.results[0].entities!.candidates[0].name.quote_start).toBe(2);
  expect(confirmedResearchRun({...run,results:[],results_included:false},id)).toBe(true);
});
it("does not accept a saved report whose targets differ from its persisted plan scope",()=>{
  const run=fixture();run.results[0].entities!.requested_targets=["Different synthetic target"];
  expect(confirmedResearchRun(run,id)).toBe(false);
});
it("keeps source-asserted relationships inside one precise statement on ordinary readback",()=>{
  const run=fixture();run.results[0].entities!.candidates[0].relationships[0].subject.quote_start=0;
  expect(confirmedResearchRun(run,id)).toBe(false);
});
it("preserves all saved entity fields and limitations in Copy results",()=>{
  const run=fixture(),copied=researchResultsClipboardText(run.results);
  expect(copied).toContain(JSON.stringify(run.results[0].entities,null,2));expect(copied).toContain("identities unresolved");
});
it("renders exact identifiers, temporal relationship wording and source links without promoting identity confidence",()=>{
  const run=fixture();render(<EntityCandidates analysis={run.results[0].entities!} sourcePrefix="run-result"/>);
  expect(screen.getByText("EX-17",{exact:true})).toBeVisible();expect(screen.getByText(/confidence not calibrated/)).toBeVisible();
  expect(screen.getByText("owns",{exact:true})).toBeVisible();expect(screen.getByText("Example Holdings",{exact:true})).toBeVisible();
  expect(screen.getAllByRole("link",{name:"[S1]"})[0]).toHaveAttribute("href","#run-result-S1");
  fireEvent.click(screen.getByText("Requested entity targets (1)"));expect(screen.getAllByText("Example Works",{exact:true})[0]).toBeVisible();
});
