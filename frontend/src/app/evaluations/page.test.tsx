import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const { runSampleEvaluation } = vi.hoisted(() => ({ runSampleEvaluation: vi.fn() }));
vi.mock("@/lib/api", () => ({ runSampleEvaluation }));
import { useStore } from "@/hooks/useStore";
import EvaluationsPage from "./page";
import { runFixtureEvaluation } from "../../../../apps/gateway/src/fixture-evaluation.js";
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
    useStore.setState({ workspaceId: null, workspaceDiscovery: "loading" }); render(<EvaluationsPage />);
    // The shared access hook now fails closed before exposing a runnable control.
    // Layout-level pending/missing/error presentation is tested in the boundary suite.
    expect(screen.queryByRole("button", { name: "Run Fixture Gate" })).not.toBeInTheDocument();
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
  it("locks all request controls while pending and permits a retry after failure", async () => {
    let reject!: (reason: Error) => void;
    runSampleEvaluation.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
    render(<EvaluationsPage />);
    fireEvent.click(screen.getByRole("button", { name: "Run Fixture Gate" }));
    expect(screen.getByRole("spinbutton", { name: "Top K" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "retrieval" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "extractive" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Run Fixture Gate" }));
    expect(runSampleEvaluation).toHaveBeenCalledTimes(1);
    await act(async () => reject(new Error("Evaluation temporarily unavailable")));
    expect(screen.getByText("Evaluation temporarily unavailable")).toBeInTheDocument();
    expect(screen.getByRole("spinbutton", { name: "Top K" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Run Fixture Gate" }));
    await screen.findByText("Fixture gate passed — not production acceptance");
    expect(runSampleEvaluation).toHaveBeenCalledTimes(2);
  });
  it("renders a computed failing report without reporting production success", async () => {
    runSampleEvaluation.mockResolvedValueOnce({ ...report, summary: { ...report.summary, avg_citation_precision: 0.5 },
      gates: { passed: false, checks: { citation_precision: { value: 0.5, threshold: 0.95, passed: false } } } });
    render(<EvaluationsPage />);
    fireEvent.click(screen.getByRole("button", { name: "Run Fixture Gate" }));
    await screen.findByText("Fixture gate failed");
    expect(screen.queryByText("Evaluation unavailable")).not.toBeInTheDocument();
    expect(screen.queryByText("Fixture gate passed — not production acceptance")).not.toBeInTheDocument();
  });
  it("renders the actual gateway's computed case and source projection", async () => {
    runSampleEvaluation.mockImplementationOnce(async (body) => runFixtureEvaluation(body));
    render(<EvaluationsPage />);
    fireEvent.click(screen.getByRole("button", { name: "Run Fixture Gate" }));
    await screen.findByText("Fixture gate failed");
    expect(screen.getAllByRole("article")).toHaveLength(3);
    expect(screen.getByText("What was Alpha Q1 revenue?")).toBeInTheDocument();
    expect(screen.getByText("What is the Beta launch code?")).toBeInTheDocument();
    expect(screen.getAllByText(/alpha_revenue_report.txt/).length).toBeGreaterThan(0);
    expect(screen.queryByText("Evaluation unavailable")).not.toBeInTheDocument();
  });
});
