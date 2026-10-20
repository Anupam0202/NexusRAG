import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { emptyResearchPlan, modeLimits, type ResearchPlanRecord } from "@/lib/research-plan";
import { confirmedResearchRun, type ResearchRun } from "@/lib/research-run";
import { copyModes, researchCopyRun } from "@/test/research-copy-fixtures";
const api = vi.hoisted(() => ({ listResearchRuns: vi.fn(), researchRunCommand: vi.fn() }));
vi.mock("@/lib/api", () => api);
import { ResearchRuns } from "./ResearchRuns";

const writeText = vi.fn();
beforeEach(() => {
  api.listResearchRuns.mockReset(); api.researchRunCommand.mockReset(); writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
});
async function open(run: ResearchRun, rows: ResearchRun[] = [run]) {
  expect(confirmedResearchRun(run, run.plan_id)).toBe(true);
  const plan: ResearchPlanRecord = { id: run.plan_id, workspace_id: run.workspace_id, owner_id: run.owner_id,
    plan: { ...emptyResearchPlan(), mode: run.mode!, question: run.questions[0], completion_criteria: ["Review original evidence."],
      private_source_ids: run.source_snapshot!.map(source => source.document_id), subquestions: run.questions.slice(1) },
    limits: modeLimits[run.mode!], state: "planned", created_at: run.created_at,
    schema_version: "research-plan/1", persistence_state: "PERSISTED", execution_supported: false };
  api.listResearchRuns.mockResolvedValue({ items: rows, next_after: null }); api.researchRunCommand.mockResolvedValue(run);
  render(<ResearchRuns plan={plan} workspaceId={run.workspace_id} userId={run.owner_id} canWrite />);
  fireEvent.click(await screen.findByRole("button", { name: `Open execution ${run.id}` }));
  return screen.findByRole("button", { name: /^Copy results$/ });
}
const field = { COMPARE: "comparison", TIMELINE: "timeline", CONTRADICTION_ANALYSIS: "contradiction", DEEP_RESEARCH: "deep" } as const;
for (const mode of copyModes) it(`copies the complete saved ${mode} record, including scope, gaps, locators and review interpretation`, async () => {
  const run = researchCopyRun(mode), before = structuredClone(run);
  fireEvent.click(await open(run)); await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
  expect(writeText.mock.calls[0][0]).toContain(JSON.stringify(run.results[0][field[mode]], null, 2));
  expect(writeText.mock.calls[0][0]).toContain(run.results[0].sources[0].original_content_hash);
  expect(run).toEqual(before);
});
it("recovers from an ordinary clipboard rejection without retaining its stale error", async () => {
  writeText.mockRejectedValueOnce(new Error("Clipboard unavailable")).mockResolvedValue(undefined);
  const button = await open(researchCopyRun("COMPARE")); fireEvent.click(button);
  expect(await screen.findByRole("alert")).toHaveTextContent("The clipboard was unavailable.");
  fireEvent.click(button); await screen.findByRole("button", { name: /^Copied$/ });
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
it("reports an unavailable clipboard API without discarding the saved result", async () => {
  const button = await open(researchCopyRun("COMPARE"));
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
  fireEvent.click(button);
  expect(await screen.findByRole("alert")).toHaveTextContent("The clipboard was unavailable.");
  expect(screen.getByRole("region", { name: "Comparison evidence matrix" })).toBeVisible();
  expect(screen.queryByRole("button", { name: /^Copied$/ })).not.toBeInTheDocument();
});
it("retains every saved criterion in order rather than only the selected report summary", async () => {
  const run = researchCopyRun("COMPARE"), first = run.results[0];
  const second = { ...structuredClone(first), question: "Which second criterion needs review?",
    comparison: { ...structuredClone(first.comparison!), criterion_index: 1 } };
  run.results.push(second); run.questions.push(second.question); run.position = 2; run.total_steps = 2;
  fireEvent.click(await open(run)); await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
  const copied = writeText.mock.calls[0][0] as string;
  expect(copied).toContain(JSON.stringify(first.comparison, null, 2)); expect(copied).toContain(JSON.stringify(second.comparison, null, 2));
  expect(copied.indexOf(first.question)).toBeLessThan(copied.indexOf(second.question));
});
it("does not attempt clipboard output before an execution has a saved result", async () => {
  const run = researchCopyRun("COMPARE"); run.results = []; run.position = 0; run.state = "queued";
  const button = await open(run); expect(button).toBeDisabled(); fireEvent.click(button);
  expect(writeText).not.toHaveBeenCalled();
});
it("does not mark a different selected execution as copied when an earlier copy resolves", async () => {
  let finish!: () => void;
  writeText.mockReturnValueOnce(new Promise<void>(resolve => { finish = resolve; }));
  const first = researchCopyRun("COMPARE"), second = { ...researchCopyRun("COMPARE"), id: "33333333-3333-4333-8333-333333333334" };
  fireEvent.click(await open(first, [first, second])); await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
  api.researchRunCommand.mockResolvedValueOnce(second);
  fireEvent.click(screen.getByRole("button", { name: `Open execution ${second.id}` }));
  await waitFor(() => expect(document.getElementById(`${second.id}-0`)).toBeInTheDocument());
  await act(async () => { finish(); });
  expect(screen.getByRole("button", { name: /^Copy results$/ })).toBeVisible();
  expect(screen.queryByRole("button", { name: /^Copied$/ })).not.toBeInTheDocument();
});
function progressingRuns() {
  const active = researchCopyRun("COMPARE"); active.questions.push("Which next criterion needs review?"); active.total_steps = 2; active.state = "queued";
  const completed = structuredClone(active); completed.state = "completed"; completed.position = 2;
  completed.results.push({ ...structuredClone(active.results[0]), question: active.questions[1],
    comparison: { ...structuredClone(active.results[0].comparison!), criterion_index: 1 } });
  expect(confirmedResearchRun(completed, completed.plan_id)).toBe(true);
  return { active, completed };
}
it("ignores duplicate copy requests while clipboard output is pending and permits an explicit retry", async () => {
  let reject!: (error: Error) => void;
  writeText.mockReturnValueOnce(new Promise<void>((_, fail) => { reject = fail; }));
  const button = await open(researchCopyRun("COMPARE")); fireEvent.click(button); fireEvent.click(button);
  const attempts = writeText.mock.calls.length, disabledWhilePending = button.hasAttribute("disabled");
  await act(async () => { reject(new Error("Ordinary clipboard failure")); });
  expect(attempts).toBe(1); expect(disabledWhilePending).toBe(true);
  expect(await screen.findByRole("alert")).toHaveTextContent("The clipboard was unavailable.");
  fireEvent.click(button); await screen.findByRole("button", { name: /^Copied$/ });
  expect(writeText).toHaveBeenCalledTimes(2); expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
it("keeps refreshing saved research progress after a clipboard failure", async () => {
  const { active, completed } = progressingRuns();
  writeText.mockRejectedValueOnce(new Error("Ordinary clipboard rejection"));
  const button = await open(active); api.researchRunCommand.mockResolvedValue(completed); fireEvent.click(button);
  expect(await screen.findByRole("alert")).toHaveTextContent("The clipboard was unavailable.");
  await waitFor(() => expect(screen.getByRole("progressbar", { name: "Research progress" })).toHaveAttribute("value", "2"), { timeout: 2500 });
  fireEvent.click(button); await screen.findByRole("button", { name: /^Copied$/ });
  expect(writeText.mock.calls.at(-1)![0]).toContain(completed.questions[1]);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
it("does not mark newly appended saved answers as copied by an earlier pending write", async () => {
  let finish!: () => void;
  writeText.mockReturnValueOnce(new Promise<void>(resolve => { finish = resolve; }));
  const { active, completed } = progressingRuns(), button = await open(active);
  api.researchRunCommand.mockResolvedValue(completed); fireEvent.click(button);
  await waitFor(() => expect(screen.getByRole("progressbar", { name: "Research progress" })).toHaveAttribute("value", "2"), { timeout: 2500 });
  await act(async () => { finish(); });
  expect(screen.getByRole("button", { name: /^Copy results$/ })).toBeVisible();
  fireEvent.click(button); await screen.findByRole("button", { name: /^Copied$/ });
  expect(writeText.mock.calls.at(-1)![0]).toContain(completed.questions[1]);
});
it("does not hide an execution refresh failure when copying the last saved answers succeeds", async () => {
  const button = await open(researchCopyRun("COMPARE"));
  api.researchRunCommand.mockRejectedValueOnce(new Error("Execution refresh unavailable"));
  fireEvent.click(screen.getByRole("button", { name: "Refresh executions" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Execution refresh unavailable");
  fireEvent.click(button); await screen.findByRole("button", { name: /^Copied$/ });
  expect(screen.getByRole("alert")).toHaveTextContent("Execution refresh unavailable");
});
