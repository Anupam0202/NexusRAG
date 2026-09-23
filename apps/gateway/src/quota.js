// Service-only durable quota gate. Missing schema, policy, or budgets deny every metered call.
const allowedStates = new Set(["READY", "QUOTA_NEAR_LIMIT"]);
const validId = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i;
const error = (code, status = 503) => Object.assign(new Error(`Metered operation is unavailable: ${code}.`), { code, status });

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
      const status = ["TRY_AFTER_RESET", "QUOTA_EXHAUSTED", "CAPACITY_REACHED"].includes(admission.state) ? 429 :
        admission.state === "RESERVATION_IN_PROGRESS" ? 409 : 503;
      const denied = error(admission.state || "REVIEW_REQUIRED", status);
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
    // This request is charged to the user's own Gemini account, not NexusRAG's
    // platform key budget. Never include the credential in reservation payloads.
    return operation();
  }
  return metered(env, context, dimensions, operation);
}

export { geminiCall, metered };
