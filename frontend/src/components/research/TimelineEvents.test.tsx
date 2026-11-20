import { fireEvent,render,screen } from "@testing-library/react";
import { expect,it } from "vitest";
import type { ResearchRun,ResearchTimeline } from "@/lib/research-run";
import { TimelineEvents,TimelineOverview,timelineGroups } from "./TimelineEvents";
it("combines saved batches into chronological bounds and preserves each citation's actual batch",()=>{
  const event=(id:string,date:string)=>({document_id:id,filename:`${id}.txt`,citation_id:"S1",quote:`Effective ${date}.`,quote_start:0,quote_end:21,date_text:date,date_role:"EFFECTIVE",
    date:{precision:"DAY",lower:`${date}T00:00:00.000Z`,upper:`${date}T23:59:59.999Z`},claim_state:"REVIEW_REQUIRED" as const});
  const timeline=(batch:number,id:string,date:string):ResearchTimeline=>({schema_version:"research-timeline/1",criterion_index:0,batch_index:batch,batch_count:2,total_documents:9,
    events:[event(id,date)],gaps:[],interpretation:"REVIEW_REQUIRED_BOUNDS_NOT_CAUSAL_ORDER",coverage:"AT_MOST_TWO_EVENTS_PER_DOCUMENT_PER_CRITERION_NOT_EXHAUSTIVE"});
  const run={id:"saved-run",questions:["Policy chronology"],results:[{timeline:timeline(0,"later","2025-02-01"),sources:[{document_id:"later"}]},
    {timeline:timeline(1,"earlier","2024-02-01"),sources:[{document_id:"earlier"}]}]} as ResearchRun;
  render(<><TimelineOverview run={run}/><details id="saved-run-1-S1" tabIndex={-1}><summary>Original earlier source</summary>Quoted original</details></>);
  expect(screen.getAllByRole("listitem")[0]).toHaveTextContent("Effective 2024-02-01.");
  fireEvent.click(screen.getAllByRole("link",{name:"[S1]"})[0]);expect(screen.getByText("Original earlier source").parentElement).toHaveFocus();
  expect(screen.getByText("Original earlier source").parentElement).toHaveAttribute("open");
  expect(timelineGroups(run)[0].timeline.events).toHaveLength(2);expect(run.results[0].timeline?.events).toHaveLength(1);
});
it("uses singular document copy for a one-source chronology",()=>{
  const timeline={schema_version:"research-timeline/1",criterion_index:0,batch_index:0,batch_count:1,total_documents:1,
    events:[],gaps:[],interpretation:"REVIEW_REQUIRED_BOUNDS_NOT_CAUSAL_ORDER",coverage:"AT_MOST_TWO_EVENTS_PER_DOCUMENT_PER_CRITERION_NOT_EXHAUSTIVE"} as ResearchTimeline;
  render(<TimelineEvents timeline={timeline} sourcePrefix="saved"/>);
  expect(screen.getByText(/1 document · Bounded evidence/)).toBeVisible();
});
