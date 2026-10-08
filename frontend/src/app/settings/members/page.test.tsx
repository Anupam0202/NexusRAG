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
});
