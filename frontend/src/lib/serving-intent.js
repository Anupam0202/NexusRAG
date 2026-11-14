// Cross-runtime immutable intent fingerprint. This frames metadata only and
// stores no copy of rights rationale, duties or source text in a replay receipt.
export const servingIntentSerialization="OBLIGATION_SERVING_INTENT_UTF8/1";
const encoder=new TextEncoder();
const frame=value=>value===null?"-1:":`${encoder.encode(value).byteLength}:${value}`;
export async function servingIntentHash({finding_id,finding_revision,action,actor_id,command}){
  const {selections,policy}=command;
  const values=[finding_id.toLowerCase(),String(finding_revision),action,actor_id.toLowerCase(),String(selections.length),
    ...selections.flatMap(row=>[row.version_id.toLowerCase(),row.original_hash,row.expected_review_id?.toLowerCase()??null]),
    policy.decision,policy.basis,policy.rationale,policy.evidence_reference,policy.attribution,String(policy.duties.length),...policy.duties,policy.review_by];
  if(values.some(value=>value!==null&&typeof value!=="string"))throw new TypeError("Serving intent fields must be normalized strings or null.");
  const digest=await crypto.subtle.digest("SHA-256",encoder.encode(servingIntentSerialization+"\n"+values.map(frame).join("")));
  return Array.from(new Uint8Array(digest),value=>value.toString(16).padStart(2,"0")).join("");
}
