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
});