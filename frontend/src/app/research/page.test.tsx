import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { emptyResearchPlan, modeLimits } from "@/lib/research-plan";
const api = vi.hoisted(() => ({ createResearchPlan: vi.fn(), listResearchPlans: vi.fn(), readResearchPlan: vi.fn(), getCurrentWorkspace: vi.fn() }));
vi.mock("@/lib/api", () => api);
vi.mock("@/hooks/useDocuments", () => ({ useDocuments: () => ({ documents: [{document_id: "document-one", filename: "Synthetic policy.txt", status: "ready"}], loading: false, error: null }) }));
import { useStore } from "@/hooks/useStore";
import ResearchPage from "./page";
const workspace = "11111111-1111-4111-8111-111111111111";
const record = { id: "33333333-3333-4333-8333-333333333333", workspace_id: workspace, owner_id: "user-a",
  plan: { ...emptyResearchPlan(), question: "Synthetic question", completion_criteria: ["Inspect the source."] }, limits: modeLimits.QUICK_LOOKUP,
  state: "planned", persistence_state: "PERSISTED", schema_version: "research-plan/1", execution_supported: false };
beforeEach(() => {
  vi.clearAllMocks();
  useStore.setState({authMode: "authenticated", authUser: {id: "user-a", email: null}, workspaceId: workspace});
  api.getCurrentWorkspace.mockResolvedValue({role: "owner"});
  api.listResearchPlans.mockResolvedValue({items: [], next_after: null});
  api.createResearchPlan.mockResolvedValue(record); api.readResearchPlan.mockResolvedValue(record);
});
it("shows all twelve modes, saves selected sources, and reports only draft persistence", async () => {
  render(<ResearchPage />);
  await waitFor(() => expect(screen.getByRole("button", {name: "Save plan"})).toBeEnabled());
  expect(screen.getAllByRole("option")).toHaveLength(12);
  fireEvent.change(screen.getByLabelText("Question"), {target: {value: "Synthetic question"}});
  fireEvent.change(screen.getByLabelText("Completion criteria"), {target: {value: "Inspect the source."}});
  fireEvent.click(screen.getByRole("checkbox", {name: "Synthetic policy.txt"}));
  fireEvent.click(screen.getByRole("button", {name: "Save plan"}));
  expect(await screen.findByRole("status")).toHaveTextContent("Saved draft. Execution has not started.");
  expect(api.createResearchPlan.mock.calls[0][0].private_source_ids).toEqual(["document-one"]);
  expect(api.createResearchPlan.mock.calls[0][2]).toEqual({workspaceId: workspace, expectedUserId: "user-a"});
});
it("retains draft fields and retry identity after an unconfirmed save", async () => {
  api.createResearchPlan.mockRejectedValueOnce(new Error("Save was not confirmed")).mockResolvedValueOnce(record);
  render(<ResearchPage />);
  await waitFor(() => expect(screen.getByRole("button", {name: "Save plan"})).toBeEnabled());
  fireEvent.change(screen.getByLabelText("Question"), {target: {value: "Synthetic question"}});
  fireEvent.change(screen.getByLabelText("Completion criteria"), {target: {value: "Inspect the source."}});
  fireEvent.click(screen.getByRole("button", {name: "Save plan"}));
  expect(await screen.findByRole("alert")).toHaveTextContent("not confirmed");
  expect(screen.getByLabelText("Question")).toHaveValue("Synthetic question");
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", {name: "Save plan"}));
  await screen.findByRole("status");
  expect(api.createResearchPlan.mock.calls[0][1]).toBe(api.createResearchPlan.mock.calls[1][1]);
});
it("viewer mode allows inspecting stored plans but disables creation and copying", async () => {
  api.getCurrentWorkspace.mockResolvedValue({role: "viewer"});
  api.listResearchPlans.mockResolvedValue({items: [record], next_after: null});
  render(<ResearchPage />);
  fireEvent.click(await screen.findByRole("button", {name: "Open research plan: Synthetic question"}));
  await screen.findByRole("status");
  expect(screen.getByRole("button", {name: "New plan"})).toBeDisabled();
  expect(screen.getByRole("button", {name: "Copy to a new plan"})).toBeDisabled();
});
it("does not display a late plan response after an ordinary workspace switch", async () => {
  let finish!: (value: unknown) => void;
  api.listResearchPlans.mockResolvedValueOnce({items: [record], next_after: null}).mockResolvedValue({items: [], next_after: null});
  api.readResearchPlan.mockImplementation(() => new Promise(resolve => { finish=resolve; }));
  render(<ResearchPage />);
  fireEvent.click(await screen.findByRole("button", {name: "Open research plan: Synthetic question"}));
  act(() => useStore.setState({workspaceId: "workspace-b"}));
  await act(async () => finish(record));
  await waitFor(() => expect(screen.queryByText("Synthetic question")).not.toBeInTheDocument());
});
it("keeps unavailable copied document references visible and removable", async () => {
  const stored = { ...record, plan: { ...record.plan, private_source_ids: ["unavailable-document"] } };
  api.listResearchPlans.mockResolvedValue({items: [stored], next_after: null});
  api.readResearchPlan.mockResolvedValue(stored);
  render(<ResearchPage />);
  fireEvent.click(await screen.findByRole("button", {name: "Open research plan: Synthetic question"}));
  await screen.findByRole("status");
  fireEvent.click(screen.getByRole("button", {name: "Copy to a new plan"}));
  const document = screen.getByRole("checkbox", {name: "unavailable-document (not currently available)"});
  expect(document).toBeChecked();
  fireEvent.click(document);
  fireEvent.click(screen.getByRole("button", {name: "Save plan"}));
  await waitFor(() => expect(api.createResearchPlan).toHaveBeenCalled());
  expect(api.createResearchPlan.mock.calls[0][0].private_source_ids).toEqual([]);
  expect(api.createResearchPlan.mock.calls[0][0].plan_id).not.toBe(stored.plan.plan_id);
});
