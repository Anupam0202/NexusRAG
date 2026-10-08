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
