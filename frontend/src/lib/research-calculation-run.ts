import type {ResearchRun,ResearchRunResult} from "./research-run";

// A CALCULATION run step (NX-17): figures quoted from the sources and results the database computed from them.
export const calculationOperations=["ADD","SUBTRACT","MULTIPLY","DIVIDE","PERCENT_CHANGE","RATIO","DIFFERENCE"] as const;
export type CalculationOperation=typeof calculationOperations[number];
export type CalculationQuantity={quantity_id:string;label:string;document_id:string;version_id:string;citation_id:string;
  quote:string;quote_start:number;quote_end:number;value_text:string;value_start:number;value_end:number;value:string;
  unit:string;unit_spans:Array<[number,number]>;period:string|null;period_start:number|null;period_end:number|null;claim_state:"REVIEW_REQUIRED"};
export type CalculationOperand={value:string;unit:string;evidence_ids:string[]};
export type CalculationResult={operation:CalculationOperation;value:string;unit:string;formula:string;evidence_ids:string[];precision:number;rounding:"ROUND_HALF_EVEN"};
export type CalculationStep={label:string;operation:CalculationOperation;left:string;right:string;precision:number;
  input:{operation:CalculationOperation;left:CalculationOperand;right:CalculationOperand;precision:number};
  state:"CALCULATED"|"NOT_CALCULATED";reason:null|"UNITS_DIFFER"|"DIVISION_BY_ZERO";result:CalculationResult|null;claim_state:"REVIEW_REQUIRED"};
export const calculationRejectionReasons={
  QUANTITY:["INVALID_QUANTITY","UNCONFIRMED_SOURCE_ANCHOR","VALUE_NOT_IN_QUOTE","UNIT_NOT_IN_QUOTE","PERIOD_NOT_IN_QUOTE","REPEATED_QUANTITY"],
  CALCULATION:["INVALID_CALCULATION","QUANTITY_UNAVAILABLE","REPEATED_CALCULATION"],
} as const;
export type ResearchCalculationRun={schema_version:"research-calculation-run/1";criterion_index:number;total_documents:number;
  quantities:CalculationQuantity[];calculations:CalculationStep[];rejections:Array<{kind:"QUANTITY"|"CALCULATION";index:number;reason:string}>;
  documents:Array<{document_id:string;filename:string;evidence_state:"QUANTITY_FOUND"|"NO_QUANTITY_FOUND"|"NO_INDEXED_EVIDENCE";
    consulted_sources:Array<{version_id:string;chunk_id:string;original_content_hash:string;page_number:number|null;chunk_index:number}>}>;
  interpretation:"FIGURES_QUOTED_FROM_SOURCES_RESULTS_COMPUTED_BY_DATABASE";coverage:"BOUNDED_RETRIEVAL_NOT_EXHAUSTIVE";rounding:"ROUND_HALF_EVEN"};

