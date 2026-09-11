export type UUID = string;
export type EvidenceMode = "ask" | "compare" | "extract" | "summarize";
export type Answerability = "supported" | "partial" | "insufficient" | "conflicting";
export type RunTerminal = "run.completed" | "run.failed" | "run.cancelled" | "run.interrupted";
export type RunEventType =
  | "run.accepted" | "run.started" | "stage.changed" | "evidence.selected"
  | "answer.delta" | "answer.final" | "usage.updated" | RunTerminal;

export interface RequestContext {
  readonly requestId: UUID;
  readonly traceId: UUID;
  readonly userId: UUID;
  readonly workspaceId: UUID;
  readonly membershipRevision: number;
  readonly policyId: UUID;
  readonly policyVersion: number;
  readonly credentialPolicyId: UUID;
  readonly credentialPolicyVersion: number;
  readonly deadline: string;
  readonly environment: "dev" | "test" | "preview" | "canary" | "production";
  readonly reservationId?: UUID;
}

export type SourceLocation =
  | { kind: "pdf"; page: number; bbox?: readonly [number, number, number, number]; approximate: boolean }
  | { kind: "paragraph"; paragraph: number; section?: string; approximate: boolean }
  | { kind: "table"; sheet?: string; row: number; column?: number; approximate: boolean }
  | { kind: "json"; jsonPointer: string; approximate: boolean }
  | { kind: "image"; page?: number; bbox?: readonly [number, number, number, number]; approximate: boolean };

export interface EvidenceReference {
  readonly id: UUID;
  readonly workspaceId: UUID;
  readonly documentId: UUID;
  readonly versionId: UUID;
  readonly chunkId: UUID;
  readonly originalContentHash: string;
  readonly location: SourceLocation;
  readonly extraction: { readonly method: string; readonly complete: boolean; readonly warnings: readonly string[] };
}

export interface QueryScope {
  readonly kind: "workspace" | "documents";
  readonly documentIds: readonly UUID[];
  readonly versionPolicy: "current";
}

export interface QueryCreate {
  readonly sessionId?: UUID;
  readonly mode: EvidenceMode;
  readonly question: string;
  readonly scope: QueryScope;
  readonly comparisonCriteria?: readonly string[];
  readonly extractionSchema?: Readonly<Record<string, "text" | "decimal" | "date" | "boolean">>;
  readonly finalEvidenceK: number;
}

export interface RunEvent<T = unknown> {
  readonly protocolVersion: 2;
  readonly runId: UUID;
  readonly sessionId: UUID;
  readonly attemptId: UUID;
  readonly sequence: number;
  readonly type: RunEventType;
  readonly occurredAt: string;
  readonly payload: T;
}

const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_RE=/^[0-9a-f]{64}$/i;
export function assertUuid(value:string, field="id"):void { if(!UUID_RE.test(value)) throw new Error(`INVALID_${field.toUpperCase()}`); }
export function assertHash(value:string):void { if(!SHA256_RE.test(value)) throw new Error("INVALID_CONTENT_HASH"); }

export function validateQuery(input:QueryCreate):QueryCreate {
  const question=input.question.trim();
  if(!question || question.length>10_000) throw new Error("INVALID_QUESTION");
  if(input.finalEvidenceK<1 || input.finalEvidenceK>20) throw new Error("INVALID_EVIDENCE_K");
  if(input.scope.kind==="documents" && input.scope.documentIds.length===0) throw new Error("INVALID_SCOPE");
  if(input.scope.kind==="workspace" && input.scope.documentIds.length!==0) throw new Error("INVALID_SCOPE");
  for(const id of input.scope.documentIds) assertUuid(id,"document_id");
  if(input.mode==="compare" && (!input.comparisonCriteria || input.comparisonCriteria.length===0)) throw new Error("COMPARISON_CRITERIA_REQUIRED");
  if(input.mode==="extract" && (!input.extractionSchema || Object.keys(input.extractionSchema).length===0)) throw new Error("EXTRACTION_SCHEMA_REQUIRED");
  return Object.freeze({...input, question, scope:Object.freeze({...input.scope,documentIds:Object.freeze([...input.scope.documentIds])})});
}

export function validateEvent(event:RunEvent):RunEvent {
  if(event.protocolVersion!==2 || !Number.isSafeInteger(event.sequence) || event.sequence<1) throw new Error("INVALID_EVENT");
  for(const [value,field] of [[event.runId,"run_id"],[event.sessionId,"session_id"],[event.attemptId,"attempt_id"]] as const) assertUuid(value,field);
  if(!Number.isFinite(Date.parse(event.occurredAt))) throw new Error("INVALID_EVENT_TIME");
  return Object.freeze({...event});
}
