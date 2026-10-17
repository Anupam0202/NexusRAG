import modes from "../../../frontend/src/lib/research-modes.json" with { type: "json" };
import { hybridFuse } from "./worker-lifecycle.js";

export function queryVariantPrompt(question,mode) {
  const maximum=modes[mode]?.max_query_variants;
  if(!maximum)throw Object.assign(new Error("Unknown research mode."),{code:"MODE_NOT_EXECUTABLE"});
  return `RESEARCH_QUERY_VARIANTS\nProduce at most ${maximum-1} alternative search queries for the question below. Return only JSON {"queries":["..."]}. These are retrieval queries, never answers or evidence. Preserve the question's meaning, entities, exact quoted phrases, identifiers, dates, numbers, units, negation, exceptions and scope. Do not add facts, examples or new entities. Keep each alternative within 500 Unicode characters. Return an empty list if no faithful alternatives exist.\nQUESTION:\n${question}`;
}

function requiredLiterals(question) {
  return [...new Set([
    ...Array.from(question.matchAll(/"[^"\n]+"|“[^”\n]+”/gu),m=>m[0]),
    ...(question.match(/\b[\p{L}\p{N}]+(?:[-./][\p{L}\p{N}]+)+\b/gu)||[]).filter(value=>/\p{N}/u.test(value)),
    ...(question.match(/\b\d+(?:[.,]\d+)*%?\b/gu)||[]),
    ...(question.match(/\b\d+(?:[.,]\d+)*\s*(?:kg|mg|g|km|cm|mm|m|USD|EUR|GBP|INR|days?|hours?|minutes?|months?|years?)\b/gi)||[]),
    ...(question.match(/\b(?:no|not|never|except|without|before|after|only|unless|at least|at most)\b/gi)||[]),
  ])];
}

export function queryVariants(question,mode,generated) {
  const maximum=modes[mode].max_query_variants,queries=[question],seen=new Set([question.trim().toLowerCase()]);
  let entries,status="ORIGINAL_ONLY",rejected=0;
  try {entries=JSON.parse(generated.answer).queries;}catch {status="INVALID_RESPONSE_ORIGINAL_ONLY";}
  if(!Array.isArray(entries)||entries.length>maximum-1)status="INVALID_RESPONSE_ORIGINAL_ONLY";
  else {
    const literals=requiredLiterals(question);
    for(const item of entries) {
      if(typeof item!=="string"||!item.trim()||Array.from(item).length>500||/[\u0000-\u001f]/u.test(item)
        ||literals.some(literal=>!item.toLowerCase().includes(literal.toLowerCase()))) {rejected++;continue;}
      const value=item.trim(),key=value.toLowerCase();
      if(seen.has(key)){rejected++;continue;}
      seen.add(key);queries.push(value);
    }
    status=queries.length>1?"EXPANDED":"ORIGINAL_ONLY";
  }
  return {schema_version:"research-query-retrieval/1",queries,max_queries:maximum,expansion_status:status,rejected_queries:rejected,
    expansion_model:generated.model,expansion_usage:generated.usage,completed_queries:0,
    evidence_interpretation:"SEARCH_QUERIES_NOT_EVIDENCE",paid_fallback:false};
}

// Rank identities within each query before cross-query fusion. Raw cosine scores
// from different queries are not directly comparable and repeated hits count once.
export function fuseQueryVariants(queries,denseLists,sparse,limit,alpha) {
  const ranked=new Map();
  for(const [index,question] of queries.entries()) {
    for(const [rank,hit] of hybridFuse(question,denseLists[index]||[],sparse,200,alpha).entries()) {
      const id=hit.payload.chunk_id,prior=ranked.get(id)||{hit,score:0};
      prior.score+=1/(61+rank);ranked.set(id,prior);
    }
  }
  return [...ranked.values()].sort((a,b)=>b.score-a.score||a.hit.payload.chunk_id.localeCompare(b.hit.payload.chunk_id)).slice(0,limit).map(row=>row.hit);
}
