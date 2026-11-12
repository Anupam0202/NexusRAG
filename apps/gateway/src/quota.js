// Service-only durable quota gate. Missing schema, policy, or budgets deny every metered call.
const allowedStates = new Set(["READY", "QUOTA_NEAR_LIMIT"]);
const validId = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i;
// What a person can do about each denial. The code is a stable API value; the message is shown to users.
const DENIALS = {
  PROVIDER_REVIEW_REQUIRED: [503, "Processing is paused: the service operator has not recorded a current review of the provider's terms. Please contact the operator."],
  WORKSPACE_APPROVAL_REQUIRED: [403, "A workspace owner needs to approve Google Gemini processing for this workspace (Settings, Privacy) before documents can be processed or questions answered."],
  BUDGET_NOT_CONFIGURED: [503, "No usage budget is configured for this operation. Please contact the service operator."],
  TRY_AFTER_RESET: [429, "Today's usage limit has been reached. It resets at midnight UTC."],
  QUOTA_EXHAUSTED: [429, "Today's usage limit has been reached. It resets at midnight UTC."],
  CAPACITY_REACHED: [429, "Usage is close to today's limit, so this request was not started. The limit resets at midnight UTC."],
  RESERVATION_IN_PROGRESS: [409, "This request is already being processed."],
  BYOK_REQUIRED: [402, "Add your own Gemini API key in Settings to continue."],
  RIGHTS_BLOCKED: [403, "This workspace, content or action is not approved for provider processing."],
};
function error(code, status = 503, reason) {
  const specific = reason && DENIALS[reason] ? reason : code;
  const [mapped, message] = DENIALS[specific] || [status, `Metered operation is unavailable: ${code}.`];
  return Object.assign(new Error(message), { code: specific, status: specific === code ? status : mapped });
}
/** Throws the denial for a `{ state, reason }` result from a rights or quota function. */
function denial(result, fallbackStatus = 503) {
  const state = result?.state || "REVIEW_REQUIRED";
  const status = ["TRY_AFTER_RESET", "QUOTA_EXHAUSTED", "CAPACITY_REACHED"].includes(state) ? 429
    : state === "RESERVATION_IN_PROGRESS" ? 409 : state === "RIGHTS_BLOCKED" ? 403 : state === "BYOK_REQUIRED" ? 402 : fallbackStatus;
  return error(state, status, result?.reason);
}

async function quotaRpc(env, name, payload) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw error("MIGRATION_REQUIRED");
  let response;
  try {
    response = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${name}`, {
      method: "POST", signal: AbortSignal.timeout(8_000),
      headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch { throw error("PROVIDER_UNAVAILABLE"); }
  if (!response.ok) throw error(response.status === 404 ? "MIGRATION_REQUIRED" : "PROVIDER_UNAVAILABLE");
  const result = await response.json();
  if (!result || typeof result.state !== "string") throw error("REVIEW_REQUIRED");
  return result;
}

async function metered(env, context, dimensions, operation) {
  if (!context || !validId.test(context.workspaceId || "") || !context.provider ||
      !["essential", "interactive", "background", "speculative"].includes(context.priority)) throw error("REVIEW_REQUIRED");
  if (context.provider === "gemini" &&
      (context.dataClassification !== "non_sensitive" || (context.action && context.action !== "gemini_non_sensitive"))) {
    throw error("RIGHTS_BLOCKED", 403);
  }
  const entries = Object.entries(dimensions);
  if (!entries.length || entries.some(([name, amount]) => !/^[a-z_]{1,40}$/.test(name) || !Number.isSafeInteger(amount) || amount < 1)) throw error("REVIEW_REQUIRED");
  let reserved = [];
  let called = false;
  try {
    const admission = await quotaRpc(env, "v6_reserve_many", {
      p_workspace: context.workspaceId, p_provider: context.provider, p_dimensions: dimensions,
      p_idempotency_key: crypto.randomUUID(), p_priority: context.priority,
      p_action: context.action || (context.provider === "gemini" ? "gemini_non_sensitive" : "provider_operation"),
      p_data_classification: context.dataClassification || "unknown",
    });
    if (!allowedStates.has(admission.state) || admission.replayed === true || !Array.isArray(admission.reservations) ||
        admission.reservations.length !== entries.length ||
        admission.reservations.some(item => !validId.test(item.id || "") || item.replayed === true || !Number.isSafeInteger(item.amount) || item.amount < 1)) {
      const denied = denial(admission);
      const status = denied.status;
      if (status === 429) {
        denied.retryable = true;
        denied.retryAt = admission.reset_at ? Date.parse(admission.reset_at) : Date.now() + 60_000;
      }
      throw denied;
    }
    reserved = admission.reservations;
    called = true;
    const value = await operation();
    // Charge the admitted maximum; never waive missing provider usage metadata.
    const result = await quotaRpc(env, "v6_settle_many", { p_reservations: reserved, p_provider_called: true });
    if (result.state !== "SETTLED") throw error("REVIEW_REQUIRED");
    return value;
  } catch (cause) {
    if (reserved.length) {
      try {
        const result = await quotaRpc(env, "v6_settle_many", { p_reservations: reserved, p_provider_called: called });
        if (result.state !== (called ? "SETTLED" : "RELEASED")) throw error("REVIEW_REQUIRED");
      } catch { throw error("REVIEW_REQUIRED"); }
    }
    throw cause;
  }
}

async function geminiCall(env, context, dimensions, operation) {
  if (context?.credentialMode === "user_byok") {
    if (typeof context.userApiKey !== "string" || context.userApiKey.length < 10) {
      throw error("BYOK_REQUIRED", 402);
    }
    if (!validId.test(context.workspaceId || "") || !validId.test(context.actorId || "") ||
        context.provider !== "gemini" || context.dataClassification !== "non_sensitive" ||
        (context.action && context.action !== "gemini_non_sensitive")) throw error("RIGHTS_BLOCKED", 403);
    // BYOK skips operator-funded reservations, not rights/privacy/role checks.
    // Never include the credential in the durable service-only authority call.
    const admission = await quotaRpc(env, "nexus_authorize_byok_processing", {
      p_workspace: context.workspaceId, p_actor: context.actorId,
      p_data_classification: context.dataClassification,
    });
    if (admission.state !== "READY" || admission.credential_mode !== "user_byok")
      throw denial(admission.state === "BYOK_REQUIRED" ? admission : { state: "RIGHTS_BLOCKED", reason: admission.reason });
    return operation();
  }
  return metered(env, context, dimensions, operation);
}

/** Fails with an actionable error unless this workspace may be processed right now. Makes no provider call. */
async function requireProcessingApproved(env, workspaceId) {
  const gate = await quotaRpc(env, "nexus_processing_gate", { p_workspace: workspaceId });
  if (gate.state !== "READY") throw denial(gate);
}

export { geminiCall, metered, requireProcessingApproved };
