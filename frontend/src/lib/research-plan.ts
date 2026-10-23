import limits from "./research-modes.json";
import type { PassportSubject } from "./product-passport-subject";

export const researchModes = Object.keys(limits) as Array<keyof typeof limits>;
export type ResearchMode = keyof typeof limits;
export interface ResearchPlanInput {
  plan_id: string;
  mode: ResearchMode;
  question: string;
  subquestions: string[];
  private_source_ids: string[];
  public_provider_ids: string[];
  date_from: string | null;
  date_to: string | null;
  jurisdiction: string | null;
  entity_scope: string[];
  rights_constraints: string[];
  expected_calculations: string[];
  completion_criteria: string[];
  passport_subject?: PassportSubject;
}
export interface ResearchPlanRecord {
  id: string;
  workspace_id: string;
  owner_id: string;
  plan: ResearchPlanInput;
  limits: (typeof limits)[ResearchMode];
  state: "planned";
  created_at: string;
  schema_version: "research-plan/1";
  persistence_state: "PERSISTED";
  execution_supported: false;
}
export const modeLimits = limits;
export function emptyResearchPlan(): ResearchPlanInput {
  return { plan_id: crypto.randomUUID(), mode: "QUICK_LOOKUP", question: "", subquestions: [],
    private_source_ids: [], public_provider_ids: [], date_from: null, date_to: null, jurisdiction: null,
    entity_scope: [], rights_constraints: [], expected_calculations: [], completion_criteria: [] };
}
export function modeLabel(mode: ResearchMode) {
  return mode.toLowerCase().split("_").map(word => word[0].toUpperCase() + word.slice(1)).join(" ");
}
