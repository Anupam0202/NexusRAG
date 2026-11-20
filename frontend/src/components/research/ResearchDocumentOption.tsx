"use client";
import { memo } from "react";

export const ResearchDocumentOption=memo(function ResearchDocumentOption({document,checked,disabled,onSelectionChange}:{
  document:{document_id:string;filename:string};checked:boolean;disabled:boolean;onSelectionChange:(id:string,checked:boolean)=>void;
}) {
  return <label className="flex items-start gap-2 py-1 text-sm">
    <input type="checkbox" className="mt-1" checked={checked} disabled={disabled} onChange={event=>onSelectionChange(document.document_id,event.currentTarget.checked)}/>
    <span className="break-all">{document.filename}</span>
  </label>;
});
