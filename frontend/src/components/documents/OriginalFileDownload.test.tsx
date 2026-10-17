import { act,fireEvent,render,screen } from "@testing-library/react";
import { afterEach,beforeEach,expect,it,vi } from "vitest";
const api=vi.hoisted(()=>({downloadDocumentOriginal:vi.fn()}));
vi.mock("@/lib/api",()=>api);
import { useStore } from "@/hooks/useStore";
import { OriginalFileDownload } from "./OriginalFileDownload";
const document={document_id:"doc-a",filename:"Synthetic original.csv",file_type:"text/csv",file_size_bytes:1,page_count:1,chunk_count:1,
  status:"ready" as const,created_at:"2026-10-01T00:00:00Z",processing_time_seconds:0,extraction_method:"synthetic",extra:{version_id:"version-a"}};
const saved={blob:new Blob(["original"]),filename:document.filename,versionId:"version-a",sha256:"a".repeat(64),size:8};
const originalCreate=URL.createObjectURL,originalRevoke=URL.revokeObjectURL;
beforeEach(()=>{
  vi.clearAllMocks();URL.createObjectURL=vi.fn(()=>"blob:synthetic-original");URL.revokeObjectURL=vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype,"click").mockImplementation(()=>{});
  useStore.setState({authMode:"authenticated",authUser:{id:"user-a",email:null},workspaceId:"workspace-a"});
});
afterEach(()=>{URL.createObjectURL=originalCreate;URL.revokeObjectURL=originalRevoke;vi.restoreAllMocks();});
it("starts a download only after the API returns verified original bytes",async()=>{
  api.downloadDocumentOriginal.mockResolvedValue(saved);render(<OriginalFileDownload document={document}/>);
  fireEvent.click(screen.getByRole("button",{name:"Download original"}));
  await screen.findByText("Original verified; download started.");expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(1);
  expect(api.downloadDocumentOriginal.mock.calls[0].slice(0,3)).toEqual(["doc-a","version-a",{workspaceId:"workspace-a",expectedUserId:"user-a"}]);
});
it("keeps an unsuccessful transfer retryable without claiming a saved file",async()=>{
  api.downloadDocumentOriginal.mockRejectedValueOnce(new Error("Stored original is missing")).mockResolvedValue(saved);
  render(<OriginalFileDownload document={document}/>);fireEvent.click(screen.getByRole("button",{name:"Download original"}));
  expect(await screen.findByRole("alert")).toHaveTextContent("missing");expect(URL.createObjectURL).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button",{name:"Download original"}));await screen.findByText("Original verified; download started.");
});
it("cancels an ordinary pending download and enables an explicit retry",async()=>{
  api.downloadDocumentOriginal.mockImplementationOnce((_doc,_version,_context,options)=>new Promise((_resolve,reject)=>options.signal.addEventListener("abort",()=>reject(new DOMException("Cancelled","AbortError")))));
  render(<OriginalFileDownload document={document}/>);fireEvent.click(screen.getByRole("button",{name:"Download original"}));
  fireEvent.click(await screen.findByRole("button",{name:"Cancel original download"}));await screen.findByText("Download cancelled. Transfer quota may still have been charged.");
  expect(screen.getByRole("button",{name:"Download original"})).toBeEnabled();expect(URL.createObjectURL).not.toHaveBeenCalled();
});
it("drops an old-workspace result when its request finishes after navigation",async()=>{
  let finish!:(value:typeof saved)=>void;api.downloadDocumentOriginal.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  render(<OriginalFileDownload document={document}/>);fireEvent.click(screen.getByRole("button",{name:"Download original"}));
  act(()=>useStore.setState({workspaceId:"workspace-b"}));await act(async()=>finish(saved));
  expect(URL.createObjectURL).not.toHaveBeenCalled();expect(screen.queryByText("Original verified; download started.")).not.toBeInTheDocument();
});
it("does not invent a current original version for legacy metadata",()=>{
  render(<OriginalFileDownload document={{...document,extra:{}}}/>);
  expect(screen.getByRole("button",{name:"Download original"})).toBeDisabled();
  expect(screen.getByText("Original version unavailable. Refresh document details.")).toBeVisible();
});
