-- Row Level Security and storage policies for NexusRAG workspaces.

create or replace function public.uuid_or_null(value text)
returns uuid
language plpgsql
immutable
as $$
begin
  return value::uuid;
exception when others then
  return null;
end;
$$;

create or replace function public.workspace_role(target_workspace uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select wm.role
  from public.workspace_members wm
  where wm.workspace_id = target_workspace
    and wm.user_id = auth.uid()
  limit 1
$$;

create or replace function public.is_workspace_member(target_workspace uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = target_workspace
      and wm.user_id = auth.uid()
  )
$$;

create or replace function public.has_workspace_role(
  target_workspace uuid,
  allowed_roles text[]
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.workspace_role(target_workspace) = any(allowed_roles), false)
$$;

create or replace function public.owns_workspace(target_workspace uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workspaces w
    where w.id = target_workspace
      and w.owner_id = auth.uid()
  )
$$;

alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.documents enable row level security;
alter table public.document_chunks enable row level security;
alter table public.ingestion_jobs enable row level security;
alter table public.chat_sessions enable row level security;
alter table public.chat_messages enable row level security;
alter table public.llm_usage_events enable row level security;
alter table public.audit_events enable row level security;
alter table public.workspace_settings enable row level security;
alter table public.api_keys enable row level security;
alter table public.eval_runs enable row level security;
alter table public.eval_results enable row level security;

create policy "profiles_select_own"
on public.profiles for select to authenticated
using (id = auth.uid());

create policy "profiles_update_own"
on public.profiles for update to authenticated
using (id = auth.uid())
with check (id = auth.uid());

create policy "workspaces_select_members"
on public.workspaces for select to authenticated
using (public.is_workspace_member(id));

create policy "workspaces_insert_owner"
on public.workspaces for insert to authenticated
with check (owner_id = auth.uid());

create policy "workspaces_update_admins"
on public.workspaces for update to authenticated
using (public.has_workspace_role(id, array['owner', 'admin']))
with check (public.has_workspace_role(id, array['owner', 'admin']));

create policy "workspaces_delete_owners"
on public.workspaces for delete to authenticated
using (public.has_workspace_role(id, array['owner']));

create policy "workspace_members_select_members"
on public.workspace_members for select to authenticated
using (public.is_workspace_member(workspace_id));

create policy "workspace_members_insert_admins"
on public.workspace_members for insert to authenticated
with check (
  public.has_workspace_role(workspace_id, array['owner', 'admin'])
  or (
    user_id = auth.uid()
    and role = 'owner'
    and public.owns_workspace(workspace_id)
  )
);

create policy "workspace_members_update_admins"
on public.workspace_members for update to authenticated
using (public.has_workspace_role(workspace_id, array['owner', 'admin']))
with check (public.has_workspace_role(workspace_id, array['owner', 'admin']));

create policy "workspace_members_delete_admins"
on public.workspace_members for delete to authenticated
using (public.has_workspace_role(workspace_id, array['owner', 'admin']));

create policy "documents_select_members"
on public.documents for select to authenticated
using (public.is_workspace_member(workspace_id));

create policy "documents_insert_editors"
on public.documents for insert to authenticated
with check (
  uploaded_by = auth.uid()
  and public.has_workspace_role(workspace_id, array['owner', 'admin', 'editor'])
);

create policy "documents_update_editors"
on public.documents for update to authenticated
using (public.has_workspace_role(workspace_id, array['owner', 'admin', 'editor']))
with check (public.has_workspace_role(workspace_id, array['owner', 'admin', 'editor']));

create policy "documents_delete_editors"
on public.documents for delete to authenticated
using (public.has_workspace_role(workspace_id, array['owner', 'admin', 'editor']));

create policy "document_chunks_select_members"
on public.document_chunks for select to authenticated
using (public.is_workspace_member(workspace_id));

create policy "document_chunks_insert_editors"
on public.document_chunks for insert to authenticated
with check (public.has_workspace_role(workspace_id, array['owner', 'admin', 'editor']));

create policy "document_chunks_update_editors"
on public.document_chunks for update to authenticated
using (public.has_workspace_role(workspace_id, array['owner', 'admin', 'editor']))
with check (public.has_workspace_role(workspace_id, array['owner', 'admin', 'editor']));

create policy "document_chunks_delete_editors"
on public.document_chunks for delete to authenticated
using (public.has_workspace_role(workspace_id, array['owner', 'admin', 'editor']));

create policy "ingestion_jobs_select_members"
on public.ingestion_jobs for select to authenticated
using (public.is_workspace_member(workspace_id));

create policy "ingestion_jobs_insert_editors"
on public.ingestion_jobs for insert to authenticated
with check (public.has_workspace_role(workspace_id, array['owner', 'admin', 'editor']));

create policy "ingestion_jobs_update_editors"
on public.ingestion_jobs for update to authenticated
using (public.has_workspace_role(workspace_id, array['owner', 'admin', 'editor']))
with check (public.has_workspace_role(workspace_id, array['owner', 'admin', 'editor']));

create policy "chat_sessions_select_members"
on public.chat_sessions for select to authenticated
using (public.is_workspace_member(workspace_id));

create policy "chat_sessions_insert_editors"
on public.chat_sessions for insert to authenticated
with check (
  user_id = auth.uid()
  and public.has_workspace_role(workspace_id, array['owner', 'admin', 'editor'])
);

create policy "chat_sessions_update_owners"
on public.chat_sessions for update to authenticated
using (
  user_id = auth.uid()
  or public.has_workspace_role(workspace_id, array['owner', 'admin'])
)
with check (public.is_workspace_member(workspace_id));

create policy "chat_messages_select_members"
on public.chat_messages for select to authenticated
using (public.is_workspace_member(workspace_id));

create policy "chat_messages_insert_editors"
on public.chat_messages for insert to authenticated
with check (public.has_workspace_role(workspace_id, array['owner', 'admin', 'editor']));

create policy "llm_usage_events_select_admins"
on public.llm_usage_events for select to authenticated
using (public.has_workspace_role(workspace_id, array['owner', 'admin']));

create policy "llm_usage_events_insert_members"
on public.llm_usage_events for insert to authenticated
with check (public.is_workspace_member(workspace_id));

create policy "audit_events_select_admins"
on public.audit_events for select to authenticated
using (
  workspace_id is not null
  and public.has_workspace_role(workspace_id, array['owner', 'admin'])
);

create policy "audit_events_insert_members"
on public.audit_events for insert to authenticated
with check (workspace_id is null or public.is_workspace_member(workspace_id));

create policy "workspace_settings_select_members"
on public.workspace_settings for select to authenticated
using (public.is_workspace_member(workspace_id));

create policy "workspace_settings_write_admins"
on public.workspace_settings for all to authenticated
using (public.has_workspace_role(workspace_id, array['owner', 'admin']))
with check (public.has_workspace_role(workspace_id, array['owner', 'admin']));

create policy "api_keys_select_owner_or_admin"
on public.api_keys for select to authenticated
using (
  user_id = auth.uid()
  or public.has_workspace_role(workspace_id, array['owner', 'admin'])
);

create policy "api_keys_insert_owner_or_admin"
on public.api_keys for insert to authenticated
with check (
  user_id = auth.uid()
  and public.has_workspace_role(workspace_id, array['owner', 'admin', 'editor'])
);

create policy "api_keys_update_owner_or_admin"
on public.api_keys for update to authenticated
using (
  user_id = auth.uid()
  or public.has_workspace_role(workspace_id, array['owner', 'admin'])
)
with check (
  user_id = auth.uid()
  or public.has_workspace_role(workspace_id, array['owner', 'admin'])
);

create policy "api_keys_delete_owner_or_admin"
on public.api_keys for delete to authenticated
using (
  user_id = auth.uid()
  or public.has_workspace_role(workspace_id, array['owner', 'admin'])
);

create policy "eval_runs_select_members"
on public.eval_runs for select to authenticated
using (public.is_workspace_member(workspace_id));

create policy "eval_runs_write_admins"
on public.eval_runs for all to authenticated
using (public.has_workspace_role(workspace_id, array['owner', 'admin']))
with check (public.has_workspace_role(workspace_id, array['owner', 'admin']));

create policy "eval_results_select_members"
on public.eval_results for select to authenticated
using (public.is_workspace_member(workspace_id));

create policy "eval_results_write_admins"
on public.eval_results for all to authenticated
using (public.has_workspace_role(workspace_id, array['owner', 'admin']))
with check (public.has_workspace_role(workspace_id, array['owner', 'admin']));

create policy "storage_documents_select_members"
on storage.objects for select to authenticated
using (
  bucket_id = 'documents'
  and public.is_workspace_member(public.uuid_or_null((storage.foldername(name))[1]))
);

create policy "storage_documents_insert_editors"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'documents'
  and public.has_workspace_role(
    public.uuid_or_null((storage.foldername(name))[1]),
    array['owner', 'admin', 'editor']
  )
);

create policy "storage_documents_update_editors"
on storage.objects for update to authenticated
using (
  bucket_id = 'documents'
  and public.has_workspace_role(
    public.uuid_or_null((storage.foldername(name))[1]),
    array['owner', 'admin', 'editor']
  )
)
with check (
  bucket_id = 'documents'
  and public.has_workspace_role(
    public.uuid_or_null((storage.foldername(name))[1]),
    array['owner', 'admin', 'editor']
  )
);

create policy "storage_documents_delete_editors"
on storage.objects for delete to authenticated
using (
  bucket_id = 'documents'
  and public.has_workspace_role(
    public.uuid_or_null((storage.foldername(name))[1]),
    array['owner', 'admin', 'editor']
  )
);