const uuid=(value:unknown)=>typeof value==="string"&&/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const text=(value:unknown,max:number):value is string=>typeof value==="string"&&!!value.trim()&&!value.includes("\0")&&Array.from(value).length<=max;
const offset=(value:unknown):value is number=>Number.isSafeInteger(value)&&(value as number)>=0;
const QUOTED_NUMBER=/^[-+−]?(?:[0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)(?:\.[0-9]+)?$/u;
const SAME_UNIT=new Set<CalculationOperation>(["ADD","SUBTRACT","DIFFERENCE","PERCENT_CHANGE"]);
const overlaps=(a:[number,number],b:[number,number])=>a[0]<b[1]&&b[0]<a[1];
const sameOperand=(operand:CalculationOperand,quantity:CalculationQuantity)=>!!operand&&operand.value===quantity.value&&operand.unit===quantity.unit
  &&Array.isArray(operand.evidence_ids)&&operand.evidence_ids.length===1&&operand.evidence_ids[0]===quantity.quantity_id;

/** What the database stores for a step: every figure where its passage states it, every result consistent with its inputs. */
export function confirmedCalculationRun(result:ResearchRunResult,index:number,run:ResearchRun) {
  const analysis=result.calculation,snapshot=run.source_snapshot;
  if(!analysis||!snapshot||analysis.schema_version!=="research-calculation-run/1"||analysis.criterion_index!==index||analysis.total_documents!==snapshot.length
    ||analysis.interpretation!=="FIGURES_QUOTED_FROM_SOURCES_RESULTS_COMPUTED_BY_DATABASE"||analysis.coverage!=="BOUNDED_RETRIEVAL_NOT_EXHAUSTIVE"
    ||analysis.rounding!=="ROUND_HALF_EVEN"||!Array.isArray(analysis.quantities)||analysis.quantities.length>12
    ||!Array.isArray(analysis.calculations)||analysis.calculations.length>6||!Array.isArray(analysis.rejections)
    ||!Array.isArray(analysis.documents)||analysis.documents.length!==snapshot.length||result.sources.length>12)return false;
  const originals=new Map<string,{source:ResearchRunResult["sources"][number];characters:string[]}>();
  for(const source of result.sources) {
    const characters=Array.from(source.content);
    if(characters.length<1||characters.length>1200||originals.has(source.citation_id))return false;
    originals.set(source.citation_id,{source,characters});
  }
  const quantities=new Map<string,CalculationQuantity>(),used=new Set<string>(),figures=new Set<string>();
  for(const [i,q] of analysis.quantities.entries()) {
    if(!q||q.quantity_id!==`Q${i+1}`||q.claim_state!=="REVIEW_REQUIRED"||!text(q.label,200)||!uuid(q.document_id)||!uuid(q.version_id)
      ||!text(q.quote,300)||!offset(q.quote_start)||q.quote_end!==q.quote_start+Array.from(q.quote).length)return false;
    const original=originals.get(q.citation_id),quote=Array.from(q.quote);
    if(!original||original.source.document_id!==q.document_id||original.source.version_id!==q.version_id
      ||original.characters.slice(q.quote_start,q.quote_end).join("")!==q.quote)return false;
    if(typeof q.value_text!=="string"||!QUOTED_NUMBER.test(q.value_text)||Array.from(q.value_text).length>64||!offset(q.value_start)
      ||q.value_end!==q.value_start+Array.from(q.value_text).length||quote.slice(q.value_start,q.value_end).join("")!==q.value_text
      ||q.value!==q.value_text.replace("−","-").replaceAll(",",""))return false;
    const value:[number,number]=[q.value_start,q.value_end];
    if(!Array.isArray(q.unit_spans)||q.unit_spans.length<1||q.unit_spans.length>2
      ||!q.unit_spans.every(span=>Array.isArray(span)&&span.length===2&&offset(span[0])&&offset(span[1])&&span[1]>span[0]&&span[1]<=quote.length&&!overlaps(span,value))
      ||q.unit_spans.length===2&&overlaps(q.unit_spans[0],q.unit_spans[1])
      ||typeof q.unit!=="string"||Array.from(q.unit).length>64||q.unit_spans.map(([s,e])=>quote.slice(s,e).join("")).join(" ")!==q.unit)return false;
    if(q.period===null?q.period_start!==null||q.period_end!==null
      :!text(q.period,64)||!offset(q.period_start)||q.period_end!==q.period_start+Array.from(q.period).length
        ||quote.slice(q.period_start,q.period_end!).join("")!==q.period||overlaps([q.period_start,q.period_end!],value))return false;
    const figure=`${original.source.chunk_id}:${q.quote_start+q.value_start}:${q.quote_start+q.value_end}`;
    if(figures.has(figure))return false;
    figures.add(figure);quantities.set(q.quantity_id,q);used.add(q.citation_id);
  }
  let computed=0;const pairs=new Set<string>();
  for(const c of analysis.calculations) {
    const left=quantities.get(c?.left),right=quantities.get(c?.right);
    if(!c||!text(c.label,200)||!calculationOperations.includes(c.operation)||!Number.isInteger(c.precision)||c.precision<0||c.precision>18
      ||c.claim_state!=="REVIEW_REQUIRED"||!left||!right||!c.input||c.input.operation!==c.operation||c.input.precision!==c.precision
      ||!sameOperand(c.input.left,left)||!sameOperand(c.input.right,right)||pairs.has(`${c.operation}:${c.left}:${c.right}`))return false;
    pairs.add(`${c.operation}:${c.left}:${c.right}`);
    const unitsDiffer=SAME_UNIT.has(c.operation)&&left.unit!==right.unit;
    const zero=(c.operation==="DIVIDE"||c.operation==="RATIO")&&Number(right.value)===0||c.operation==="PERCENT_CHANGE"&&Number(left.value)===0;
    if(unitsDiffer||zero) {
      if(c.state!=="NOT_CALCULATED"||c.result!==null||c.reason!==(unitsDiffer?"UNITS_DIFFER":"DIVISION_BY_ZERO"))return false;
      continue;
    }
    const r=c.result,[a,b]=[left.value,right.value];
    const unit=c.operation==="MULTIPLY"?`${left.unit}*${right.unit}`:c.operation==="DIVIDE"||c.operation==="RATIO"?`${left.unit}/${right.unit}`:c.operation==="PERCENT_CHANGE"?"%":left.unit;
    const formula=c.operation==="ADD"?`${a}+${b}`:c.operation==="MULTIPLY"?`${a}*${b}`:c.operation==="DIVIDE"||c.operation==="RATIO"?`${a}/${b}`
      :c.operation==="PERCENT_CHANGE"?`((${b}-${a})/${a})*100`:`${a}-${b}`;
    if(c.state!=="CALCULATED"||c.reason!==null||!r||r.operation!==c.operation||r.precision!==c.precision||r.rounding!=="ROUND_HALF_EVEN"
      ||r.unit!==unit||r.formula!==formula||JSON.stringify(r.evidence_ids)!==JSON.stringify([...new Set([left.quantity_id,right.quantity_id])])
      ||typeof r.value!=="string"||!(c.precision?new RegExp(`^-?[0-9]+\\.[0-9]{${c.precision}}$`):/^-?[0-9]+$/).test(r.value))return false;
    computed++;
  }
  const rejected=new Set<string>();let quantityRejections=0,calculationRejections=0;
  for(const row of analysis.rejections) {
    const reasons:readonly string[]|undefined=row?calculationRejectionReasons[row.kind]:undefined;
    if(!row||!reasons||!reasons.includes(row.reason)||!Number.isSafeInteger(row.index)||row.index<0||row.index>=(row.kind==="QUANTITY"?12:6)
      ||rejected.has(`${row.kind}:${row.index}`))return false;
    rejected.add(`${row.kind}:${row.index}`);
    if(row.kind==="QUANTITY")quantityRejections++;else calculationRejections++;
  }
  if(analysis.quantities.length+quantityRejections>12||analysis.calculations.length+calculationRejections>6)return false;
  let receipts=0;
  for(const [i,doc] of analysis.documents.entries()) {
    if(!doc||doc.document_id!==snapshot[i].document_id||typeof doc.filename!=="string"||!Array.isArray(doc.consulted_sources))return false;
    receipts+=doc.consulted_sources.length;
    const state=analysis.quantities.some(q=>q.document_id===doc.document_id)?"QUANTITY_FOUND":doc.consulted_sources.length?"NO_QUANTITY_FOUND":"NO_INDEXED_EVIDENCE";
    if(doc.evidence_state!==state||!doc.consulted_sources.every(receipt=>receipt&&receipt.version_id===snapshot[i].version_id&&uuid(receipt.chunk_id)
      &&/^[a-f0-9]{64}$/.test(receipt.original_content_hash)&&Number.isSafeInteger(receipt.chunk_index)&&receipt.chunk_index>=0
      &&(receipt.page_number===null||Number.isSafeInteger(receipt.page_number)&&receipt.page_number>=0)))return false;
  }
  return receipts<=12&&result.sources.length===used.size&&result.sources.every(source=>analysis.documents.some(doc=>doc.document_id===source.document_id
    &&doc.consulted_sources.some(receipt=>receipt.version_id===source.version_id&&receipt.chunk_id===source.chunk_id&&receipt.original_content_hash===source.original_content_hash)))
    &&result.validated_citation_ids.length===used.size&&result.validated_citation_ids.every((id,i)=>id===result.sources[i].citation_id&&used.has(id))
    &&result.abstained===(computed===0)&&result.claim_state===(computed?"REVIEW_REQUIRED":"UNSUPPORTED");
}
