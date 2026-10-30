import { act,fireEvent,render,screen,waitFor } from "@testing-library/react";
import { beforeEach,expect,it,vi } from "vitest";
import type { ResearchRunResult } from "@/lib/research-run";
const api=vi.hoisted(()=>({createResearchFinding:vi.fn()}));vi.mock("@/lib/api",()=>api);
import { ResearchFindingAction } from "./ResearchFindingAction";
const id="11111111-1111-4111-8111-111111111111",result={question:"Synthetic question",answer:"Synthetic answer [S1]",claim_state:"REVIEW_REQUIRED",
  abstained:false,validated_citation_ids:["S1"]} as ResearchRunResult;
const props={runId:id,index:0,result,workspaceId:id,userId:id,canWrite:true};
beforeEach(()=>{vi.resetAllMocks();api.createResearchFinding.mockResolvedValue({id});});
it("retries one stable creation intent and only then offers the saved finding link",async()=>{
  api.createResearchFinding.mockRejectedValueOnce(new Error("Save not confirmed"));render(<ResearchFindingAction {...props}/>);
  fireEvent.click(screen.getByRole("button",{name:"Save as finding"}));await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button",{name:"Save as finding"}));
  expect(await screen.findByRole("link",{name:"Open saved finding"})).toHaveAttribute("href",`/findings?finding=${id}`);
  expect(api.createResearchFinding.mock.calls[0][3]).toBe(api.createResearchFinding.mock.calls[1][3]);
  expect(api.createResearchFinding).toHaveBeenLastCalledWith(result.question,id,0,expect.any(String),{workspaceId:id,expectedUserId:id});
  expect(screen.getByRole("status")).toHaveTextContent("Independent review is still required");
});
it("does not promote an abstention or enable a viewer write",()=>{
  const page=render(<ResearchFindingAction {...props} result={{...result,abstained:true}}/>);
  expect(screen.getByRole("button")).toBeDisabled();page.unmount();render(<ResearchFindingAction {...props} canWrite={false}/>);
  expect(screen.getByRole("button")).toBeDisabled();expect(api.createResearchFinding).not.toHaveBeenCalled();
});
it("describes an interrupted storage outcome as unconfirmed rather than rejected",async()=>{
  api.createResearchFinding.mockRejectedValueOnce(Object.assign(new Error("Authoritative storage rejected the request."),{code:"PERSISTENCE_UNAVAILABLE"}));
  render(<ResearchFindingAction {...props}/>);fireEvent.click(screen.getByRole("button",{name:"Save as finding"}));
  expect(await screen.findByRole("alert")).toHaveTextContent("not confirmed");
  expect(screen.getByRole("alert")).not.toHaveTextContent("rejected");
});
it("one double submission is persisted once and late unmounted completion is ignored",async()=>{
  let finish!:(value:unknown)=>void;api.createResearchFinding.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
  const page=render(<ResearchFindingAction {...props}/>);const save=screen.getByRole("button");fireEvent.click(save);fireEvent.click(save);
  await waitFor(()=>expect(api.createResearchFinding).toHaveBeenCalledTimes(1));page.unmount();
  await act(async()=>finish({id}));expect(screen.queryByRole("link")).not.toBeInTheDocument();
});
it("does not split a Unicode character at the default finding-title boundary",async()=>{
  render(<ResearchFindingAction {...props} result={{...result,question:"x".repeat(159)+"\u{1F4CA}"}}/>);
  fireEvent.click(screen.getByRole("button",{name:"Save as finding"}));await screen.findByRole("link");
  expect(api.createResearchFinding.mock.calls[0][0]).toBe("x".repeat(159));
});
