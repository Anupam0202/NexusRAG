// Deterministic review candidates for complete selected text projections.
// Hashes, actual source authority and incomplete-coverage states belong to SQL
// and the owning Radar handler. No acquisition, AI or whole-document alignment.
const RIGHTS=["commercial use","redistribution","licen","terms","privacy","training","artificial intelligence"];
const OPERATIONAL=["quota","rate limit","request per","token","pricing","deprecated","sunset","model","schema"];
// Preserve the existing categorization vocabulary; this performs no security scan.
const EXISTING_REVIEW=["security","authentication","oauth","api key","breach","vulnerability"];
const tokens=/[+-]?(?:[0-9]+(?:,[0-9]{3})*(?:\.[0-9]+)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?%?|[\p{L}\p{N}]+(?:_[\p{L}\p{N}]+)*|[\p{Sc}\p{Sm}%+-]/gu;
const number=/^([+-]?)([0-9][0-9,]*)?(?:\.([0-9]+))?([eE][+-]?[0-9]+)?(%)?$/;

export function normalizeRadarText(text){
  if(typeof text!=="string")throw new TypeError("Radar comparison text must be a string.");
  // Match Python's existing whitespace representation, including C1 separators;
  // ECMAScript \s differs at U+0085/U+001C..001F and U+FEFF.
  return text.replace(/[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+/gu," ").replace(/^ +| +$/g,"");
}
function canonicalToken(token){
  const match=number.exec(token);if(!match)return token;
  const [,sign,rawInteger,rawFraction,rawExponent,percent]=match;
  if(rawInteger===undefined&&rawFraction===undefined)return token;
  const integer=(rawInteger||"0").replaceAll(",","").replace(/^0+/,"")||"0",fraction=(rawFraction||"").replace(/0+$/,"");
  let exponent="";
  if(rawExponent){const power=rawExponent.slice(1).replace(/^[+-]/,"").replace(/^0+/,"")||"0";
    if(power!=="0")exponent=`e${rawExponent[1]==="-"?"-":""}${power}`;}
  return `${sign==="-"&&(integer!=="0"||fraction)?"-":""}${integer}${fraction?"."+fraction:""}${exponent}${percent||""}`;
}
function contexts(text){
  const result=Object.fromEntries(OPERATIONAL.map(signal=>[signal,new Map()]));
  // Normalization has replaced all recognized whitespace with ASCII spaces.
  // Retained BOM must not act as an ECMAScript-only whitespace separator.
  for(const clause of text.split(/(?<=[.!?;]) +/u)){
    const signals=OPERATIONAL.filter(signal=>clause.includes(signal));if(!signals.length)continue;
    const signature=JSON.stringify((clause.match(tokens)||[]).map(canonicalToken));
    for(const signal of signals)result[signal].set(signature,(result[signal].get(signature)||0)+1);
  }
  return result;
}
function sameContexts(left,right){
  if(left.size!==right.size)return false;
  for(const [key,count] of left)if(right.get(key)!==count)return false;
  return true;
}
export function classifyRadarChange(previousText,currentText){
  const previous=normalizeRadarText(previousText),current=normalizeRadarText(currentText);
  if(previous===current)return {changed:false,materiality:"NONE",matched_signals:[]};
  const before=previous.toLowerCase(),after=current.toLowerCase(),left=contexts(before),right=contexts(after);
  const signals=new Set([...RIGHTS,...OPERATIONAL,...EXISTING_REVIEW].filter(signal=>before.includes(signal)!==after.includes(signal)));
  for(const signal of OPERATIONAL)if(!sameContexts(left[signal],right[signal]))signals.add(signal);
  const matched_signals=[...signals].sort();
  const materiality=RIGHTS.some(signal=>signals.has(signal))?"RIGHTS_REVIEW":EXISTING_REVIEW.some(signal=>signals.has(signal))?"SECURITY_REVIEW"
    :OPERATIONAL.some(signal=>signals.has(signal))?"OPERATIONAL":"EDITORIAL";
  return {changed:true,materiality,matched_signals};
}
