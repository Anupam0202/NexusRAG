import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSettings, getSystemStatus, updateSettings, setWorkspaceId } = vi.hoisted(() => ({
  getSettings: vi.fn(),
  getSystemStatus: vi.fn(),
  updateSettings: vi.fn(),
  setWorkspaceId: vi.fn(),
}));

vi.mock("@/hooks/useAuthGate", () => ({
  useWorkspaceApiAccess: () => ({
    authMode: "authenticated",
    canAccessWorkspaceApi: true,
  }),
}));

vi.mock("@/hooks/useStore", () => ({
  useStore: (selector: (state: object) => unknown) => selector({
    workspaceId: "workspace-test",
    setWorkspaceId,
  }),
}));

vi.mock("@/lib/api", () => ({
  getSettings,
  getSystemStatus,
  updateSettings,
}));

vi.mock("@/components/layout/StaticLink", () => ({
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

vi.mock("@/lib/static-navigation", () => ({ reloadStatic: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import SettingsPage from "./page";

const settings = {
  llm_model_name: "gemini-2.5-flash",
  llm_temperature: 0.1,
  retrieval_top_k: 8,
  enable_reranking: false,
  hybrid_search_alpha: 0.6,
  context_window_messages: 1,
  chunk_size: 1600,
  chunk_overlap: 240,
  enable_semantic_chunking: false,
  enable_contextual_enrichment: false,
  embedding_model: "gemini-embedding-001",
};

describe("SettingsPage", () => {
  beforeEach(() => {
    getSettings.mockReset().mockResolvedValue(settings);
    getSystemStatus.mockReset().mockResolvedValue({
      settings: { memory_constrained: true, use_lightweight_embeddings: true },
    });
    updateSettings.mockReset().mockResolvedValue(settings);
    setWorkspaceId.mockReset();
  });

  it("renders saved runtime settings and accurately disables unsupported profile options", async () => {
    render(<SettingsPage />);

    expect(await screen.findByRole("heading", { name: "Runtime Settings" })).toBeVisible();
    expect(screen.getByRole("slider", { name: "Retrieval Top K" })).toHaveValue("8");
    expect(screen.getByRole("slider", { name: "Context Window" })).toBeDisabled();
    expect(screen.getByRole("switch", { name: /Re-ranking/i })).toBeDisabled();
    expect(screen.getByText(/prior chat messages are not sent to Gemini/i)).toBeVisible();
    expect(screen.getByText("gemini-2.5-flash")).toBeVisible();
  });

  it("saves only supported, bounded settings through the workspace API", async () => {
    render(<SettingsPage />);

    const temperature = await screen.findByRole("slider", { name: "Temperature" });
    fireEvent.change(temperature, { target: { value: "0.45" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Settings" }));

    await waitFor(() => expect(updateSettings).toHaveBeenCalledWith({
      llm_temperature: 0.45,
      retrieval_top_k: 8,
      hybrid_search_alpha: 0.6,
    }));
  });
});