import { readBoundedJsonObject } from "./request-body.js";
import { workbenchContext } from "./workbench.js";

import modes from "../../../frontend/src/lib/research-modes.json" with { type: "json" };
export const RESEARCH_MODE_LIMITS = Object.freeze(modes);
for (const limits of Object.values(RESEARCH_MODE_LIMITS)) Object.freeze(limits);

const invalid = message => { throw Object.assign(new Error(message), { status: 422, code: "INVALID_RESEARCH_PLAN" }); };
function text(value, name, max, optional = false) {
  if (optional && value == null) return null;
  if (typeof value !== "string" || !value.trim() || Array.from(value).length > max || value.includes("\0")) invalid(`${name} is required and must contain at most ${max} characters.`);
  return value.trim();
}
function list(value, name, max, itemLength, minimum = 0) {
  const entries = value ?? [];
  if (!Array.isArray(entries) || entries.length < minimum || entries.length > max) invalid(`${name} must contain ${minimum} to ${max} entries.`);
  return entries.map(item => text(item, name, itemLength));
}
function date(value, name) {
  if (value == null) return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000-")) invalid(`${name} must be an ISO calendar date.`);
  const parsed = new Date(value + "T00:00:00.000Z");
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) invalid(`${name} must be a real calendar date.`);
  return value;
}

// This is an input contract, never a persistence or execution receipt.
export function validateResearchPlan(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) invalid("A research plan is required.");
  const limits = Object.hasOwn(RESEARCH_MODE_LIMITS, input.mode) ? RESEARCH_MODE_LIMITS[input.mode] : null;
  if (!limits) invalid("Choose one of the twelve supported research modes.");
  const plan = {
    plan_id: text(input.plan_id, "Plan identifier", 128), mode: input.mode,
    question: text(input.question, "Question", 10000),
    subquestions: list(input.subquestions, "Subquestions", limits.max_subquestions, 10000),
    private_source_ids: list(input.private_source_ids, "Private sources", limits.max_sources, 128),
    public_provider_ids: list(input.public_provider_ids, "Public providers", limits.max_sources, 128),
    date_from: date(input.date_from, "Start date"), date_to: date(input.date_to, "End date"),
    jurisdiction: text(input.jurisdiction, "Jurisdiction", 128, true),
    entity_scope: list(input.entity_scope, "Entity scope", 100, 128),
    rights_constraints: list(input.rights_constraints, "Rights constraints", 100, 1000),
    expected_calculations: list(input.expected_calculations, "Expected calculations", 50, 1000),
    completion_criteria: list(input.completion_criteria, "Completion criteria", 50, 1000, 1),
  };
  if (Object.hasOwn(input, "passport_subject")) {
    const subject=input.passport_subject;
    const fields={product_id:128,product_name:256,product_version:128,supplier:256};
    if (input.mode!=="PRODUCT_PASSPORT" || !subject || typeof subject!=="object" || Array.isArray(subject)
      || Object.keys(subject).length!==4 || Object.keys(subject).some(key=>!Object.hasOwn(fields,key))) invalid("Choose a complete declared Product Passport identity.");
    plan.passport_subject=Object.fromEntries(Object.entries(fields).map(([key,max])=>[key,text(subject[key],key,max)]));
  }
  if (plan.private_source_ids.length + plan.public_provider_ids.length > limits.max_sources) invalid("Combined source limit exceeded for this mode.");
  if (plan.date_from && plan.date_to && plan.date_to < plan.date_from) invalid("End date must not precede start date.");
  if (plan.public_provider_ids.length && !plan.rights_constraints.length) invalid("Public sources require recorded rights constraints.");
  if (new TextEncoder().encode(JSON.stringify(plan)).length > 96000) invalid("Plan content exceeds the 96,000-byte draft limit. Split the research into smaller plans.");
  return { plan, limits: { ...limits } };
}

function confirmedPlan(value, args) {
  if (!(value && typeof value === "object" && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value.id || "") &&
    value.workspace_id === args.workspace && value.owner_id === args.user.id &&
    value.schema_version === "research-plan/1" && value.state === "planned" &&
    value.persistence_state === "PERSISTED" && value.execution_supported === false &&
    value.plan && typeof value.plan === "object" && Object.hasOwn(RESEARCH_MODE_LIMITS, value.plan.mode))) return false;
  try {
    const validated = validateResearchPlan(value.plan);
    return Object.entries(validated.limits).every(([key, limit]) => value.limits?.[key] === limit);
  } catch { return false; }
}

export async function handleResearchPlans(args) {
  const { request, env, member, serviceRequest, json } = args;
  const url = new URL(request.url), base = "/api/v2/research/plans";
  const matched = url.pathname.match(/^\/api\/v2\/research\/plans\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
  if (url.pathname !== base && !matched) return null;
  const creating = request.method === "POST" && !matched;
  if (!creating && !["GET", "HEAD"].includes(request.method)) throw Object.assign(new Error("Research plans support create, list and read."), { status: 405, code: "METHOD_NOT_ALLOWED" });
  if (creating && !["editor", "admin", "owner"].includes(member.role)) throw Object.assign(new Error("Research plan creation requires editor access."), { status: 403, code: "FORBIDDEN" });
  const limit = Number(url.searchParams.get("limit") || 20), after = url.searchParams.get("after");
  if (!Number.isInteger(limit) || limit < 1 || limit > 50 || (after && !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(after))) invalid("Choose a valid research plan page.");
  const key = creating ? text(request.headers.get("idempotency-key"), "Idempotency-Key", 128) : null;
  const plan = creating ? validateResearchPlan(await readBoundedJsonObject(request)).plan : null;
  let result;
  try {
    result = await serviceRequest(env, "rpc/nexus_research_plan", { method: "POST", body: JSON.stringify({
      p_context: await workbenchContext(args), p_operation: creating ? "create" : matched ? "read" : "list",
      p_id: matched?.[1].toLowerCase() || null, p_plan: plan, p_key: key, p_limit: limit, p_after: after || null,
    }) });
  } catch (error) {
    if (["PGRST202", "42883", "42P01"].includes(error.storageCode)) throw Object.assign(new Error("Research plan storage requires the reviewed research_plan_persistence migration."), { status: 503, code: "MIGRATION_REQUIRED" });
    if (error.code === "NOT_FOUND") throw Object.assign(new Error("Research plan is unavailable in this workspace."), { status: 404, code: "NOT_FOUND" });
    if (error.code === "TENANT_QUOTA_EXCEEDED") throw Object.assign(new Error("The workspace draft-plan storage limit has been reached."), { status: 429, code: "TENANT_QUOTA_EXCEEDED" });
    throw error;
  }
  if (creating || matched) {
    let matches = !creating;
    if (creating && confirmedPlan(result, args)) {
      try { matches = JSON.stringify(validateResearchPlan(result.plan).plan) === JSON.stringify(plan); } catch { matches = false; }
    }
    if (!confirmedPlan(result, args) || !matches) throw Object.assign(new Error("Research plan storage did not confirm the requested plan. Refresh before retrying."), { status: 503, code: "PERSISTENCE_UNCONFIRMED" });
  } else if (!result || !Array.isArray(result.items) || result.items.some(item => !confirmedPlan(item, args)) ||
    (result.next_after !== null && !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(result.next_after || ""))) {
    throw Object.assign(new Error("Research plan list could not be confirmed."), { status: 503, code: "PERSISTENCE_UNCONFIRMED" });
  }
  return json(request, env, result, creating ? 201 : 200);
}
