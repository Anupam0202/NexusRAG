import type { RunEvent,RunTerminal } from "../../../packages/contracts/src/index.ts";
export interface RunStreamState { readonly runId:string; readonly sequence:number; readonly terminal?:RunTerminal; readonly markdown:string }
const terminals=new Set<RunTerminal>(["run.completed","run.failed","run.cancelled","run.interrupted"]);
export function reduceCommittedEvent(state:RunStreamState,event:RunEvent):RunStreamState {
  if(event.runId!==state.runId) return state;
  if(event.sequence<=state.sequence) return state;
  if(event.sequence!==state.sequence+1) throw new Error("EVENT_GAP");
  if(state.terminal) throw new Error("EVENT_AFTER_TERMINAL");
  const terminal=terminals.has(event.type as RunTerminal)?event.type as RunTerminal:undefined;
  const delta=event.type==="answer.delta"&&typeof (event.payload as {markdown?:unknown})?.markdown==="string"?(event.payload as {markdown:string}).markdown:"";
  return Object.freeze({runId:state.runId,sequence:event.sequence,terminal,markdown:state.markdown+delta});
}
