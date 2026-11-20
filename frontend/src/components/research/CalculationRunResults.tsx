"use client";
import type {CalculationOperation,CalculationQuantity,ResearchCalculationRun} from "@/lib/research-calculation-run";

const operations:Record<CalculationOperation,string>={ADD:"Sum",SUBTRACT:"Difference",DIFFERENCE:"Difference",MULTIPLY:"Product",
  DIVIDE:"Quotient",RATIO:"Ratio",PERCENT_CHANGE:"Percent change"};
const setAside:Record<string,string>={
  INVALID_QUANTITY:"A proposed figure was incomplete.",
  UNCONFIRMED_SOURCE_ANCHOR:"A proposed figure's passage is not in the sources read.",
  VALUE_NOT_IN_QUOTE:"A proposed number is not written, as a whole number, in its passage.",
  UNIT_NOT_IN_QUOTE:"A proposed unit is not written in its passage.",
  PERIOD_NOT_IN_QUOTE:"A proposed period is not written in its passage.",
  REPEATED_QUANTITY:"A figure was proposed twice.",
  INVALID_CALCULATION:"A proposed calculation was incomplete or named an unknown operation.",
  QUANTITY_UNAVAILABLE:"A proposed calculation used a figure that was set aside.",
  REPEATED_CALCULATION:"A calculation was proposed twice.",
};

/** The passage with the figure marked, its unit underlined and its period in italics. */
function MarkedPassage({quantity}:{quantity:CalculationQuantity}) {
  const kind=(i:number)=>i>=quantity.value_start&&i<quantity.value_end?"value":quantity.unit_spans.some(([s,e])=>i>=s&&i<e)?"unit"
    :quantity.period_start!==null&&quantity.period_end!==null&&i>=quantity.period_start&&i<quantity.period_end?"period":"text";
  const parts:Array<{kind:string;text:string}>=[];
  Array.from(quantity.quote).forEach((character,i)=>{
    const current=kind(i),last=parts.at(-1);
    if(last&&last.kind===current)last.text+=character;else parts.push({kind:current,text:character});
  });
  return <>{parts.map((part,i)=>part.kind==="value"?<mark key={i}>{part.text}</mark>:part.kind==="unit"?<u key={i}>{part.text}</u>
    :part.kind==="period"?<em key={i}>{part.text}</em>:<span key={i}>{part.text}</span>)}</>;
}
function Figure({quantity,sourcePrefix}:{quantity:CalculationQuantity;sourcePrefix?:string}) {
  return <div className="min-w-0 rounded-lg border border-[var(--border)] p-2">
    <p className="break-words"><span className="font-medium">{quantity.quantity_id}</span> {quantity.label}: <span className="font-mono">{quantity.value_text}</span> {quantity.unit}{quantity.period?` (${quantity.period})`:""}</p>
    <blockquote className="mt-1 whitespace-pre-wrap break-words text-xs"><MarkedPassage quantity={quantity}/>{" "}
      {sourcePrefix?<a className="underline" href={`#${sourcePrefix}-${quantity.citation_id}`}>[{quantity.citation_id}]</a>:<span>[{quantity.citation_id}]</span>}</blockquote>
    {quantity.period===null&&<p className="mt-1 text-xs text-[var(--text-muted)]">The passage does not say which period this figure is for.</p>}
  </div>;
}

export function CalculationRunResults({analysis,sourcePrefix}:{analysis:ResearchCalculationRun;sourcePrefix?:string}) {
  const figures=new Map(analysis.quantities.map(quantity=>[quantity.quantity_id,quantity]));
  const computed=analysis.calculations.filter(calculation=>calculation.state==="CALCULATED").length;
  const unused=analysis.quantities.filter(quantity=>!analysis.calculations.some(c=>c.left===quantity.quantity_id||c.right===quantity.quantity_id));
  return <section aria-label="Calculations" className="mb-4 min-w-0 space-y-3 text-sm">
    <p className="font-medium">{computed} of {analysis.calculations.length} {analysis.calculations.length===1?"calculation":"calculations"} computed / check every figure against its source</p>
    <p className="text-xs text-[var(--text-muted)]">Gemini only located the figures in the documents. Each result was computed exactly from the figures shown and rounded half to even; units and currencies are never converted.</p>
    {!analysis.calculations.length&&<p>{analysis.quantities.length?"Figures were found, but no calculation was proposed from them."
      :"No figures for this question were found in the passages read. This does not show that the documents do not contain them."}</p>}
    <ol className="min-w-0 divide-y divide-[var(--border)]">{analysis.calculations.map((calculation,i)=>{
      const left=figures.get(calculation.left)!,right=figures.get(calculation.right)!;
      return <li key={i} className="min-w-0 space-y-2 py-3">
        <p className="break-words font-medium">{i+1}. {calculation.label}</p>
        {calculation.state==="CALCULATED"&&calculation.result
          ?<p className="break-words"><span className="font-mono">{calculation.result.formula} = {calculation.result.value}</span> {calculation.result.unit}</p>
          :<p className="break-words text-amber-700 dark:text-amber-300">Not calculated: {calculation.reason==="UNITS_DIFFER"
            ?`the units differ (${left.unit}; ${right.unit}), and figures are never converted.`:"it would divide by zero."}</p>}
        <p className="text-xs text-[var(--text-muted)]">{operations[calculation.operation]} / {calculation.precision} decimal {calculation.precision===1?"place":"places"}, rounded half to even</p>
        <div className="grid min-w-0 gap-2 sm:grid-cols-2"><Figure quantity={left} sourcePrefix={sourcePrefix}/><Figure quantity={right} sourcePrefix={sourcePrefix}/></div>
      </li>;
    })}</ol>
    {unused.length>0&&<div className="space-y-2"><h6 className="font-medium">Other figures found</h6>
      {unused.map(quantity=><Figure key={quantity.quantity_id} quantity={quantity} sourcePrefix={sourcePrefix}/>)}</div>}
    {analysis.rejections.length>0&&<details><summary className="cursor-pointer text-amber-700 dark:text-amber-300">{analysis.rejections.length} {analysis.rejections.length===1?"proposal":"proposals"} set aside</summary>
      <ul className="list-disc space-y-1 break-words pl-5">{analysis.rejections.map((row,i)=><li key={i}>{setAside[row.reason]||row.reason}</li>)}</ul></details>}
    <details><summary className="cursor-pointer font-medium">Documents read ({analysis.documents.length})</summary>
      <ul className="min-w-0 divide-y divide-[var(--border)]">{analysis.documents.map(doc=><li key={doc.document_id} className="min-w-0 space-y-1 break-words py-2">
        <p className="font-medium">{doc.filename}</p><p className="text-xs text-[var(--text-muted)]">{doc.evidence_state==="QUANTITY_FOUND"?"Figures quoted from it"
          :doc.evidence_state==="NO_INDEXED_EVIDENCE"?"No passage matched the question":"Read; no figure quoted"} / {doc.consulted_sources.length} {doc.consulted_sources.length===1?"passage":"passages"} read</p>
      </li>)}</ul>
    </details>
  </section>;
}
