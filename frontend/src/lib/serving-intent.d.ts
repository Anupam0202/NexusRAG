export const servingIntentSerialization:"OBLIGATION_SERVING_INTENT_UTF8/1";
export type ServingIntentCommand={
  selections:Array<{version_id:string;original_hash:string;expected_review_id:string|null}>;
  policy:{decision:"ALLOW"|"DENY"|"REVIEW_REQUIRED"|"REVOKED";basis:"OWNED_CONTENT"|"LICENSE"|"PERMISSION"|"PUBLIC_DOMAIN"|"UNKNOWN";
    rationale:string;evidence_reference:string;attribution:string;duties:string[];review_by:string|null};
};
export function servingIntentHash(intent:{finding_id:string;finding_revision:number;action:"SERVE_API"|"SERVE_MCP";actor_id:string;command:ServingIntentCommand}):Promise<string>;
