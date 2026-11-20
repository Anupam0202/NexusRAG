import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProcessingApprovalNotice } from "./ProcessingApprovalNotice";
import type { ProcessingPolicy } from "@/lib/processing-policy";

const getProcessingPolicy = vi.fn();
vi.mock("@/lib/api", () => ({ getProcessingPolicy: (...args: unknown[]) => getProcessingPolicy(...args) }));

const base: ProcessingPolicy = {
  schema_version: "038", provider: "gemini", state: "RIGHTS_BLOCKED", owner_can_manage: true,
  operator_rights_current: true, policy_version: 0, policy_status: "UNKNOWN", terms_hash: "c".repeat(64),
  terms_url: "https://ai.google.dev/gemini-api/terms", terms_checked_at: "2026-11-12T00:00:00Z", reviewed_at: null,
  approval_expires_at: null, approval_matches_terms: false, reviewing_owner_current: false,
  allowed_data_classification: "non_sensitive", byok_cost_consent_separate: true, provider_processing_performed: false,
};
const context = { workspaceId: "11111111-1111-4111-8111-111111111111", expectedUserId: "22222222-2222-4222-8222-222222222222" };

describe("ProcessingApprovalNotice", () => {
  // A block body: vitest would call a returned function (the mock itself) as a cleanup hook.
  beforeEach(() => { getProcessingPolicy.mockReset(); });

  it("asks an owner to approve and links to the approval page", async () => {
    getProcessingPolicy.mockResolvedValue(base);
    render(<ProcessingApprovalNotice context={context} />);
    expect(await screen.findByText(/approve Google Gemini processing for this workspace/)).toBeVisible();
    expect(screen.getByRole("link", { name: "Review and approve" })).toHaveAttribute("href", "/settings/privacy");
    expect(getProcessingPolicy).toHaveBeenCalledWith(context);
  });

  it("tells other members that an owner has to approve", async () => {
    getProcessingPolicy.mockResolvedValue({ ...base, owner_can_manage: false });
    render(<ProcessingApprovalNotice context={context} />);
    expect(await screen.findByText(/A workspace owner needs to approve/)).toBeVisible();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("explains a missing operator review instead of offering an approval that cannot work", async () => {
    getProcessingPolicy.mockResolvedValue({ ...base, operator_rights_current: false });
    render(<ProcessingApprovalNotice context={context} />);
    expect(await screen.findByText(/service operator has not recorded a current review/)).toBeVisible();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("shows nothing once processing is approved", async () => {
    getProcessingPolicy.mockResolvedValue({ ...base, state: "APPROVED" });
    const { container } = render(<ProcessingApprovalNotice context={context} />);
    await waitFor(() => expect(getProcessingPolicy).toHaveBeenCalledTimes(1));
    expect(container).toBeEmptyDOMElement();
  });

  it("stays silent when the policy cannot be read, because the upload itself reports the reason", async () => {
    getProcessingPolicy.mockImplementation(() => Promise.reject(new Error("offline")));
    const { container } = render(<ProcessingApprovalNotice context={context} />);
    await waitFor(() => expect(getProcessingPolicy).toHaveBeenCalledTimes(1));
    expect(container).toBeEmptyDOMElement();
  });
});
