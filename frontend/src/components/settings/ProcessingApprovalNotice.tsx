"use client";

import { useEffect, useState } from "react";
import { getProcessingPolicy, type ApiRequestContext } from "@/lib/api";
import type { ProcessingPolicy } from "@/lib/processing-policy";

/** Says, before anyone uploads or asks, when this workspace cannot be processed yet and who can change that. */
export function ProcessingApprovalNotice({ context }: { context: ApiRequestContext }) {
  const [policy, setPolicy] = useState<ProcessingPolicy | null>(null);
  const { workspaceId, expectedUserId } = context;
  useEffect(() => {
    let active = true;
    setPolicy(null);
    if (!workspaceId) return;
    // A failed read stays silent here: the upload or question itself reports the precise reason.
    getProcessingPolicy({ workspaceId, expectedUserId })
      .then(value => { if (active) setPolicy(value); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [workspaceId, expectedUserId]);
  if (!policy || policy.state === "APPROVED") return null;
  const ownerCanApprove = policy.operator_rights_current && policy.owner_can_manage;
  const message = !policy.operator_rights_current
    ? "Document processing is paused: the service operator has not recorded a current review of the AI provider's terms. Uploads and questions will work again once that is done."
    : policy.owner_can_manage
      ? "Before you upload or ask a question, approve Google Gemini processing for this workspace. It applies to non-sensitive documents only and stays in place until the provider's terms change."
      : "A workspace owner needs to approve Google Gemini processing before documents can be uploaded or questions answered.";
  return (
    <div role="status" className="rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 px-4 py-3 text-sm text-amber-900 dark:text-amber-100">
      <p>{message}</p>
      {ownerCanApprove && (
        <a href="/settings/privacy" className="mt-2 inline-block rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white">
          Review and approve
        </a>
      )}
    </div>
  );
}
