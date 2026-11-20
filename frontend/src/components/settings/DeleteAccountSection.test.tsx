import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { deleteAccount, listWorkspaces, navigateStatic, signOut, setWorkspaceId } = vi.hoisted(() => ({
  deleteAccount: vi.fn(),
  listWorkspaces: vi.fn(),
  navigateStatic: vi.fn(),
  signOut: vi.fn(),
  setWorkspaceId: vi.fn(),
}));

vi.mock("@/lib/api", () => ({ DELETE_ACCOUNT_CONFIRMATION: "DELETE MY ACCOUNT", deleteAccount, listWorkspaces }));
vi.mock("@/lib/supabase/client", () => ({ createSupabaseBrowserClient: () => ({ auth: { signOut } }) }));
vi.mock("@/lib/static-navigation", () => ({ navigateStatic }));
vi.mock("@/hooks/useStore", () => ({
  useStore: (selector: (state: unknown) => unknown) => selector({ authUser: { id: "user-1" }, setWorkspaceId }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { toast } from "sonner";
import { DeleteAccountSection } from "./DeleteAccountSection";

describe("DeleteAccountSection", () => {
  beforeEach(() => {
    for (const mock of [deleteAccount, listWorkspaces, navigateStatic, signOut, setWorkspaceId]) mock.mockReset();
    vi.mocked(toast.error).mockClear();
    signOut.mockResolvedValue({ error: null });
    listWorkspaces.mockResolvedValue({ total: 3, workspaces: [
      { id: "w1", name: "Team docs", role: "owner" }, { id: "w2", name: "Someone else's", role: "editor" }, { id: "w3", name: "Drafts", role: "owner" },
    ] });
  });

  it("names the workspaces that will be deleted for every member", async () => {
    render(<DeleteAccountSection />);
    expect(await screen.findByText("Team docs, Drafts")).toBeInTheDocument();
    expect(screen.getByText(/These workspaces you own are deleted with everything in them, for every member/)).toBeInTheDocument();
    expect(listWorkspaces).toHaveBeenCalledWith({ workspaceId: null, expectedUserId: "user-1" }, { limit: 100 });
  });

  it("deletes only after the typed confirmation, then signs out and returns to sign-in", async () => {
    deleteAccount.mockResolvedValue({ account_deleted: true, state: "PENDING", workspaces_deleted: 2, message: "still being erased" });
    render(<DeleteAccountSection />);
    const button = screen.getByRole("button", { name: "Delete my account" });
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: "Confirm account deletion" }), { target: { value: "delete my account" } });
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: "Confirm account deletion" }), { target: { value: "DELETE MY ACCOUNT" } });
    fireEvent.click(button);
    await waitFor(() => expect(navigateStatic).toHaveBeenCalledWith("/auth/login?account=deleted"));
    expect(deleteAccount).toHaveBeenCalledWith({ workspaceId: null, expectedUserId: "user-1" });
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(setWorkspaceId).toHaveBeenCalledWith(null);
  });

  it("keeps the person here and says so when the deletion fails", async () => {
    deleteAccount.mockRejectedValue(new Error("Account deletion could not be confirmed."));
    render(<DeleteAccountSection />);
    fireEvent.change(screen.getByRole("textbox", { name: "Confirm account deletion" }), { target: { value: "DELETE MY ACCOUNT" } });
    fireEvent.click(screen.getByRole("button", { name: "Delete my account" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Account deletion could not be confirmed."));
    expect(navigateStatic).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Delete my account" })).toBeEnabled();
  });

  it("says plainly when the person owns no workspace", async () => {
    listWorkspaces.mockResolvedValue({ total: 1, workspaces: [{ id: "w2", name: "Someone else's", role: "viewer" }] });
    render(<DeleteAccountSection />);
    expect(await screen.findByText("You do not own any workspace.")).toBeInTheDocument();
  });
});
