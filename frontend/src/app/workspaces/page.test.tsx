import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const { createWorkspace, listWorkspaces, setWorkspace, navigate } = vi.hoisted(() => ({ createWorkspace: vi.fn(), listWorkspaces: vi.fn(), setWorkspace: vi.fn(), navigate: vi.fn() }));
vi.mock("@/lib/api", () => ({ createWorkspace, listWorkspaces }));
vi.mock("@/lib/static-navigation", () => ({ navigateStatic: navigate, reloadStatic: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));
import { useStore } from "@/hooks/useStore";
import WorkspacesPage from "./page";
const workspace = { id: "workspace-a", name: "Private old workspace", slug: "private-a", role: "owner", plan: "free" };
describe("workspace account and selection fences", () => {
  beforeEach(() => {
    [createWorkspace, listWorkspaces, setWorkspace, navigate].forEach(mock => mock.mockReset());
    listWorkspaces.mockResolvedValue({ workspaces: [] });
    useStore.setState({ authMode: "authenticated", authUser: { id: "user-a", email: null }, workspaceId: null, setWorkspaceId: setWorkspace });
  });
  it("ignores a pending old-account inventory and never selects its workspace", async () => {
    let finish!: (value: unknown) => void; listWorkspaces.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    render(<WorkspacesPage />); await waitFor(() => expect(listWorkspaces).toHaveBeenCalledTimes(1));
    listWorkspaces.mockImplementationOnce(() => new Promise(() => {}));
    act(() => useStore.setState({ authUser: { id: "user-b", email: null } }));
    await act(async () => finish({ workspaces: [workspace] }));
    expect(setWorkspace).not.toHaveBeenCalled(); expect(screen.queryByText(workspace.name)).not.toBeInTheDocument();
  });
  it("does not override a workspace selected while discovery was pending", async () => {
    let finish!: (value: unknown) => void; listWorkspaces.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    render(<WorkspacesPage />);
    act(() => useStore.setState({ workspaceId: "workspace-b" }));
    await act(async () => finish({ workspaces: [workspace] })); expect(setWorkspace).not.toHaveBeenCalled();
  });
  it("binds creation to its account and does not select it after account switch", async () => {
    let finish!: (value: unknown) => void; createWorkspace.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    render(<WorkspacesPage />); await screen.findByText("No workspaces yet");
    fireEvent.change(screen.getByPlaceholderText("New workspace name"), { target: { value: "Synthetic workspace" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(createWorkspace).toHaveBeenCalledWith({ name: "Synthetic workspace" }, { workspaceId: null, expectedUserId: "user-a" });
    listWorkspaces.mockImplementationOnce(() => new Promise(() => {}));
    act(() => useStore.setState({ authUser: { id: "user-b", email: null } }));
    await act(async () => finish(workspace)); expect(setWorkspace).not.toHaveBeenCalled();
  });
});

it("loads subsequent workspace pages on demand and reports exact totals", async () => {
  [createWorkspace, listWorkspaces, setWorkspace, navigate].forEach(mock => mock.mockReset());
  vi.mocked(listWorkspaces).mockResolvedValueOnce({ workspaces: [workspace], total: 2, total_is_exact: true, next_after: "workspace-a" });
  vi.mocked(listWorkspaces).mockResolvedValueOnce({ workspaces: [{ ...workspace, id: "workspace-b", name: "Second workspace" }], total: 2, total_is_exact: true, next_after: null });
  useStore.setState({ authMode: "authenticated", authUser: { id: "user-a", email: null }, workspaceId: "workspace-a", setWorkspaceId: setWorkspace });
  render(<WorkspacesPage />);
  await screen.findByText("Showing 1 of 2 active workspaces");
  fireEvent.click(screen.getByRole("button", { name: "Load more workspaces" }));
  await screen.findByText("Second workspace");
  expect(vi.mocked(listWorkspaces)).toHaveBeenLastCalledWith({ workspaceId: null, expectedUserId: "user-a" }, { after: "workspace-a" });
  expect(screen.getByText("Showing 2 of 2 active workspaces")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Load more workspaces" })).not.toBeInTheDocument();
});

it("does not label a failed inventory read as no workspaces", async () => {
  [createWorkspace, listWorkspaces, setWorkspace, navigate].forEach(mock => mock.mockReset());
  listWorkspaces.mockRejectedValue(new Error("Exact inventory unavailable"));
  useStore.setState({ authMode: "authenticated", authUser: { id: "user-a", email: null }, workspaceId: null, setWorkspaceId: setWorkspace });
  render(<WorkspacesPage />);
  await screen.findByRole("alert");
  expect(screen.queryByText("No workspaces yet")).not.toBeInTheDocument();
  expect(setWorkspace).not.toHaveBeenCalled();
});

it("preserves the first page and allows retry after a continuation failure", async () => {
  [createWorkspace, listWorkspaces, setWorkspace, navigate].forEach(mock => mock.mockReset());
  listWorkspaces.mockResolvedValueOnce({ workspaces: [workspace], total: 2, total_is_exact: true, next_after: workspace.id });
  listWorkspaces.mockRejectedValueOnce(new Error("Continuation unavailable"));
  listWorkspaces.mockResolvedValueOnce({ workspaces: [{ ...workspace, id: "workspace-b", name: "Recovered workspace" }], total: 2, total_is_exact: true, next_after: null });
  useStore.setState({ authMode: "authenticated", authUser: { id: "user-a", email: null }, workspaceId: workspace.id, setWorkspaceId: setWorkspace });
  render(<WorkspacesPage />);
  await screen.findByText(workspace.name);
  fireEvent.click(screen.getByRole("button", { name: "Load more workspaces" }));
  await screen.findByText("Continuation unavailable");
  expect(screen.getByText(workspace.name)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Load more workspaces" }));
  await screen.findByText("Recovered workspace");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("drops a late continuation after switching accounts", async () => {
  [createWorkspace, listWorkspaces, setWorkspace, navigate].forEach(mock => mock.mockReset());
  listWorkspaces.mockResolvedValueOnce({ workspaces: [workspace], total: 2, total_is_exact: true, next_after: workspace.id });
  let finish!: (value: unknown) => void;
  listWorkspaces.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  listWorkspaces.mockResolvedValueOnce({ workspaces: [], total: 0, total_is_exact: true });
  useStore.setState({ authMode: "authenticated", authUser: { id: "user-a", email: null }, workspaceId: workspace.id, setWorkspaceId: setWorkspace });
  render(<WorkspacesPage />);
  await screen.findByText(workspace.name);
  fireEvent.click(screen.getByRole("button", { name: "Load more workspaces" }));
  await waitFor(() => expect(listWorkspaces).toHaveBeenCalledTimes(2));
  act(() => useStore.setState({ authUser: { id: "user-b", email: null }, workspaceId: null }));
  await act(async () => finish({ workspaces: [{ ...workspace, id: "private-late", name: "Private late workspace" }], total: 2 }));
  await screen.findByText("No workspaces yet");
  expect(screen.queryByText("Private late workspace")).not.toBeInTheDocument();
  expect(setWorkspace).not.toHaveBeenCalled();
});
