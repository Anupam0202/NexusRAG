export interface ProcessingPolicy {
  schema_version: "038";
  provider: "gemini";
  state: "APPROVED" | "RIGHTS_BLOCKED";
  owner_can_manage: boolean;
  operator_rights_current: boolean;
  policy_version: number;
  policy_status: string;
  terms_hash: string | null;
  terms_url: string | null;
  terms_checked_at: string | null;
  reviewed_at: string | null;
  approval_expires_at: string | null;
  approval_matches_terms: boolean;
  reviewing_owner_current: boolean;
  allowed_data_classification: "non_sensitive";
  byok_cost_consent_separate: true;
  provider_processing_performed: false;
}
export interface ProcessingPolicyDecision {
  operation: "approve" | "revoke";
  policy_version: number;
  terms_hash?: string;
  acknowledged_non_sensitive_only?: true;
}
export function officialGeminiTermsUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "ai.google.dev" && !url.username && !url.password
      ? url.href : null;
  } catch { return null; }
}
export function canApproveProcessing(policy: ProcessingPolicy | null): boolean {
  return !!policy && policy.schema_version === "038" && policy.provider === "gemini"
    && policy.owner_can_manage === true && policy.operator_rights_current === true
    && Number.isSafeInteger(policy.policy_version) && policy.policy_version >= 0
    && /^[0-9a-f]{64}$/.test(policy.terms_hash || "") && officialGeminiTermsUrl(policy.terms_url) !== null;
}
