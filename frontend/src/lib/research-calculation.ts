export const calculationOperations = ["ADD", "SUBTRACT", "MULTIPLY", "DIVIDE", "PERCENT_CHANGE", "RATIO", "DIFFERENCE"] as const;
export type CalculationOperation = (typeof calculationOperations)[number];
export interface CalculationQuantity { value: string; unit: string; evidence_ids: string[] }
export interface CalculationInput {
  operation: CalculationOperation;
  left: CalculationQuantity;
  right: CalculationQuantity;
  precision: number;
}
export interface CalculationRecord {
  id: string; plan_id: string; workspace_id: string; owner_id: string; created_at: string;
  input: CalculationInput;
  result: { operation: CalculationOperation; value: string; unit: string; formula: string;
    evidence_ids: string[]; precision: number; rounding: "ROUND_HALF_EVEN" };
  state: "calculated"; schema_version: "research-calculation/1";
  persistence_state: "PERSISTED"; input_evidence_state: "CALLER_ASSERTED_NOT_VERIFIED";
}
export function confirmedCalculation(value: unknown, planId: string): value is CalculationRecord {
  if (!value || typeof value !== "object") return false;
  const row=value as CalculationRecord, result=row.result, input=row.input;
  return typeof row.id==="string" && row.plan_id===planId && row.schema_version==="research-calculation/1" &&
    row.persistence_state==="PERSISTED" && row.state==="calculated" && row.input_evidence_state==="CALLER_ASSERTED_NOT_VERIFIED" &&
    !!input && calculationOperations.includes(input.operation) && Number.isInteger(input.precision) && input.precision>=0 && input.precision<=18 &&
    [input.left,input.right].every(q=>!!q && typeof q.value==="string" && typeof q.unit==="string" &&
      Array.isArray(q.evidence_ids) && q.evidence_ids.length>0 && q.evidence_ids.every(id=>typeof id==="string")) &&
    !!result && result.operation===input.operation && result.precision===input.precision && result.rounding==="ROUND_HALF_EVEN" &&
    typeof result.value==="string" && /^-?\d+(\.\d+)?$/.test(result.value) && result.value.length<=300 &&
    typeof result.unit==="string" && typeof result.formula==="string" && Array.isArray(result.evidence_ids) &&
    JSON.stringify(result.evidence_ids)===JSON.stringify([...new Set([...input.left.evidence_ids,...input.right.evidence_ids])]);
}
