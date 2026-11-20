// What the gateway can reach right now. `/ready` serves this to release smoke tests and monitors; `/health`
// stays a static description that calls nothing. Gemini is left out on purpose: the only free check (listing
// models) does not show whether a key still has quota or credit, so its state is reported where it is used.

import { indexSummary, indexUsable, probeIndex } from "./search-index.js";
import { serviceHeaders } from "./supabase-keys.js";

const READY_MEMORY_MS = 60_000;
const DEGRADED_MEMORY_MS = 10_000; // someone fixing a problem should see the result soon
const TIMEOUT_MS = 4_000;
let remembered = null; // { key, at, report }; per isolate

async function probeDatabase(env, fetchImpl) {
  if (!env?.SUPABASE_URL || !env?.SUPABASE_SERVICE_ROLE_KEY) return { state: "NOT_CONFIGURED", http_status: null };
  try {
    const response = await fetchImpl(`${String(env.SUPABASE_URL).replace(/\/+$/, "")}/rest/v1/workspaces?select=id&limit=1`, {
      headers: serviceHeaders(env),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    await response.body?.cancel().catch(() => {});
    const state = response.ok ? "REACHABLE"
      : response.status === 401 || response.status === 403 ? "KEY_REJECTED"
        : response.status === 404 ? "SCHEMA_MISSING"
          : "UNAVAILABLE";
    return { state, http_status: response.status };
  } catch {
    return { state: "UNAVAILABLE", http_status: 0 };
  }
}

/**
 * Probes the database and the search index with the gateway's own credentials. Anyone may ask `/ready`, so the
 * answer is remembered per isolate (a minute when ready, ten seconds when not) and repeated questions do not
 * become repeated provider calls.
 */
export async function checkReadiness(env, { fetchImpl = fetch, now = Date.now() } = {}) {
  const key = [env?.SUPABASE_URL, env?.QDRANT_URL, env?.QDRANT_COLLECTION].join("|");
  if (remembered && remembered.key === key && now >= remembered.at
    && now - remembered.at < (remembered.report.readiness === "READY" ? READY_MEMORY_MS : DEGRADED_MEMORY_MS)) return remembered.report;
  const [database, searchIndex] = await Promise.all([probeDatabase(env, fetchImpl), probeIndex(env, { fetchImpl, now })]);
  const report = {
    readiness: database.state === "REACHABLE" && indexUsable(searchIndex.state) ? "READY" : "DEGRADED",
    checked_at: new Date(now).toISOString(),
    dependencies: { database, search_index: indexSummary(searchIndex) },
  };
  remembered = { key, at: now, report };
  return report;
}

export function resetReadinessMemory() {
  remembered = null;
}
