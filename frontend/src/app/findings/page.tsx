"use client";

import { useEffect, useRef, useState } from "react";
import { FileCheck2, RefreshCw } from "lucide-react";
import {
  createFinding, editFinding, exportFinding, listFindings, readFinding,
  removeFinding, reviewFinding, shareFinding, unshareFinding, getCurrentWorkspace, listCurrentWorkspaceMembers,
  type FindingDetail, type FindingSummary,
} from "@/lib/api";
import { useStore } from "@/hooks/useStore";
import { AuthRequiredState } from "@/components/auth/AuthRequiredState";
import type { WorkspaceRole, WorkspaceMember } from "@/types";

const control = "w-full rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-2 text-sm";
const button = "rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-medium disabled:opacity-50";

export default function FindingsPage() {
  const identity = useStore(state => JSON.stringify([state.authMode, state.authUser?.id, state.workspaceId]));
  return <FindingsWorkbench key={identity} />;
}

function FindingsWorkbench() {
  const authMode = useStore(state => state.authMode);
  const userId = useStore(state => state.authUser?.id);
  const workspaceId = useStore(state => state.workspaceId);
  const identity = `${userId}:${workspaceId}`;
  const activeIdentity = useRef(identity);
  const [items, setItems] = useState<FindingSummary[]>([]);
  const [selected, setSelected] = useState<FindingDetail | null>(null);
  const [role, setRole] = useState<WorkspaceRole>("viewer");
  const [title, setTitle] = useState("");
  const [markdown, setMarkdown] = useState("");
  const [reviewComment, setReviewComment] = useState("");
  const [shareUserId, setShareUserId] = useState("");
  const [sharePermission, setSharePermission] = useState<"read" | "contribute">("contribute");
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [memberAfter, setMemberAfter] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [nextAfter, setNextAfter] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const createKey = useRef<string | null>(null);
  const canWrite = ["owner", "admin", "editor"].includes(role);
  const canEdit = canWrite && (!selected || selected.permission !== "read");
  const expectedUserId = authMode === "authenticated" ? userId ?? null : undefined;
  const context = { workspaceId, expectedUserId };

  useEffect(() => {
    let active = true;
    activeIdentity.current = identity;
    setItems([]); setSelected(null); setTitle(""); setMarkdown(""); setError(null);
    setRole("viewer"); setMembers([]); setMemberAfter(null); setNextAfter(null); createKey.current = null;
    if (authMode !== "authenticated" || !workspaceId) return;
    setBusy(true);
    Promise.all([listFindings({ workspaceId, expectedUserId }), getCurrentWorkspace({ workspaceId, expectedUserId }), listCurrentWorkspaceMembers({ workspaceId, expectedUserId })])
      .then(([response, workspace, membership]) => {
        if (!active) return;
        setItems(response.items); setNextAfter(response.next_after); setRole(workspace.role); setMembers(membership.members); setMemberAfter(membership.next_after ?? null);
      })
      .catch(error => { if (active) setError(error instanceof Error ? error.message : "Unable to load findings."); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; activeIdentity.current = ""; };
  }, [authMode, userId, workspaceId, identity, reload, expectedUserId]);

  async function operate(action: () => Promise<void>) {
    if (busy || !workspaceId) return;
    const initiatingIdentity = identity;
    setBusy(true); setError(null);
    try { await action(); }
    catch (error) { if (activeIdentity.current === initiatingIdentity)
      setError(error instanceof Error ? error.message : "The operation failed."); }
    finally { if (activeIdentity.current === initiatingIdentity) setBusy(false); }
  }
  function current() { return activeIdentity.current === identity; }
  async function select(id: string) {
    const finding = await readFinding(id, context);
    if (!current()) return;
    setSelected(finding); setTitle(finding.title); setMarkdown(finding.authored_markdown);
    setReviewComment(""); setShareUserId("");
  }
  async function save() {
    if (selected) {
      await editFinding(selected.id, { title, authored_markdown: markdown, revision: selected.revision }, context);
      if (current()) await select(selected.id);
    } else {
      createKey.current ??= crypto.randomUUID();
      const created = await createFinding({ title, authored_markdown: markdown }, createKey.current, context);
      if (!current()) return;
      createKey.current = null;
      await select(created.id);
    }
    const response = await listFindings(context);
    if (current()) { setItems(response.items); setNextAfter(response.next_after); }
  }
  async function download() {
    if (!selected) return;
    const exported = await exportFinding(selected.id, context);
    if (!current()) return;
    const blob = new Blob([JSON.stringify(exported, null, 2)], { type: "application/ld+json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = `finding-${selected.id}-r${selected.revision}.jsonld`;
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  if (authMode !== "authenticated") return <div className="p-6">
    <AuthRequiredState authMode={authMode} nextPath="/findings" title="Sign in to your evidence workbench" />
  </div>;
  if (!workspaceId) return <p className="p-6" role="status">Select or create a workspace to continue.</p>;

  return <div className="h-full overflow-y-auto p-4 md:p-8" role="region" aria-label="Findings workbench" tabIndex={0}>
    <div className="mx-auto max-w-6xl">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="flex items-center gap-2 text-2xl font-bold"><FileCheck2 /> Findings & Reviews</h1>
          <p className="mt-2 text-sm text-[var(--text-muted)]">Private, versioned findings. Share explicitly with workspace members for independent review.</p></div>
        <button className={button} disabled={busy} onClick={() => setReload(value => value + 1)}><RefreshCw size={14} className="mr-2 inline" />Reload</button>
      </div>
      {error && <p role="alert" className="mb-4 rounded-lg border border-red-400/40 p-3 text-sm text-red-600">{error}</p>}
      {busy && <p role="status" className="mb-3 text-sm">Working…</p>}
      <div className="grid items-start gap-5 md:grid-cols-[minmax(200px,1fr)_minmax(0,2fr)]">
        <section className="rounded-xl border border-[var(--border)] p-4" aria-label="Saved findings">
          <h2 className="mb-3 font-semibold">Your accessible findings</h2>
          <button className={`${button} mb-4 w-full`} disabled={busy || !canWrite} onClick={() => {
            setSelected(null); setTitle(""); setMarkdown(""); createKey.current = null;
          }}>New finding</button>
          {!items.length && !busy && <p className="text-sm text-[var(--text-muted)]">No findings yet. Create a note or ask its owner to share one.</p>}
          <ul className="space-y-2">{items.map(item => <li key={item.id}>
            <button className={`${button} w-full text-left ${selected?.id === item.id ? "bg-brand-500/10" : ""}`}
              aria-pressed={selected?.id === item.id} disabled={busy} onClick={() => void operate(() => select(item.id))}>
              <span className="block break-words">{item.title}</span><span className="text-xs text-[var(--text-muted)]">Revision {item.revision}</span>
            </button></li>)}</ul>
          {nextAfter && <button className={`${button} mt-3`} disabled={busy} onClick={() => void operate(async () => {
            const response = await listFindings(context, nextAfter);
            if (current()) { setItems(previous => [...previous, ...response.items]); setNextAfter(response.next_after); }
          })}>Load more</button>}
        </section>
        <section className="space-y-4 rounded-xl border border-[var(--border)] p-4" aria-label="Finding editor">
          <h2 className="font-semibold">{selected ? `Revision ${selected.revision} · ${selected.permission}` : "New private finding"}</h2>
          <label className="block text-sm">Title<input className={`${control} mt-1`} value={title} maxLength={160} disabled={busy || !canEdit}
            onChange={event => { setTitle(event.target.value); createKey.current = null; }} /></label>
          <label className="block text-sm">Authored finding<textarea className={`${control} mt-1 min-h-48`} value={markdown} maxLength={50000}
            disabled={busy || !canEdit} onChange={event => { setMarkdown(event.target.value); createKey.current = null; }} /></label>
          <p className="text-xs text-[var(--text-muted)]">Authored notes are not automatically verified claims. Approval requires a different author and an explicit reviewer.</p>
          <div className="flex flex-wrap gap-2">
            <button className={`${button} bg-brand-600 text-white`} disabled={busy || !canEdit || !title.trim()}
              onClick={() => void operate(save)}>Save finding</button>
            {selected && <button className={button} disabled={busy || !canWrite || !!selected.source_run_id}
              onClick={() => void operate(download)}>Export JSON-LD & receipt</button>}
            {selected?.permission === "owner" && <button className={button} disabled={busy} onClick={() => {
              if (!window.confirm("Delete and redact this finding and its version text?")) return;
              void operate(async () => { await removeFinding(selected.id, context); if (current()) setReload(value => value + 1); });
            }}>Delete finding</button>}
          </div>
          {selected && <><section aria-label="Evidence and reviews" className="space-y-2 border-t border-[var(--border)] pt-4">
            <h3 className="font-semibold">Evidence & review history</h3>
            {selected.source_unavailable && <p role="alert">Source evidence is unavailable. Generated content is withheld.</p>}
            <p className="text-sm">{selected.evidence.length} source excerpts · {selected.reviews.length} reviews of this revision</p>
            {selected.generated_markdown && <p className="whitespace-pre-wrap text-sm">{selected.generated_markdown}</p>}
            {selected.evidence.map(item => <blockquote key={item.id} className="border-l-2 border-brand-400 pl-3 text-sm">
              {item.available ? item.original_text : "Source unavailable"}<p className="text-xs">{item.freshness} · {item.version_id}</p></blockquote>)}
            {selected.reviews.map(item => <p key={item.reviewer_id} className="break-words text-sm">{item.decision}: {item.comment}</p>)}
          </section>
          {canEdit && <section className="space-y-2" aria-label="Independent review">
            <label className="block text-sm">Review comment<textarea className={control} value={reviewComment} maxLength={4000}
              onChange={event => setReviewComment(event.target.value)} disabled={busy} /></label>
            <div className="flex gap-2">{(["approved", "changes_requested"] as const).map(decision =>
              <button key={decision} className={button} disabled={busy || !selected.author_id || selected.author_id === userId} onClick={() => void operate(async () => {
                const reviewed = await reviewFinding(selected.id, { revision: selected.revision, decision, comment: reviewComment }, context);
                if (current()) setSelected(reviewed);
              })}>{decision === "approved" ? "Approve revision" : "Request changes"}</button>)}</div>
            <p className="text-xs text-[var(--text-muted)]">The database rejects self-review and stale revisions.</p>
          </section>}
          {selected.permission === "owner" && <section className="space-y-2" aria-label="Share finding">
            <label className="block text-sm">Workspace member<select className={control} value={shareUserId}
              onChange={event => setShareUserId(event.target.value)} disabled={busy}>
              <option value="">Choose a member</option>
              {members.filter(member => member.user_id !== userId).map(member => <option key={member.user_id} value={member.user_id}>
                {member.display_name || member.user_id} · {member.role}
              </option>)}
            </select></label>
            <label className="block text-sm">Finding permission<select className={control} value={sharePermission}
              onChange={event => setSharePermission(event.target.value as "read" | "contribute")} disabled={busy}>
              <option value="read">Read only</option><option value="contribute">Edit & independently review</option>
            </select></label>
            {memberAfter && <button className={button} disabled={busy} onClick={() => void operate(async () => {
              const after = memberAfter;
              const response = await listCurrentWorkspaceMembers(context, { after });
              if (!current()) return;
              if (response.next_after === after) throw new Error("Member pagination did not advance. Reload and retry.");
              setMembers(previous => [...new Map([...previous, ...response.members].map(member => [member.user_id, member])).values()]);
              setMemberAfter(response.next_after ?? null);
            })}>Load more workspace members</button>}
            <button className={button} disabled={busy || !shareUserId.trim()} onClick={() => void operate(async () => {
              const shared = await shareFinding(selected.id, { user_id: shareUserId.trim(), permission: sharePermission }, context);
              if (current()) { setSelected(shared); setShareUserId(""); }
            })}>Share for review</button>
            <p className="text-xs text-[var(--text-muted)]">{selected.participants.length} explicitly shared members</p>
            <ul className="space-y-2">{selected.participants.map(participant => <li key={participant.user_id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="break-all">{members.find(member => member.user_id === participant.user_id)?.display_name || participant.user_id} · {participant.permission}</span>
              <button className={button} disabled={busy} onClick={() => void operate(async () => {
                const updated = await unshareFinding(selected.id, participant.user_id, context);
                if (current()) setSelected(updated);
              })}>Revoke access</button>
            </li>)}</ul>
          </section>}</>}
        </section>
      </div>
    </div>
  </div>;
}