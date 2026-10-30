import type {ResearchRun} from "./research-run";

export function reuseResearchRunResults(previous:ResearchRun|null,next:ResearchRun):ResearchRun {
  if(!previous||previous.id!==next.id||previous.plan_id!==next.plan_id||previous.workspace_id!==next.workspace_id
    ||previous.owner_id!==next.owner_id||previous.generation!==next.generation||previous.mode!==next.mode
    ||previous.source_state!=="CURRENT"||next.source_state!=="CURRENT"
    ||JSON.stringify(previous.questions)!==JSON.stringify(next.questions)
    ||JSON.stringify(previous.source_snapshot)!==JSON.stringify(next.source_snapshot))return next;
  // Refreshes parse new objects even for saved results that have not changed.
  return {...next,results:next.results.map((result,index)=>{
    const saved=previous.results[index];
    return saved&&JSON.stringify(saved)===JSON.stringify(result)?saved:result;
  })};
}
