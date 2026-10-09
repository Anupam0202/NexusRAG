"use client";

import { FormEvent, useEffect, useRef, useState } from 'react';
import { useStore } from '@/hooks/useStore';
import { acceptWorkspaceInvitation, getInvitationCapabilities, createWorkspaceInvitation, listWorkspaceInvitations, revokeWorkspaceInvitation, type ApiRequestContext, type WorkspaceInvitation } from '@/lib/api';
import type { WorkspaceRole } from '@/types';

const button = 'min-h-11 rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-semibold disabled:opacity-50';
const input = 'min-w-0 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] px-3 py-2 text-sm';
function randomCode() {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function message(error: unknown) { return error instanceof Error ? error.message : 'Invitation operation failed. Refresh and retry.'; }

export function InvitationAcceptance({context,onAccepted}:{context: ApiRequestContext; onAccepted:()=>void}) {
  const [code,setCode]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[joined,setJoined]=useState(false);
  const alive=useRef(true);
  const [supported,setSupported]=useState(false),[checking,setChecking]=useState(true);
  const capabilities=async()=>{
    setChecking(true);setSupported(false);setError(null);
    try {const result=await getInvitationCapabilities(context);if(alive.current)setSupported(result.invitation_supported===true&&result.schema_version==='040');}
    catch(error){if(alive.current)setError(message(error));}
    finally {if(alive.current)setChecking(false);}
  };
  useEffect(()=>{alive.current=true;void capabilities();return()=>{alive.current=false;};
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);
  const accept=async(event:FormEvent)=>{
    event.preventDefault();if(busy||checking||!supported||!context.expectedUserId||!code.trim())return;
    setBusy(true);setError(null);setJoined(false);
    try {
      const result=await acceptWorkspaceInvitation(code.trim(),context);
      if(!alive.current || useStore.getState().authUser?.id!==context.expectedUserId)return;
      if(result.accepted!==true||result.schema_version!=='040')throw new Error('Acceptance outcome is unknown. Retry with the same code before requesting another.');
      setCode('');setJoined(true);onAccepted();
    } catch(error) {if(alive.current)setError(message(error));}
    finally {if(alive.current)setBusy(false);}
  };
  return <section className="mb-5 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4" aria-labelledby="accept-invitation-heading">
    <h3 id="accept-invitation-heading" className="font-semibold">Join an invited workspace</h3>
    <p className="my-2 text-sm text-[var(--text-muted)]">Sign in using the invited, confirmed email address, then paste the one-time code privately shared by its administrator. Codes expire after seven days. No email is sent by this workflow.</p>
    <form onSubmit={accept} className="flex flex-col gap-2 sm:flex-row">
      <label htmlFor="accept-invitation-code" className="sr-only">One-time invitation code</label>
      <input id="accept-invitation-code" type="password" autoComplete="off" value={code} maxLength={43} onChange={event=>setCode(event.target.value)} className={input+' flex-1'} />
      <button className={button} disabled={busy||checking||!supported||code.trim().length!==43}>{busy?'Joining workspace':'Accept invitation'}</button>
    </form>
    {checking&&<p role="status" className="mt-2 text-sm">Checking invitation capability</p>}
    {!checking&&!supported&&<p className="mt-2 text-sm">Invitations are unavailable until migration 040 is verified on this environment.</p>}
    {!checking&&!supported&&<button type="button" className={button+' mt-2'} onClick={()=>void capabilities()}>Retry invitation capability</button>}
    {error&&<p role="alert" className="mt-2 text-sm text-red-600">{error}</p>}
    {joined&&<p role="status" className="mt-2 text-sm">Workspace joined. Select it from the refreshed workspace list.</p>}
  </section>;
}

export function WorkspaceInvitationManager({context,workspaceRole}:{context:ApiRequestContext;workspaceRole:WorkspaceRole}) {
  const [rows,setRows]=useState<WorkspaceInvitation[]>([]),[after,setAfter]=useState<string|null>(null),[total,setTotal]=useState<number|null>(null);
  const [email,setEmail]=useState(''),[inviteRole,setInviteRole]=useState<WorkspaceInvitation['role']>('viewer'),[code,setCode]=useState<string|null>(null);
  const [busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState<string|null>(null);
  const alive=useRef(true),sequence=useRef(0);
  // Retain the exact request/code in memory across an ambiguous retry, never in storage or URLs.
  const pending=useRef<{recipient_email:string;role:WorkspaceInvitation['role'];token:string;idempotency_key:string}|null>(null);
  useEffect(()=>{const counter=sequence;alive.current=true;return()=>{alive.current=false;counter.current++;pending.current=null;};},[]);
  const load=async(cursor?:string)=>{
    const current=++sequence.current;setLoading(true);setError(null);
    try {
      const result=await listWorkspaceInvitations(context,cursor);
      if(!alive.current||current!==sequence.current)return;
      if(result.schema_version!=='040'||result.total_is_exact!==true||!Number.isSafeInteger(result.total)||result.total<0||!Array.isArray(result.invitations)||result.next_after===cursor)throw new Error('Invitation inventory could not be verified. Refresh and retry.');
      setRows(previous=>cursor?[...new Map([...previous,...result.invitations].map(row=>[row.id,row])).values()]:result.invitations);
      setAfter(result.next_after);setTotal(result.total);
    }catch(error){if(alive.current&&current===sequence.current)setError(message(error));}
    finally{if(alive.current&&current===sequence.current)setLoading(false);}
  };
  useEffect(()=>{void load();/* Parent remounts on actor/workspace/role change. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);
  const create=async(event:FormEvent)=>{
    event.preventDefault();if(busy||loading)return;setBusy(true);setError(null);setCode(null);
    const recipient_email=email.trim().toLowerCase();
    if(!pending.current||pending.current.recipient_email!==recipient_email||pending.current.role!==inviteRole)pending.current={recipient_email,role:inviteRole,token:randomCode(),idempotency_key:crypto.randomUUID()};
    const command=pending.current;
    try {
      const result=await createWorkspaceInvitation(command,context);
      if(!alive.current)return;
      if(result.state!=='pending'||result.workspace_id!==context.workspaceId||result.recipient_email!==command.recipient_email||!Number.isFinite(Date.parse(result.expires_at))||Date.parse(result.expires_at)<=Date.now())throw new Error('The previous invitation is no longer pending. Refresh invitations and revoke it if necessary before creating a replacement.');
      setCode(command.token);pending.current=null;setEmail('');await load();
    }catch(error){if(alive.current)setError(message(error));}
    finally{if(alive.current)setBusy(false);}
  };
  const revoke=async(id:string)=>{
    if(busy||loading)return;setBusy(true);setError(null);
    try{await revokeWorkspaceInvitation(id,context);if(alive.current){setCode(null);await load();}}
    catch(error){if(alive.current)setError(message(error));}
    finally{if(alive.current)setBusy(false);}
  };
  return <section className="mb-5 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4" aria-labelledby="workspace-invitations-heading">
    <h3 id="workspace-invitations-heading" className="font-semibold">Workspace invitations</h3>
    <p className="my-2 text-sm text-[var(--text-muted)]">Privately share a recipient-bound, seven-day code. This workflow does not send email or grant access before acceptance. Never paste codes into chat, public URLs or support logs.</p>
    <form onSubmit={create} className="grid gap-2 sm:grid-cols-[1fr_140px_auto]">
      <label htmlFor="invitation-email" className="sr-only">Invitation recipient email</label>
      <input id="invitation-email" type="email" required maxLength={254} value={email} onChange={event=>setEmail(event.target.value)} className={input} disabled={busy} />
      <label htmlFor="invitation-role" className="sr-only">Invitation role</label>
      <select id="invitation-role" value={inviteRole} onChange={event=>setInviteRole(event.target.value as WorkspaceInvitation['role'])} className={input} disabled={busy}>
        <option value="viewer">Viewer</option><option value="editor">Editor</option>{workspaceRole==='owner'&&<option value="admin">Administrator</option>}
      </select>
      <button className={button} disabled={busy||loading||!email.trim()}>{busy?'Saving invitation':'Create invitation'}</button>
    </form>
    {code&&<div className="my-3 rounded-lg border border-[var(--border)] p-3">
      <label htmlFor="created-invitation-code" className="block text-sm font-semibold">Copy this code now; it is not recoverable later</label>
      <input id="created-invitation-code" readOnly value={code} autoComplete="off" className={input+' mt-2 w-full font-mono'} onFocus={event=>event.target.select()} />
      <button type="button" className={button+' mt-2'} onClick={()=>setCode(null)}>Dismiss code</button>
    </div>}
    {error&&<p role="alert" className="my-2 text-sm text-red-600">{error}</p>}
    <div className="my-3 flex flex-wrap items-center gap-2"><button type="button" className={button} disabled={busy||loading} onClick={()=>void load()}>Refresh invitations</button>
      <p role="status" className="text-sm">{loading?'Loading invitations':total!==null?`${rows.length} of ${total} pending invitations`:'Invitation inventory unavailable'}</p></div>
    <ul className="space-y-2">{rows.map(row=><li key={row.id} className="flex flex-col gap-2 rounded-lg border border-[var(--border)] p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 break-words text-sm"><p>{row.recipient_email} · {row.role}</p><p className="text-[var(--text-muted)]">Expires {new Date(row.expires_at).toLocaleString()}</p></div>
      {(workspaceRole==='owner'||row.role!=='admin')&&<button type="button" className={button} disabled={busy||loading} onClick={()=>void revoke(row.id)} aria-label={`Revoke invitation for ${row.recipient_email}`}>Revoke</button>}
    </li>)}</ul>
    {after&&<button type="button" className={button+' mt-3'} disabled={busy||loading} onClick={()=>void load(after)}>Load more invitations</button>}
  </section>;
}
