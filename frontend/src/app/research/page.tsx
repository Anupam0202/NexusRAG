"use client";

import { useEffect, useRef, useState } from "react";
import { Copy, FileSearch, Plus, RefreshCw, Save, X } from "lucide-react";
import Link from "@/components/layout/StaticLink";
import { AuthRequiredState } from "@/components/auth/AuthRequiredState";
import { createResearchPlan, getCurrentWorkspace, listResearchPlans, readResearchPlan } from "@/lib/api";
import { emptyResearchPlan, modeLabel, modeLimits, researchModes, type ResearchMode, type ResearchPlanInput, type ResearchPlanRecord } from "@/lib/research-plan";
import { useStore } from "@/hooks/useStore";
import { useDocuments } from "@/hooks/useDocuments";
import { CalculationTools } from "@/components/research/CalculationTools";
import { ResearchRuns } from "@/components/research/ResearchRuns";
import { normalizePassportSubject, passportSubjectFields } from "@/lib/product-passport-subject";

const control = "w-full min-w-0 rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-2 text-sm";
const button = "inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-medium disabled:opacity-50";
type LinesField = "subquestions" | "public_provider_ids" | "entity_scope" | "rights_constraints" | "expected_calculations" | "completion_criteria";
const fields: Array<[LinesField, string]> = [["subquestions", "Subquestions"], ["public_provider_ids", "Public provider IDs"],
  ["entity_scope", "Entity scope"], ["rights_constraints", "Rights constraints"], ["expected_calculations", "Expected calculations"], ["completion_criteria", "Completion criteria"]];

