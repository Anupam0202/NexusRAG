export interface RankedCandidate { id:string; rank:number; score?:number; source:"dense"|"sparse"|"exact" }
export interface FusedCandidate { id:string; score:number; sources:readonly string[] }
export function reciprocalRankFusion(lists:readonly (readonly RankedCandidate[])[], k=60, limit=80):FusedCandidate[] {
  if(!Number.isFinite(k)||k<=0||!Number.isSafeInteger(limit)||limit<1) throw new Error("INVALID_FUSION_CONFIG");
  const scores=new Map<string,{score:number;sources:Set<string>}>();
  for(const list of lists){
    const seen=new Set<string>();
    for(const item of list){
      if(seen.has(item.id)) continue;
      seen.add(item.id);
      if(!item.id||!Number.isSafeInteger(item.rank)||item.rank<1) throw new Error("INVALID_CANDIDATE");
      const current=scores.get(item.id)??{score:0,sources:new Set<string>()};
      current.score+=1/(k+item.rank); current.sources.add(item.source); scores.set(item.id,current);
    }
  }
  return [...scores].map(([id,v])=>({id,score:v.score,sources:Object.freeze([...v.sources].sort())}))
    .sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id)).slice(0,limit);
}
