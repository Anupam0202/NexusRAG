import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ listCurrentWorkspaceMembers: vi.fn(), getCurrentWorkspace: vi.fn(), addCurrentWorkspaceMember: vi.fn(), updateCurrentWorkspaceMember: vi.fn(), removeCurrentWorkspaceMember: vi.fn(), success: vi.fn() }));
vi.mock("@/lib/api", () => api);
vi.mock("@/lib/static-navigation", () => ({ navigateStatic: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: api.success, error: vi.fn() } }));
import { useStore } from "@/hooks/useStore";
import MembersPage from "./page";
describe("member mutation identity fencing", () => {
  beforeEach(() => {
    Object.values(api).forEach(mock => mock.mockReset());
    api.listCurrentWorkspaceMembers.mockResolvedValue({ workspace_id: "workspace-a", members: [], management_supported: true });
    api.getCurrentWorkspace.mockResolvedValue({ role: "owner" });
    useStore.setState({ authMode: "authenticated", authUser: { id: "user-a", email: null }, workspaceId: "workspace-a" });
  });
  it("waits for workspace hydration", () => {
    useStore.setState({ workspaceId: null }); render(<MembersPage />);
    expect(api.listCurrentWorkspaceMembers).not.toHaveBeenCalled(); expect(api.getCurrentWorkspace).not.toHaveBeenCalled();
  });
  it("binds member changes to the actor and drops stale completion notifications", async () => {
    let finish!: (value: unknown) => void; api.addCurrentWorkspaceMember.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    render(<MembersPage />); const input = await screen.findByLabelText("Existing user email address or user ID");
    fireEvent.change(input, { target: { value: "synthetic-member-id" } }); fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(api.addCurrentWorkspaceMember).toHaveBeenCalledWith({ email_or_user_id: "synthetic-member-id", role: "viewer" }, { workspaceId: "workspace-a", expectedUserId: "user-a" });
    api.listCurrentWorkspaceMembers.mockImplementationOnce(() => new Promise(() => {}));
    act(() => useStore.setState({ authUser: { id: "user-b", email: null } }));
    await act(async () => finish({ user_id: "old-private-member", role: "viewer", display_name: "Old private member" }));
    expect(api.success).not.toHaveBeenCalled(); expect(screen.queryByText("Old private member")).not.toBeInTheDocument();
    await waitFor(() => expect(api.listCurrentWorkspaceMembers).toHaveBeenCalledTimes(2));
  });
  it("shows exact totals and lets users continue beyond the first member page", async () => {
    api.listCurrentWorkspaceMembers.mockResolvedValueOnce({workspace_id: "workspace-a", members: [{user_id: "member-a", display_name: "First member", role: "viewer"}], total: 203, total_is_exact: true, next_after: "cursor-a", management_supported: true})
      .mockResolvedValueOnce({workspace_id: "workspace-a", members: [{user_id: "member-b", display_name: "Later member", role: "viewer"}], total: 203, total_is_exact: true, next_after: null});
    render(<MembersPage />);
    expect(await screen.findByText("Showing 1 loaded members · 203 total members")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", {name: "Load more members"}));
    expect(await screen.findByText("Later member")).toBeInTheDocument();
    expect(api.listCurrentWorkspaceMembers).toHaveBeenLastCalledWith({workspaceId: "workspace-a", expectedUserId: "user-a"}, {after: "cursor-a"});
    expect(screen.getByText("Showing 2 loaded members · 203 total members")).toBeInTheDocument();
    expect(screen.queryByRole("button", {name: "Load more members"})).not.toBeInTheDocument();
  });
  it("drops a late next page when the workspace changes", async () => {
    let finish!: (value: unknown) => void;
    api.listCurrentWorkspaceMembers.mockResolvedValueOnce({workspace_id: "workspace-a", members: [], next_after: "cursor-a", total: 203, total_is_exact: true})
      .mockImplementationOnce(() => new Promise(resolve => {finish = resolve;}));
    render(<MembersPage />);
    fireEvent.click(await screen.findByRole("button", {name: "Load more members"}));
    act(() => useStore.setState({workspaceId: "workspace-b"}));
    await act(async () => finish({workspace_id: "workspace-a", members: [{user_id: "private-old", display_name: "Private old page", role: "viewer"}], total: 203, total_is_exact: true, next_after: null}));
    expect(screen.queryByText("Private old page")).not.toBeInTheDocument();
  });
  it("preserves loaded members when paging fails and permits a bounded retry", async () => {
    api.listCurrentWorkspaceMembers.mockResolvedValueOnce({workspace_id: "workspace-a", members: [{user_id: "member-a", display_name: "First member", role: "viewer"}], next_after: "cursor-a"})
      .mockRejectedValueOnce(new Error("Temporary paging outage"))
      .mockResolvedValueOnce({workspace_id: "workspace-a", members: [], next_after: null});
    render(<MembersPage />);fireEvent.click(await screen.findByRole("button", {name: "Load more members"}));
    expect(await screen.findByText("Temporary paging outage")).toBeInTheDocument();expect(screen.getByText("First member")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", {name: "Load more members"}));
    await waitFor(() => expect(screen.queryByText("Temporary paging outage")).not.toBeInTheDocument());
  });

  it("keeps member row controls read-only when management capability is unavailable", async () => {
    api.listCurrentWorkspaceMembers.mockResolvedValue({workspace_id: "workspace-a", members: [{user_id: "member-a", display_name: "Read-only member", role: "viewer"}], management_supported: false});
    render(<MembersPage />);expect(await screen.findByText("Read-only member")).toBeInTheDocument();
    expect(screen.queryByRole("button", {name: "Remove member-a"})).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", {name: "Role for member-a"})).not.toBeInTheDocument();
  });

});
