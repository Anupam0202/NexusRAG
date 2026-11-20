import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({
  createFinding: vi.fn(), editFinding: vi.fn(), exportFinding: vi.fn(), listFindings: vi.fn(),
  readFinding: vi.fn(), removeFinding: vi.fn(), reviewFinding: vi.fn(), shareFinding: vi.fn(), getCurrentWorkspace: vi.fn(), listCurrentWorkspaceMembers: vi.fn(), unshareFinding: vi.fn(),
}));
vi.mock("@/lib/api", () => api);
import { useStore } from "@/hooks/useStore";
import FindingsPage from "./page";
const workspace = "11111111-1111-4111-8111-111111111111";
const finding = { id: "33333333-3333-4333-8333-333333333333", workspace_id: workspace,
  owner_id: "user-a", title: "Saved evidence note", revision: 3, source_run_id: null,
  permission: "owner", author_id: "user-a", authored_markdown: "Authored note", generated_markdown: null,
  source_unavailable: false, evidence: [], reviews: [], participants: [] };
describe("Findings workbench", () => {
  beforeEach(() => {
    window.history.replaceState({},"","/findings");
    Object.values(api).forEach(mock => mock.mockReset());
    useStore.setState({ authMode: "authenticated", authUser: { id: "user-a", email: null }, workspaceId: workspace });
    api.getCurrentWorkspace.mockResolvedValue({ workspace_id: workspace, role: "owner" });
    api.listCurrentWorkspaceMembers.mockResolvedValue({ members: [{ user_id: "user-b", display_name: "Reviewer B", role: "editor" }] });
    api.listFindings.mockResolvedValue({ items: [finding], next_after: null });
    api.readFinding.mockResolvedValue(finding);
  });
  it("does not request private data while signed out", () => {
    useStore.setState({ authMode: "signed_out", authUser: null, workspaceId: null });
    render(<FindingsPage />);
    expect(screen.getByRole("heading", { name: "Sign in to your evidence workbench" })).toBeInTheDocument();
    expect(api.listFindings).not.toHaveBeenCalled();
  });
  it("opens a saved research finding deep link with exact evidence and source export state",async()=>{
    window.history.replaceState({},"",`/findings?finding=${finding.id}`);
    api.readFinding.mockResolvedValue({...finding,source_research_run_id:workspace,source_research_position:0,
      research_origin:{run_id:workspace,result_index:0,plan_id:workspace,question:"Exact synthetic source?",claim_state:"REVIEW_REQUIRED",source_state:"CURRENT"},
      evidence:[{id:workspace,document_id:workspace,version_id:workspace,available:true,freshness:"current",original_text:"Synthetic evidence",original_content_hash:"a".repeat(64),location:{page:2},citation_id:"S1",filename:"Synthetic.txt"}]});
    render(<FindingsPage/>);await waitFor(()=>expect(screen.getByLabelText("Title")).toHaveValue(finding.title));
    expect(api.readFinding).toHaveBeenCalledWith(finding.id,{workspaceId:workspace,expectedUserId:"user-a"});
    expect(screen.getByText("Exact synthetic source?")).toBeVisible();
    expect(screen.getByText(`SHA256 ${"a".repeat(64)}`)).toBeVisible();
    expect(screen.getByText("1 source excerpt · 0 reviews of this revision")).toBeVisible();
    expect(screen.getByRole("button",{name:"Export JSON-LD & receipt"})).toBeDisabled();
    expect(screen.getByRole("link",{name:"Inspect source document"})).toHaveAttribute("href",`/documents/${workspace}`);
  });
  it("keeps accessible findings usable after an invalid deep link",async()=>{
    window.history.replaceState({},"","/findings?finding=missing-id");render(<FindingsPage/>);
    expect(await screen.findByRole("alert")).toHaveTextContent("finding link is invalid");
    fireEvent.click(screen.getByRole("button",{name:/Saved evidence note/}));
    await waitFor(()=>expect(screen.getByLabelText("Title")).toHaveValue(finding.title));
  });
  it("saves an authored note with explicit workspace and stable retry identity", async () => {
    api.createFinding.mockRejectedValueOnce(new Error("Temporary persistence outage")).mockResolvedValueOnce(finding);
    render(<FindingsPage />);
    await waitFor(() => expect(screen.getByRole("button", { name: "New finding" })).not.toBeDisabled());
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "New note" } });
    fireEvent.change(screen.getByLabelText("Authored finding"), { target: { value: "Exact user-authored note" } });
    fireEvent.click(screen.getByRole("button", { name: "Save finding" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Temporary persistence outage");
    fireEvent.click(screen.getByRole("button", { name: "Save finding" }));
    await waitFor(() => expect(api.createFinding).toHaveBeenCalledTimes(2));
    expect(api.createFinding.mock.calls[0][1]).toBe(api.createFinding.mock.calls[1][1]);
    expect(api.createFinding.mock.calls[0][2]).toEqual({ workspaceId: workspace, expectedUserId: "user-a" });
  });
  it("edits use the expected revision and conflicts remain visible", async () => {
    api.editFinding.mockRejectedValue(new Error("The record changed. Reload and retry."));
    render(<FindingsPage />);
    fireEvent.click(await screen.findByRole("button", { name: /Saved evidence note/ }));
    await waitFor(() => expect(screen.getByLabelText("Title")).toHaveValue("Saved evidence note"));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Updated note" } });
    fireEvent.click(screen.getByRole("button", { name: "Save finding" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The record changed");
    expect(api.editFinding).toHaveBeenCalledWith(finding.id,
      { title: "Updated note", authored_markdown: "Authored note", revision: 3 }, { workspaceId: workspace, expectedUserId: "user-a" });
  });
  it("edits a stored160-codepoint supplementary title and an accepted mixed-Unicode note without truncation", async () => {
    const storedTitle="😀".repeat(160),editedTitle="😀".repeat(159)+"🧪";
    //50,000 codepoints/65,000UTF16units/95,000UTF8bytes: within the existing
    //character and100,000-byte request bounds including this title/envelope.
    const note="a".repeat(35000)+"😀".repeat(15000);
    const stored={...finding,title:storedTitle};api.readFinding.mockResolvedValueOnce(stored).mockResolvedValue({...stored,title:editedTitle,authored_markdown:note,revision:4});
    api.editFinding.mockResolvedValue({...stored,title:editedTitle,authored_markdown:note,revision:4});
    render(<FindingsPage/>);fireEvent.click(await screen.findByRole("button",{name:/Saved evidence note/}));
    const title=await screen.findByLabelText("Title");await waitFor(()=>expect(title).toHaveValue(storedTitle));
    expect(title).toHaveAttribute("maxlength","320");expect(screen.getByLabelText("Authored finding")).toHaveAttribute("maxlength","100000");
    fireEvent.change(title,{target:{value:editedTitle}});fireEvent.change(screen.getByLabelText("Authored finding"),{target:{value:note}});
    fireEvent.click(screen.getByRole("button",{name:"Save finding"}));
    await waitFor(()=>expect(api.editFinding).toHaveBeenCalledWith(finding.id,{title:editedTitle,authored_markdown:note,revision:3},{workspaceId:workspace,expectedUserId:"user-a"}));
    await waitFor(()=>expect(screen.getByRole("heading",{name:"Revision 4 · owner"})).toBeVisible());
    expect(screen.getByLabelText("Title")).toHaveValue(editedTitle);expect(screen.getByLabelText("Authored finding")).toHaveValue(note);
  });
  it("rejects character overflow before saving despite the widerUTF16 input envelope",async()=>{
    render(<FindingsPage/>);fireEvent.click(await screen.findByRole("button",{name:/Saved evidence note/}));
    await waitFor(()=>expect(screen.getByLabelText("Title")).toHaveValue(finding.title));
    fireEvent.change(screen.getByLabelText("Title"),{target:{value:"a".repeat(161)}});fireEvent.click(screen.getByRole("button",{name:"Save finding"}));
    expect(await screen.findByRole("alert")).toHaveTextContent("1 to 160 characters");expect(api.editFinding).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Title"),{target:{value:finding.title}});
    fireEvent.change(screen.getByLabelText("Authored finding"),{target:{value:"a".repeat(50001)}});fireEvent.click(screen.getByRole("button",{name:"Save finding"}));
    expect(await screen.findByRole("alert")).toHaveTextContent("at most 50,000 characters");expect(api.editFinding).not.toHaveBeenCalled();
  });
  it("reviews with4,000 supplementary codepoints and rejects4,001 characters before sending",async()=>{
    api.readFinding.mockResolvedValue({...finding,author_id:"independent-author",permission:"contribute"});
    api.reviewFinding.mockResolvedValue({...finding,author_id:"independent-author",permission:"contribute"});
    render(<FindingsPage/>);fireEvent.click(await screen.findByRole("button",{name:/Saved evidence note/}));
    const comment=await screen.findByLabelText("Review comment");expect(comment).toHaveAttribute("maxlength","8000");
    fireEvent.change(comment,{target:{value:"a".repeat(4001)}});fireEvent.click(screen.getByRole("button",{name:"Approve revision"}));
    expect(await screen.findByRole("alert")).toHaveTextContent("at most 4,000 characters");expect(api.reviewFinding).not.toHaveBeenCalled();
    fireEvent.change(comment,{target:{value:"😀".repeat(4000)}});fireEvent.click(screen.getByRole("button",{name:"Approve revision"}));
    await waitFor(()=>expect(api.reviewFinding).toHaveBeenCalledWith(finding.id,{revision:3,decision:"approved",comment:"😀".repeat(4000)},{workspaceId:workspace,expectedUserId:"user-a"}));
  });
  it("shares with a real member selection and supports explicit revocation", async () => {
    api.shareFinding.mockResolvedValue({ ...finding, participants: [{ user_id: "user-b", permission: "read" }] });
    api.unshareFinding.mockResolvedValue(finding);
    render(<FindingsPage />);
    fireEvent.click(await screen.findByRole("button", { name: /Saved evidence note/ }));
    await screen.findByLabelText("Workspace member");
    fireEvent.change(screen.getByLabelText("Workspace member"), { target: { value: "user-b" } });
    fireEvent.change(screen.getByLabelText("Finding permission"), { target: { value: "read" } });
    fireEvent.click(screen.getByRole("button", { name: "Share for review" }));
    await waitFor(() => expect(api.shareFinding).toHaveBeenCalledWith(finding.id,
      { user_id: "user-b", permission: "read" }, { workspaceId: workspace, expectedUserId: "user-a" }));
    fireEvent.click(await screen.findByRole("button", { name: "Revoke access" }));
    await waitFor(() => expect(api.unshareFinding).toHaveBeenCalledWith(finding.id, "user-b", { workspaceId: workspace, expectedUserId: "user-a" }));
  });
  it("viewer controls cannot mutate or export", async () => {
    api.getCurrentWorkspace.mockResolvedValue({ workspace_id: workspace, role: "viewer" });
    api.readFinding.mockResolvedValue({ ...finding, permission: "read" });
    render(<FindingsPage />);
    fireEvent.click(await screen.findByRole("button", { name: /Saved evidence note/ }));
    await waitFor(() => expect(screen.getByLabelText("Title")).toHaveValue("Saved evidence note"));
    expect(screen.getByRole("button", { name: "Save finding" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Export JSON-LD & receipt" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Share for review" })).not.toBeInTheDocument();
  });
  it("unmounts private state on account/workspace switch and ignores late responses", async () => {
    let resolveOld: (value: unknown) => void = () => {};
    api.readFinding.mockImplementation(() => new Promise(resolve => { resolveOld = resolve; }));
    render(<FindingsPage />);
    fireEvent.click(await screen.findByRole("button", { name: /Saved evidence note/ }));
    api.listFindings.mockResolvedValue({ items: [], next_after: null });
    api.getCurrentWorkspace.mockResolvedValue({ workspace_id: "workspace-b", role: "viewer" });
    act(() => useStore.setState({ authUser: { id: "user-b", email: null }, workspaceId: "workspace-b" }));
    await act(async () => resolveOld(finding));
    await waitFor(() => expect(screen.queryByText("Saved evidence note")).not.toBeInTheDocument());
    expect(screen.getByLabelText("Authored finding")).toHaveValue("");
  });
  it("makes reviewers beyond the first roster page selectable without broad eager reads", async () => {
    api.listCurrentWorkspaceMembers.mockResolvedValueOnce({members: [{user_id: "user-b", display_name: "Reviewer B", role: "editor"}], next_after: "cursor-a"})
      .mockResolvedValueOnce({members: [{user_id: "user-c", display_name: "Later reviewer", role: "editor"}], next_after: null});
    render(<FindingsPage />);fireEvent.click(await screen.findByRole("button", {name: /Saved evidence note/}));
    fireEvent.click(await screen.findByRole("button", {name: "Load more workspace members"}));
    expect(await screen.findByRole("option", {name: /Later reviewer/})).toBeInTheDocument();
    expect(api.listCurrentWorkspaceMembers).toHaveBeenLastCalledWith({workspaceId: workspace, expectedUserId: "user-a"}, {after: "cursor-a"});
    expect(screen.queryByRole("button", {name: "Load more workspace members"})).not.toBeInTheDocument();
  });
  it("does not expose a late reviewer page after an account switch", async () => {
    let finish!: (value: unknown) => void;
    api.listCurrentWorkspaceMembers.mockResolvedValueOnce({members: [], next_after: "cursor-a"})
      .mockImplementationOnce(() => new Promise(resolve => {finish = resolve;}));
    render(<FindingsPage />);fireEvent.click(await screen.findByRole("button", {name: /Saved evidence note/}));
    fireEvent.click(await screen.findByRole("button", {name: "Load more workspace members"}));
    api.listFindings.mockResolvedValue({items: [], next_after: null});
    act(() => useStore.setState({authUser: {id: "user-b", email: null}, workspaceId: "workspace-b"}));
    await act(async () => finish({members: [{user_id: "old-private", display_name: "Private late reviewer", role: "editor"}], next_after: null}));
    expect(screen.queryByRole("option", {name: /Private late reviewer/})).not.toBeInTheDocument();
  });

});
