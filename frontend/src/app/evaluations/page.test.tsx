import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const { runSampleEvaluation } = vi.hoisted(() => ({ runSampleEvaluation: vi.fn() }));
vi.mock("@/lib/api", () => ({ runSampleEvaluation }));
import { useStore } from "@/hooks/useStore";
import EvaluationsPage from "./page";
const report = { dataset: "synthetic-fixture.json", mode: "retrieval", generated_at: "2026-09-27T00:00:00Z",
  duration_ms: 10, summary: { total: 1, passed: 1, failed: 0, cross_workspace_leaks: 0, avg_retrieval_recall_at_k: 1, avg_citation_precision: 1, pass_rate: 1 }, gates: { passed: true, checks: {} }, results: [] };
describe("fixture evaluation authority", () => {
  beforeEach(() => {
    runSampleEvaluation.mockReset(); runSampleEvaluation.mockResolvedValue(report);
    useStore.setState({ authMode: "authenticated", authUser: { id: "user-a", email: null }, workspaceId: "workspace-a" });
  });
  it("does not auto-run or invent zero leaks/quality before explicit execution", () => {
    render(<EvaluationsPage />);
    expect(runSampleEvaluation).not.toHaveBeenCalled();
    expect(screen.getByText("Fixture evaluation not run")).toBeInTheDocument();
    expect(screen.getAllByText("Not measured").length).toBeGreaterThan(1);
    expect(screen.getByText(/does not establish live retrieval quality/)).toBeInTheDocument();
  });
  it("uses the requested quality thresholds and explicit hydrated workspace", async () => {
    render(<EvaluationsPage />);
    fireEvent.click(screen.getByRole("button", { name: "Run Fixture Gate" }));
    await screen.findByText("Fixture gate passed — not production acceptance");
    expect(runSampleEvaluation).toHaveBeenCalledWith({ mode: "retrieval", top_k: 20, fail_under_recall: 0.9, fail_under_citation_precision: 0.95 }, { workspaceId: "workspace-a" });
  });
  it("never executes while workspace authority is hydrating", () => {
    useStore.setState({ workspaceId: null }); render(<EvaluationsPage />);
    expect(screen.getByRole("button", { name: "Run Fixture Gate" })).toBeDisabled();
    expect(runSampleEvaluation).not.toHaveBeenCalled();
  });
  it("drops pending old-account reports after identity changes", async () => {
    let finish!: (value: typeof report) => void;
    runSampleEvaluation.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    render(<EvaluationsPage />);
    fireEvent.click(screen.getByRole("button", { name: "Run Fixture Gate" }));
    await waitFor(() => expect(runSampleEvaluation).toHaveBeenCalled());
    act(() => useStore.setState({ authUser: { id: "user-b", email: null } }));
    await act(async () => finish(report));
    expect(screen.queryByText("Fixture gate passed — not production acceptance")).not.toBeInTheDocument();
    expect(screen.getByText("Fixture evaluation not run")).toBeInTheDocument();
  });
});
