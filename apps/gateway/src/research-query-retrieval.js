import modes from "../../../frontend/src/lib/research-modes.json" with { type: "json" };
import { hybridFuse } from "./worker-lifecycle.js";

export function queryVariantPrompt(question,mode,entityTargets=[]) {
  const maximum=modes[mode]?.max_query_variants;
  if(!maximum)throw Object.assign(new Error("Unknown research mode."),{code:"MODE_NOT_EXECUTABLE"});
  if(mode==="ENTITY_INVESTIGATION"&&(!Array.isArray(entityTargets)||entityTargets.length>100
    ||entityTargets.some(value=>typeof value!=="string"||!value.trim()||Array.from(value).length>128)))
    throw Object.assign(new Error("The saved entity target scope is invalid."),{code:"INVALID_SCOPE"});
  const targets=mode==="ENTITY_INVESTIGATION"?`\nREQUESTED_ENTITY_TARGETS_NOT_VERIFIED_IDENTITIES:\n${JSON.stringify(entityTargets)}\nUse these saved targets to guide relevant query variants; never infer that similarly named records are the same legal person.`:"";
  return `RESEARCH_QUERY_VARIANTS\nProduce at most ${maximum-1} alternative search queries for the question below. Return only JSON {"queries":["..."]}. These are retrieval queries, never answers or evidence. Preserve the question's meaning, entities, exact quoted phrases, identifiers, dates, numbers, units, negation, exceptions and scope. Do not add facts, examples or new entities. Keep each alternative within 500 Unicode characters. Return an empty list if no faithful alternatives exist.${targets}\nQUESTION:\n${question}`;
}

function requiredLiterals(question) {
  const matches=pattern=>Array.from(question.matchAll(pattern),match=>({value:match[0],start:match.index,end:match.index+match[0].length}));
  const protectedLiterals=[
    ...matches(/"[^"\n]+"|“[^”\n]+”/gu),
    ...matches(/\b[\p{L}\p{N}]+(?:[-./][\p{L}\p{N}]+)+\b/gu).filter(item=>/\p{N}/u.test(item.value)),
    ...matches(/\b\d+(?:[.,]\d+)*\s*(?:kg|mg|g|km|cm|mm|m|USD|EUR|GBP|INR|days?|hours?|minutes?|months?|years?)\b/gi),
  ];
  // Merge protected spans once for bounded long questions, then skip numeric
  // fragments such as the regex's partial "10" inside the full "10.5kg" token.
  const ranges=[];
  for(const item of [...protectedLiterals].sort((a,b)=>a.start-b.start||a.end-b.end)){
    const previous=ranges.at(-1);
    if(previous&&item.start<=previous.end)previous.end=Math.max(previous.end,item.end);
    else ranges.push({start:item.start,end:item.end});
  }
  let rangeIndex=0;
  const numbers=matches(/\b\d+(?:[.,]\d+)*%?\b/gu).filter(number=>{
    while(rangeIndex<ranges.length&&ranges[rangeIndex].end<=number.start)rangeIndex++;
    const range=ranges[rangeIndex];
    return !range||range.start>number.start||range.end<number.end;
  });
  const qualifiers=matches(/\b(?:no|not|never|except|without|before|after|only|unless|at least|at most)\b/gi);
  return [...new Set([...protectedLiterals,...numbers,...qualifiers].map(item=>item.value))];
}

function containsLiteral(query,literal) {
  const compound=/^[\p{L}\p{N}]+(?:[-./][\p{L}\p{N}]+)+$/u.test(literal)&&!/^\d+(?:[.,]\d+)*%?$/u.test(literal);
  const word="[\\p{L}\\p{N}_]",linker=compound?"[./-]":"[.,]",linked=compound?word:"[\\p{N}]";
  const escaped=literal.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
  // A preserved identifier or quantity must not be a substring of another token.
  return new RegExp(`(?<!${word})(?<!${linked}${linker})${escaped}(?!${word})(?!${linker}${linked})`,"iu").test(query);
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
        ||literals.some(literal=>!containsLiteral(item,literal))) {rejected++;continue;}
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
