"use client";

import { useEffect, useRef, useState } from "react";
import { Copy, FileSearch, Plus, RefreshCw, Save } from "lucide-react";
import Link from "@/components/layout/StaticLink";
import { AuthRequiredState } from "@/components/auth/AuthRequiredState";
import { createResearchPlan, getCurrentWorkspace, listResearchPlans, readResearchPlan } from "@/lib/api";
import { emptyResearchPlan, modeLabel, modeLimits, researchModes, type ResearchMode, type ResearchPlanInput, type ResearchPlanRecord } from "@/lib/research-plan";
import { useStore } from "@/hooks/useStore";
import { useDocuments } from "@/hooks/useDocuments";

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
  const pending = useRef(false), alive = useRef(true), sequence = useRef(0);
  const saveIdentity = useRef<{ body: string; key: string } | null>(null);
  const storedHeading = useRef<HTMLHeadingElement>(null);
  const { documents, loading: documentsLoading, error: documentError } = useDocuments();
  const context = { workspaceId, expectedUserId: authMode === "authenticated" ? userId ?? null : undefined };
  const canWrite = ["owner", "admin", "editor"].includes(role);
  const limits = modeLimits[draft.mode];
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
    const value = copy ? { ...copy, plan_id: crypto.randomUUID() } : emptyResearchPlan();
    setDraft(value); setLines(Object.fromEntries(fields.map(([key]) => [key, value[key].join("\n")])) as Record<LinesField, string>);
    setSelected(null); setError(null); saveIdentity.current = null;
  }
  const save = () => operate(async current => {
    const payload = { ...draft, ...Object.fromEntries(fields.map(([key]) => [key, lines[key].split("\n").map(value => value.trim()).filter(Boolean)])) } as ResearchPlanInput;
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
          <p role="status" className="mb-4 text-sm text-emerald-700 dark:text-emerald-300">Saved draft. Execution has not started.</p>
          <p className="mb-4 whitespace-pre-wrap break-words">{selected.plan.question}</p>
          <dl className="grid min-w-0 gap-4 sm:grid-cols-2">{fields.map(([key, label]) => <div key={key}><dt className="text-xs font-semibold text-[var(--text-muted)]">{label}</dt>
            <dd className="mt-1 whitespace-pre-wrap break-words text-sm">{selected.plan[key].join("\n") || "-"}</dd></div>)}
            {[["Private source IDs", selected.plan.private_source_ids.join("\n")], ["Start date", selected.plan.date_from], ["End date", selected.plan.date_to], ["Jurisdiction", selected.plan.jurisdiction]].map(([label, value]) =>
              <div key={label}><dt className="text-xs font-semibold text-[var(--text-muted)]">{label}</dt><dd className="mt-1 whitespace-pre-wrap break-words text-sm">{value || "-"}</dd></div>)}
          </dl></> : <form onSubmit={event => { event.preventDefault(); if (canWrite && !busy) void save(); }} className="space-y-4">
          <div className="grid min-w-0 gap-4 sm:grid-cols-2"><label className="text-sm">Mode<select aria-label="Mode" className={`${control} mt-1`} value={draft.mode} disabled={busy || !canWrite}
            onChange={event => setDraft({ ...draft, mode: event.target.value as ResearchMode })}>{researchModes.map(mode => <option key={mode} value={mode}>{modeLabel(mode)}</option>)}</select></label>
            <label className="text-sm">Jurisdiction<input aria-label="Jurisdiction" className={`${control} mt-1`} value={draft.jurisdiction || ""} maxLength={128} disabled={busy || !canWrite} onChange={event => setDraft({ ...draft, jurisdiction: event.target.value || null })} /></label></div>
          <label className="block text-sm">Question<textarea aria-label="Question" required rows={3} maxLength={10000} className={`${control} mt-1`} value={draft.question} disabled={busy || !canWrite} onChange={event => setDraft({ ...draft, question: event.target.value })} /></label>
          <fieldset className="rounded-lg border border-[var(--border)] p-3"><legend className="px-1 text-sm">Private documents</legend>
            {documentError && <p role="alert" className="text-sm text-red-600">{documentError}</p>}
            {!documents.length && <p className="text-sm text-[var(--text-muted)]">{documentsLoading ? "Loading documents..." : "No documents"}</p>}
            {draft.private_source_ids.filter(id => !documents.some(doc => doc.document_id === id && doc.status === "ready")).map(id => <label key={id} className="flex items-start gap-2 py-1 text-sm"><input type="checkbox" className="mt-1" checked disabled={busy || !canWrite}
              onChange={() => setDraft({ ...draft, private_source_ids: draft.private_source_ids.filter(source => source !== id) })} /><span className="break-all">{id} (not currently available)</span></label>)}
            {documents.filter(doc => doc.status === "ready").map(doc => <label key={doc.document_id} className="flex items-start gap-2 py-1 text-sm"><input type="checkbox" className="mt-1" checked={draft.private_source_ids.includes(doc.document_id)} disabled={busy || !canWrite}
              onChange={event => setDraft({ ...draft, private_source_ids: event.target.checked ? [...draft.private_source_ids, doc.document_id] : draft.private_source_ids.filter(id => id !== doc.document_id) })} /><span className="break-all">{doc.filename}</span></label>)}</fieldset>
          <div className="grid min-w-0 gap-4 sm:grid-cols-2">{(["date_from", "date_to"] as const).map(key => <label key={key} className="text-sm">{key === "date_from" ? "Start date" : "End date"}<input aria-label={key === "date_from" ? "Start date" : "End date"} type="date" className={`${control} mt-1`} value={draft[key] || ""} disabled={busy || !canWrite} onChange={event => setDraft({ ...draft, [key]: event.target.value || null })} /></label>)}</div>
          <div className="grid min-w-0 gap-4 sm:grid-cols-2">{fields.map(([key, label]) => <label key={key} className="text-sm">{label}<textarea aria-label={label} rows={3} required={key === "completion_criteria"} className={`${control} mt-1`} value={lines[key]} disabled={busy || !canWrite} onChange={event => setLines({ ...lines, [key]: event.target.value })} /></label>)}</div>
          <div className="flex flex-wrap items-center justify-between gap-3"><span className="text-xs text-[var(--text-muted)]">{limits.max_subquestions} subquestions / {limits.max_sources} sources</span>
            <button type="submit" className={button} disabled={busy || !canWrite}><Save size={16} />{saving ? "Saving..." : "Save plan"}</button></div>
        </form>}
      </section>
    </div>
  </div></div>;
}
