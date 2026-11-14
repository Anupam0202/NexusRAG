"use client";
import {useState} from "react";
import {ArrowLeftRight,Calculator,Sigma} from "lucide-react";
import {CalculationWorksheet} from "./CalculationWorksheet";
import {AggregationWorksheet} from "./AggregationWorksheet";
import {ConversionWorksheet} from "./ConversionWorksheet";
import {SourceQuantities} from "./SourceQuantities";
import type {QuantityCaptureRecord} from "@/lib/research-quantity";
import type {DocumentMetadata} from "@/types";

export function CalculationTools(props:{planId:string;workspaceId:string;userId:string;canWrite:boolean;documents?:DocumentMetadata[];privateSourceIds?:string[]}) {
  const [mode,setMode]=useState("pair");
  const [captures,setCaptures]=useState<QuantityCaptureRecord[]>([]);
  return <div className="mt-6 min-w-0"><details className="mb-5"><summary className="cursor-pointer text-sm font-semibold">Capture quantities from source evidence</summary>
    <SourceQuantities {...props} documents={props.documents??[]} privateSourceIds={props.privateSourceIds??[]} onRecords={setCaptures}/></details>
    <fieldset className="inline-flex max-w-full rounded-lg border border-[var(--border)] p-1">
    <legend className="sr-only">Calculation type</legend>
    {[{id:"pair",label:"Pair",Icon:Calculator},{id:"series",label:"Series",Icon:Sigma},{id:"conversion",label:"Convert",Icon:ArrowLeftRight}].map(({id,label,Icon})=><label key={id}
      className={`relative flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm ${mode===id?"bg-[var(--bg-hover)] font-semibold":""}`}>
      <input type="radio" name={`calculation-type-${props.planId}`} value={id} checked={mode===id} onChange={()=>setMode(id)} className="peer absolute inset-0 m-0 h-full w-full cursor-pointer opacity-0"/>
      <span className="pointer-events-none absolute inset-0 rounded-md peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2"/>
      <Icon size={16}/>{label}</label>)}</fieldset>
    <div hidden={mode!=="pair"}><CalculationWorksheet {...props} captures={captures}/></div>
    <div hidden={mode!=="series"}><AggregationWorksheet {...props} captures={captures}/></div>
    <div hidden={mode!=="conversion"}><ConversionWorksheet {...props} captures={captures}/></div>
  </div>;
}
