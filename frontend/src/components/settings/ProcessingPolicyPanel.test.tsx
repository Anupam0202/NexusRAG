import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const { getProcessingPolicy, updateProcessingPolicy }=vi.hoisted(()=>({getProcessingPolicy:vi.fn(),updateProcessingPolicy:vi.fn()}));
vi.mock("@/lib/api",()=>({getProcessingPolicy,updateProcessingPolicy}));
import { ProcessingPolicyPanel } from "./ProcessingPolicyPanel";
import { canApproveProcessing, officialGeminiTermsUrl, type ProcessingPolicy } from "@/lib/processing-policy";
const policy:ProcessingPolicy={schema_version:"038",provider:"gemini",state:"RIGHTS_BLOCKED",owner_can_manage:true,operator_rights_current:true,policy_version:3,policy_status:"UNKNOWN",terms_hash:"c".repeat(64),terms_url:"https://ai.google.dev/gemini-api/terms",terms_checked_at:"2026-10-08T00:00:00Z",reviewed_at:null,approval_expires_at:null,approval_matches_terms:false,reviewing_owner_current:false,allowed_data_classification:"non_sensitive",byok_cost_consent_separate:true,provider_processing_performed:false};
const context={workspaceId:"workspace-a",expectedUserId:"actor-a"};
beforeEach(()=>{getProcessingPolicy.mockReset().mockResolvedValue(policy);updateProcessingPolicy.mockReset().mockResolvedValue({...policy,state:"APPROVED"});});
describe("explicit owner processing decision",()=>{
 it("requires both owner acknowledgement and typed confirmation, preserving terms/version context",async()=>{
  render(<ProcessingPolicyPanel context={context}/>);const button=await screen.findByRole("button",{name:"Record owner approval"});expect(button).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox"));expect(button).toBeDisabled();fireEvent.change(screen.getByLabelText("Confirm owner processing approval"),{target:{value:"APPROVE NON-SENSITIVE"}});fireEvent.click(button);
  await waitFor(()=>expect(updateProcessingPolicy).toHaveBeenCalledWith({operation:"approve",policy_version:3,terms_hash:"c".repeat(64),acknowledged_non_sensitive_only:true},context));
  expect(await screen.findByText(/Owner decision recorded/)).toBeVisible();expect(screen.getByRole("checkbox")).not.toBeChecked();
 });
 it("cannot override a blocked operator rights review",async()=>{
  getProcessingPolicy.mockResolvedValue({...policy,operator_rights_current:false});render(<ProcessingPolicyPanel context={context}/>);
  expect(await screen.findByRole("button",{name:"Record owner approval"})).toBeDisabled();expect(screen.getByRole("checkbox")).toBeDisabled();expect(updateProcessingPolicy).not.toHaveBeenCalled();
 });
 it("permits revocation when operator rights expired, without approving new terms",async()=>{
  getProcessingPolicy.mockResolvedValue({...policy,operator_rights_current:false,policy_status:"APPROVED"});render(<ProcessingPolicyPanel context={context}/>);
  fireEvent.click(await screen.findByRole("button",{name:"Revoke approval"}));await waitFor(()=>expect(updateProcessingPolicy).toHaveBeenCalledWith({operation:"revoke",policy_version:3},context));
 });
 it("renders non-owner state without decision controls",async()=>{
  getProcessingPolicy.mockResolvedValue({...policy,owner_can_manage:false});render(<ProcessingPolicyPanel context={context}/>);
  expect(await screen.findByText(/Only a current workspace owner/)).toBeVisible();expect(screen.queryByRole("button",{name:"Record owner approval"})).not.toBeInTheDocument();
 });
 it("fails closed and requires refresh after an unknown or stale mutation outcome",async()=>{
  updateProcessingPolicy.mockRejectedValue(Error("The record changed. Reload and retry."));render(<ProcessingPolicyPanel context={context}/>);
  fireEvent.click(await screen.findByRole("checkbox"));fireEvent.change(screen.getByLabelText("Confirm owner processing approval"),{target:{value:"APPROVE NON-SENSITIVE"}});fireEvent.click(screen.getByRole("button",{name:"Record owner approval"}));
  expect(await screen.findByRole("alert")).toHaveTextContent("record changed");expect(screen.queryByRole("button",{name:"Record owner approval"})).not.toBeInTheDocument();
 });
 it("rejects an old workspace response after identity changes",async()=>{
  let resolve:(p:ProcessingPolicy)=>void;getProcessingPolicy.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));
  const {rerender}=render(<ProcessingPolicyPanel context={context}/>);getProcessingPolicy.mockResolvedValue({...policy,owner_can_manage:false});rerender(<ProcessingPolicyPanel context={{workspaceId:"workspace-b",expectedUserId:"actor-b"}}/>);
  await screen.findByText(/Only a current workspace owner/);await act(async()=>resolve!(policy));expect(screen.queryByRole("button",{name:"Record owner approval"})).not.toBeInTheDocument();
 });
 it("does not create attacker-controlled terms links or approve malformed policy",()=>{
  for(const value of ["javascript:alert(1)","https://ai.google.dev.attacker.invalid/terms","https://user:pass@ai.google.dev/terms","http://ai.google.dev/terms"]){expect(officialGeminiTermsUrl(value)).toBeNull();expect(canApproveProcessing({...policy,terms_url:value})).toBe(false);}
  expect(canApproveProcessing({...policy,terms_hash:"bad"})).toBe(false);
 });
});
