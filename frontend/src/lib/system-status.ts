import type { SystemStatusResponse } from "@/types";

export interface DependencyLine {
  tone: "ok" | "warning";
  text: string;
}

const UNVERIFIED: DependencyLine = { tone: "ok", text: "API responding — dependency readiness is not verified" };

const INDEX_PROBLEMS: Record<string, string> = {
  NOT_ANSWERING: "The search index is not answering. It may be restarting or paused; your documents are safe",
  KEY_REJECTED: "The search index refused the service's key. The service operator has to correct it",
  NOT_CONFIGURED: "The search index is not configured",
  RATE_LIMITED: "The search index is rate limited. Try again in a few minutes",
  REJECTED: "The search index gave an unexpected answer",
};

/**
 * One sentence about what the gateway reached when it was asked for its status. The gateway probes its
 * database and its search index; Gemini is checked only when it is used, and the sentence says so.
 */
export function dependencyLine(status: Pick<SystemStatusResponse, "dependency_status"> | null | undefined): DependencyLine {
  const dependencies = status?.dependency_status;
  if (!dependencies?.supabase_data_api || !dependencies.qdrant) return UNVERIFIED;
  if (dependencies.supabase_data_api !== "REACHABLE") return { tone: "warning", text: "The database is not reachable" };
  if (dependencies.qdrant === "READY" || dependencies.qdrant === "EMPTY") {
    return { tone: "ok", text: "Database and search index reachable — Gemini is checked when it is used" };
  }
  const problem = INDEX_PROBLEMS[dependencies.qdrant];
  return problem ? { tone: "warning", text: problem } : UNVERIFIED;
}
