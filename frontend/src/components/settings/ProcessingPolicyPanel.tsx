"use client";

import { useEffect, useRef, useState } from "react";
import { getProcessingPolicy, updateProcessingPolicy, type ApiRequestContext } from "@/lib/api";
import { canApproveProcessing, officialGeminiTermsUrl, type ProcessingPolicy } from "@/lib/processing-policy";

export function ProcessingPolicyPanel({ context }: { context: ApiRequestContext }) {
  const [policy, setPolicy] = useState<ProcessingPolicy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const sequence = useRef(0);
  const { workspaceId, expectedUserId } = context;
  useEffect(() => {
    const lifecycle = sequence;
    const current = ++lifecycle.current;
    setPolicy(null); setError(null); setAcknowledged(false); setConfirmation(""); setNotice(null); setBusy(false);
    getProcessingPolicy({ workspaceId, expectedUserId }).then(value => {
      if (current === sequence.current) setPolicy(value);
    }).catch(reason => {
      if (current === sequence.current) setError(reason instanceof Error ? reason.message : "Policy could not be loaded.");
    });
    return () => { lifecycle.current++; };
  }, [workspaceId, expectedUserId, reload]);
  const decide = async (operation: "approve" | "revoke") => {
    if (!policy || busy || !policy.owner_can_manage ||
      (operation === "approve" && (!canApproveProcessing(policy) || !acknowledged || confirmation !== "APPROVE NON-SENSITIVE"))) return;
    const current = sequence.current;
    setBusy(true); setError(null); setNotice(null);
    try {
      const updated = await updateProcessingPolicy({ operation, policy_version: policy.policy_version,
        ...(operation === "approve" ? { terms_hash: policy.terms_hash!, acknowledged_non_sensitive_only: true as const } : {}) }, { workspaceId, expectedUserId });
      if (current !== sequence.current) return;
      setPolicy(updated); setAcknowledged(false); setConfirmation("");
      setNotice(operation === "revoke" ? "Workspace processing approval revoked. No provider call was made."
        : "Owner decision recorded. Separate provider, quota and user cost-consent checks still apply.");
    } catch (reason) {
      if (current !== sequence.current) return;
      setPolicy(null); setAcknowledged(false); setConfirmation("");
      setError(reason instanceof Error ? reason.message : "Decision failed. Refresh the current policy before retrying.");
    } finally { if (current === sequence.current) setBusy(false); }
  };
  const termsUrl = officialGeminiTermsUrl(policy?.terms_url ?? null);
  return <section aria-labelledby="processing-policy-title" className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4">
    <h3 id="processing-policy-title" className="text-sm font-semibold">Workspace processing approval</h3>
    <p className="mt-2 text-xs leading-5 text-[var(--text-muted)]">Gemini may receive only non-sensitive questions and document excerpts. A user checkbox or API key does not replace workspace-owner approval. BYOK can incur unknown charges and requires separate user cost consent.</p>
    {error ? <div className="mt-3"><p role="alert" className="text-sm">{error}</p><p className="mt-1 text-xs">Approval controls are unavailable. No owner decision can be recorded here; verify the gateway and schema before retrying.</p><button type="button" onClick={() => setReload(n => n + 1)} className="mt-2 rounded-lg border border-[var(--border)] px-3 py-2 text-sm">Refresh policy</button></div>
      : !policy ? <p role="status" className="mt-3 text-sm">Loading processing policy…</p>
      : <div className="mt-3 space-y-3 text-sm">
        <p>Owner approval: <strong>{policy.state === "APPROVED" ? "Current for reviewed terms" : "Not currently valid"}</strong>. This is not provider availability or permission to send sensitive data.</p>
        <p className="text-xs">Operator rights review: {policy.operator_rights_current ? "Current" : "Missing, stale or blocked"}. Owner reviews expire after 30 days and must be renewed when terms change.</p>
        {policy.approval_expires_at && <p className="text-xs">Review expiry: {new Date(policy.approval_expires_at).toLocaleString()}.</p>}
        {policy.terms_hash && <p className="break-all text-xs">Operator-reviewed snapshot hash: <code>{policy.terms_hash}</code>. The decision is bound to this snapshot; the linked live page may subsequently change.</p>}
        {termsUrl && <a href={termsUrl} target="_blank" rel="noopener noreferrer" className="inline-block text-brand-600 underline">Read official Gemini terms</a>}
        {policy.owner_can_manage ? <div className="space-y-3">
          {!canApproveProcessing(policy) && <p className="text-xs">Approval requires a current operator-reviewed terms snapshot. A workspace decision cannot approve provider rights.</p>}
          <label className="flex items-start gap-2 text-xs leading-5"><input type="checkbox" checked={acknowledged} disabled={busy || !canApproveProcessing(policy)} onChange={e => setAcknowledged(e.target.checked)} className="mt-1" />As workspace owner, I have reviewed these terms and authorize only non-sensitive processing. This does not authorize sensitive documents or unknown BYOK costs.</label>
          <label className="block text-xs">Confirm owner approval<input aria-label="Confirm owner processing approval" value={confirmation} disabled={busy || !canApproveProcessing(policy)} onChange={e => setConfirmation(e.target.value)} placeholder="Type APPROVE NON-SENSITIVE" className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-2 text-sm" /></label>
          <div className="flex flex-wrap gap-2"><button type="button" onClick={() => void decide("approve")} disabled={busy || !canApproveProcessing(policy) || !acknowledged || confirmation !== "APPROVE NON-SENSITIVE"} className="rounded-lg bg-brand-600 px-3 py-2 text-sm text-white disabled:opacity-50">Record owner approval</button>
          <button type="button" onClick={() => void decide("revoke")} disabled={busy || policy.policy_status === "DISABLED" || policy.policy_version === 0} className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm disabled:opacity-50">Revoke approval</button></div>
        </div> : <p className="text-xs">Only a current workspace owner can approve or revoke processing.</p>}
        {busy && <p role="status">Recording owner decision…</p>}
      </div>}
    {notice && <p role="status" className="mt-3 text-xs">{notice}</p>}
  </section>;
}