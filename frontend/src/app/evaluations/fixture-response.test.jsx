import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
const { runSampleEvaluation } = vi.hoisted(() => ({ runSampleEvaluation: vi.fn() }));
vi.mock("@/lib/api", () => ({ runSampleEvaluation }));
import { useStore } from "@/hooks/useStore";
import EvaluationsPage from "./page";
import { runFixtureEvaluation } from "../../../../apps/gateway/src/fixture-evaluation.js";

// Whole-repository JS integration; frontend-only production compilation has no gateway dependency.
it("renders the actual gateway's computed case and source projection", async () => {
  useStore.setState({ authMode: "authenticated", authUser: { id: "user-a", email: null }, workspaceId: "workspace-a" });
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