export default function ResearchPage() {
  const identity = useStore(state => JSON.stringify([state.authMode, state.authUser?.id, state.workspaceId]));
  return <ResearchWorkbench key={identity} />;
}
function ResearchWorkbench() {
  const authMode = useStore(state => state.authMode), userId = useStore(state => state.authUser?.id), workspaceId = useStore(state => state.workspaceId);
  const [draft, setDraft] = useState<ResearchPlanInput>(emptyResearchPlan);
  const [lines, setLines] = useState<Record<LinesField, string>>({ subquestions: "", public_provider_ids: "", entity_scope: "", rights_constraints: "", expected_calculations: "", completion_criteria: "" });
  const [items, setItems] = useState<ResearchPlanRecord[]>([]), [selected, setSelected] = useState<ResearchPlanRecord | null>(null);
  const [nextAfter, setNextAfter] = useState<string | null>(null), [role, setRole] = useState("viewer"), [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null), [reload, setReload] = useState(0);
  const [saving, setSaving] = useState(false);
  const [sourceSearch,setSourceSearch]=useState("");
  const pending = useRef(false), alive = useRef(true), sequence = useRef(0);
  const saveIdentity = useRef<{ body: string; key: string } | null>(null);
  const storedHeading = useRef<HTMLHeadingElement>(null);
  const { documents, loading: documentsLoading, error: documentError } = useDocuments();
  const context = { workspaceId, expectedUserId: authMode === "authenticated" ? userId ?? null : undefined };
  const canWrite = ["owner", "admin", "editor"].includes(role);
  const limits = modeLimits[draft.mode];
  const sourceQuery=sourceSearch.trim().toLocaleLowerCase();
  const matchingSourceIds=[...new Set(documents.filter(doc=>doc.status==="ready"&&doc.filename.toLocaleLowerCase().includes(sourceQuery)).map(doc=>doc.document_id))];
  const selectedMatches=matchingSourceIds.filter(id=>draft.private_source_ids.includes(id)).length;
  const allMatchesSelected=matchingSourceIds.length>0&&selectedMatches===matchingSourceIds.length;
  const matchingSelectionTooLarge=new Set([...draft.private_source_ids,...matchingSourceIds]).size>limits.max_sources;
  const bulkUnavailable=busy||!canWrite||documentsLoading||Boolean(documentError)||!matchingSourceIds.length;
  const visibleDocuments=documents.filter(doc=>doc.status==="ready"&&(draft.private_source_ids.includes(doc.document_id)
    ||doc.filename.toLocaleLowerCase().includes(sourceQuery)));
  function changeMatchingSources(checked:boolean) {
    if(bulkUnavailable)return;
    setDraft(current=>{
      const private_source_ids=checked?[...new Set([...current.private_source_ids,...matchingSourceIds])]:current.private_source_ids.filter(id=>!matchingSourceIds.includes(id));
      if(checked&&private_source_ids.length>modeLimits[current.mode].max_sources)return current;
      return {...current,private_source_ids};
    });
  }
  useEffect(() => { const counter = sequence; alive.current = true; return () => { alive.current = false; counter.current++; }; }, []);
  useEffect(() => {
    if (selected) { storedHeading.current?.focus({preventScroll: true}); storedHeading.current?.scrollIntoView?.({block: "start"}); }
  }, [selected]);
  useEffect(() => {
    if (authMode !== "authenticated" || !workspaceId) return;
    let current = true; setBusy(true); setError(null); setRole("viewer");
    Promise.all([listResearchPlans({ workspaceId, expectedUserId: userId ?? null }), getCurrentWorkspace({ workspaceId, expectedUserId: userId ?? null })])
      .then(([list, workspace]) => { if (current) { setItems(list.items); setNextAfter(list.next_after); setRole(workspace.role); } })
      .catch(error => { if (current) setError(error instanceof Error ? error.message : "Research plans are unavailable."); })
      .finally(() => { if (current) setBusy(false); });
    return () => { current = false; };
  }, [authMode, workspaceId, userId, reload]);
  async function operate(action: (current: () => boolean) => Promise<void>) {
    if (pending.current || busy || !workspaceId) return;
    pending.current = true; setBusy(true); setError(null);
    const operation = ++sequence.current;
    const current = () => alive.current && sequence.current === operation;
    try { await action(current); }
    catch (error) { if (current()) setError(error instanceof Error ? error.message : "Research plan operation failed."); }
    finally { if (current()) { pending.current = false; setBusy(false); } }
  }
  function newDraft(copy?: ResearchPlanInput) {
    const value = copy ? { ...copy, ...(copy.passport_subject ? {passport_subject:{...copy.passport_subject}} : {}), plan_id: crypto.randomUUID() } : emptyResearchPlan();
    setDraft(value); setLines(Object.fromEntries(fields.map(([key]) => [key, value[key].join("\n")])) as Record<LinesField, string>);
    setSelected(null); setError(null); setSourceSearch(""); saveIdentity.current = null;
  }
  const save = () => operate(async current => {
    const payload = { ...draft, ...Object.fromEntries(fields.map(([key]) => [key, lines[key].split("\n").map(value => value.trim()).filter(Boolean)])) } as ResearchPlanInput;
    if(Array.from(payload.question).length>10000) throw new Error("Question must contain at most 10000 characters.");
    if(payload.mode==="PRODUCT_PASSPORT") payload.passport_subject=normalizePassportSubject(payload.passport_subject);
    else delete payload.passport_subject;
    const body = JSON.stringify(payload);
    if (saveIdentity.current?.body !== body) saveIdentity.current = { body, key: crypto.randomUUID() };
    setSaving(true);
    try {
      const result = await createResearchPlan(payload, saveIdentity.current.key, context);
      if (current()) { setSelected(result); setItems(items => [result, ...items.filter(item => item.id !== result.id)]); }
    } finally { if (current()) setSaving(false); }
  });
  if (authMode !== "authenticated") return <AuthRequiredState authMode={authMode} nextPath="/research" title="Sign in to your research workspace" description="Research plans require a signed-in workspace." />;
  if (!workspaceId) return <AuthRequiredState authMode={authMode} nextPath="/research" title="Choose a research workspace" description="Select a workspace before opening research plans." />;
  return <div className="h-full overflow-y-auto px-4 py-6 md:px-8"><div className="mx-auto max-w-6xl">
    <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <h1 className="flex items-center gap-2 text-xl font-semibold"><FileSearch size={22} />Research plans</h1>
      <div className="flex flex-wrap gap-2"><Link href="/findings" className={button}>Findings &amp; reviews</Link>
        <button className={button} disabled={busy} onClick={() => setReload(value => value + 1)} title="Refresh research plans"><RefreshCw size={16} />Refresh</button>
        <button className={button} disabled={busy || !canWrite} onClick={() => newDraft()}><Plus size={16} />New plan</button></div>
    </header>
    {error && <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
    <div className="grid min-w-0 gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
      <aside aria-label="Saved research plans"><h2 className="mb-2 text-sm font-semibold">Saved plans</h2>
        {!items.length && <p className="text-sm text-[var(--text-muted)]">{busy ? "Loading plans..." : "No saved plans"}</p>}
        <ul>{items.map(item => <li key={item.id} className="border-b border-[var(--border)]">
          <button aria-label={`Open research plan: ${item.plan.question}`} className="w-full break-words px-2 py-3 text-left text-sm hover:bg-[var(--bg-hover)] disabled:opacity-50" disabled={busy}
            onClick={() => void operate(async current => { const value = await readResearchPlan(item.id, context); if (current()) setSelected(value); })}>
            <span className="block">{item.plan.question}</span><span className="text-xs text-[var(--text-muted)]">{modeLabel(item.plan.mode)}</span>
          </button></li>)}</ul>
        {nextAfter && <button className={`${button} mt-3 w-full`} disabled={busy} onClick={() => void operate(async current => {
          const page = await listResearchPlans(context, nextAfter); if (current()) { setItems(items => [...items, ...page.items.filter(item => !items.some(old => old.id === item.id))]); setNextAfter(page.next_after); }
        })}>Load more plans</button>}
      </aside>
      <section aria-label={selected ? "Stored research plan" : "Draft research plan"} className="min-w-0">
        {selected ? <><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 ref={storedHeading} tabIndex={-1} className="text-lg font-semibold break-words">{modeLabel(selected.plan.mode)}</h2>
          <button className={button} disabled={busy || !canWrite} onClick={() => newDraft(selected.plan)}><Copy size={16} />Copy to a new plan</button></div>
          <p role="status" className="mb-4 text-sm text-emerald-700 dark:text-emerald-300">{selected.plan.mode==="CALCULATION"?"Saved plan. Calculations are tracked separately.":"Saved plan. Executions are tracked separately."}</p>
          <p className="mb-4 whitespace-pre-wrap break-words">{selected.plan.question}</p>
          {selected.plan.mode==="PRODUCT_PASSPORT"&&<section aria-label="Declared product" className="mb-4 min-w-0 border-y border-[var(--border)] py-3">
            <h3 className="mb-2 text-sm font-semibold">Declared product</h3>
            {selected.plan.passport_subject?<dl className="grid min-w-0 gap-3 sm:grid-cols-2">{passportSubjectFields.map(([key,label])=><div key={key} className="min-w-0"><dt className="text-xs text-[var(--text-muted)]">{label}</dt>
              <dd className="mt-1 whitespace-pre-wrap break-words text-sm [overflow-wrap:anywhere]">{selected.plan.passport_subject![key]}</dd></div>)}</dl>:<p className="text-sm text-[var(--text-muted)]">Product identity not recorded</p>}
          </section>}
          <details open={selected.plan.mode!=="CALCULATION"} className="mb-4"><summary className="mb-3 cursor-pointer text-sm font-semibold">Plan details</summary>
          <dl className="grid min-w-0 gap-4 sm:grid-cols-2">{fields.map(([key, label]) => <div key={key}><dt className="text-xs font-semibold text-[var(--text-muted)]">{label}</dt>
            <dd className="mt-1 whitespace-pre-wrap break-words text-sm">{selected.plan[key].join("\n") || "-"}</dd></div>)}
            {[["Private source IDs", selected.plan.private_source_ids.join("\n")], ["Start date", selected.plan.date_from], ["End date", selected.plan.date_to], ["Jurisdiction", selected.plan.jurisdiction]].map(([label, value]) =>
              <div key={label}><dt className="text-xs font-semibold text-[var(--text-muted)]">{label}</dt><dd className="mt-1 whitespace-pre-wrap break-words text-sm">{value || "-"}</dd></div>)}
          </dl></details>
          {selected.plan.mode==="CALCULATION" && <CalculationTools key={selected.id} planId={selected.id} workspaceId={workspaceId} userId={userId!} canWrite={canWrite} documents={documents} privateSourceIds={selected.plan.private_source_ids}/>}
          {selected.plan.mode!=="CALCULATION" && <ResearchRuns key={selected.id} plan={selected} workspaceId={workspaceId} userId={userId!} canWrite={canWrite}/>}
          </> : <form onSubmit={event => { event.preventDefault(); if (canWrite && !busy) void save(); }} className="space-y-4">
          <div className="grid min-w-0 gap-4 sm:grid-cols-2"><label className="text-sm">Mode<select aria-label="Mode" className={`${control} mt-1`} value={draft.mode} disabled={busy || !canWrite}
            onChange={event => setDraft({ ...draft, mode: event.target.value as ResearchMode })}>{researchModes.map(mode => <option key={mode} value={mode}>{modeLabel(mode)}</option>)}</select></label>
            <label className="text-sm">Jurisdiction<input aria-label="Jurisdiction" className={`${control} mt-1`} value={draft.jurisdiction || ""} maxLength={128} disabled={busy || !canWrite} onChange={event => setDraft({ ...draft, jurisdiction: event.target.value || null })} /></label></div>
          <label className="block text-sm">Question<textarea aria-label="Question" required rows={3} maxLength={20000} className={`${control} mt-1`} value={draft.question} disabled={busy || !canWrite} onChange={event => setDraft({ ...draft, question: event.target.value })} /></label>
          {draft.mode==="PRODUCT_PASSPORT"&&<fieldset className="min-w-0 border-y border-[var(--border)] py-3"><legend className="text-sm font-semibold">Declared product</legend>
            <div className="grid min-w-0 gap-4 sm:grid-cols-2">{passportSubjectFields.map(([key,label,maximum])=><label key={key} className="min-w-0 text-sm">{label}<input required aria-label={label} maxLength={maximum*2} className={`${control} mt-1`}
              value={draft.passport_subject?.[key]||""} disabled={busy||!canWrite} onChange={event=>setDraft({...draft,passport_subject:{product_id:"",product_name:"",product_version:"",supplier:"",...draft.passport_subject,[key]:event.target.value}})}/></label>)}</div>
          </fieldset>}
          <fieldset className="rounded-lg border border-[var(--border)] p-3"><legend className="px-1 text-sm">Private documents</legend>
            <input aria-label="Find private documents" type="search" placeholder="Search documents" className={`${control} mb-2`} value={sourceSearch}
              disabled={busy} onChange={event=>setSourceSearch(event.target.value)} onKeyDown={event=>{if(event.key==="Enter")event.preventDefault();}}/>
            <div className="mb-2 flex min-h-8 flex-wrap items-center justify-between gap-2">
              <label className="flex min-h-8 items-center gap-2 text-sm"><input type="checkbox" aria-label="Select matching documents" aria-controls="available-private-documents" aria-describedby="private-document-selection-count"
                ref={element=>{if(element)element.indeterminate=selectedMatches>0&&!allMatchesSelected;}} checked={allMatchesSelected}
                disabled={bulkUnavailable||(!allMatchesSelected&&matchingSelectionTooLarge)}
                title={matchingSourceIds.length>0&&!allMatchesSelected&&matchingSelectionTooLarge?`Selecting all matching documents would exceed the ${limits.max_sources}-source limit.`:undefined}
                onChange={event=>changeMatchingSources(event.target.checked)}/><span>Select matching documents</span></label>
              <button type="button" aria-label="Clear matching selection" title="Clear matching selection" className={`${button} h-8 w-8 p-0`}
                disabled={bulkUnavailable||selectedMatches===0} onClick={()=>changeMatchingSources(false)}><X size={14}/></button>
              <span id="private-document-selection-count" className="w-full text-xs text-[var(--text-muted)]">{matchingSourceIds.length} matching / <span>{draft.private_source_ids.length} selected / {limits.max_sources} limit</span></span>
            </div>
            {documentError && <p role="alert" className="text-sm text-red-600">{documentError}</p>}
            {!documents.length && <p className="text-sm text-[var(--text-muted)]">{documentsLoading ? "Loading documents..." : "No documents"}</p>}
            {documents.length>0&&!visibleDocuments.length&&!draft.private_source_ids.length&&<p className="text-sm text-[var(--text-muted)]">No matching documents</p>}
            <div id="available-private-documents" aria-label="Available private documents" role="region" tabIndex={0} className="max-h-64 overflow-y-auto overscroll-contain">
            {draft.private_source_ids.filter(id => !documents.some(doc => doc.document_id === id && doc.status === "ready")).map(id => <label key={id} className="flex items-start gap-2 py-1 text-sm"><input type="checkbox" className="mt-1" checked disabled={busy || !canWrite}
              onChange={() => setDraft({ ...draft, private_source_ids: draft.private_source_ids.filter(source => source !== id) })} /><span className="break-all">{id} (not currently available)</span></label>)}
            {visibleDocuments.map(doc => <label key={doc.document_id} className="flex items-start gap-2 py-1 text-sm"><input type="checkbox" className="mt-1" checked={draft.private_source_ids.includes(doc.document_id)} disabled={busy || !canWrite}
              onChange={event => setDraft({ ...draft, private_source_ids: event.target.checked ? [...draft.private_source_ids, doc.document_id] : draft.private_source_ids.filter(id => id !== doc.document_id) })} /><span className="break-all">{doc.filename}</span></label>)}
            </div></fieldset>
          <div className="grid min-w-0 gap-4 sm:grid-cols-2">{(["date_from", "date_to"] as const).map(key => <label key={key} className="text-sm">{key === "date_from" ? "Start date" : "End date"}<input aria-label={key === "date_from" ? "Start date" : "End date"} type="date" className={`${control} mt-1`} value={draft[key] || ""} disabled={busy || !canWrite} onChange={event => setDraft({ ...draft, [key]: event.target.value || null })} /></label>)}</div>
          <div className="grid min-w-0 gap-4 sm:grid-cols-2">{fields.map(([key, label]) => <label key={key} className="text-sm">{label}<textarea aria-label={label} rows={3} required={key === "completion_criteria"} className={`${control} mt-1`} value={lines[key]} disabled={busy || !canWrite} onChange={event => setLines({ ...lines, [key]: event.target.value })} /></label>)}</div>
          <div className="flex flex-wrap items-center justify-between gap-3"><span className="text-xs text-[var(--text-muted)]">{limits.max_subquestions} subquestions / {limits.max_sources} sources</span>
            <button type="submit" className={button} disabled={busy || !canWrite}><Save size={16} />{saving ? "Saving..." : "Save plan"}</button></div>
        </form>}
      </section>
    </div>
  </div></div>;
}
