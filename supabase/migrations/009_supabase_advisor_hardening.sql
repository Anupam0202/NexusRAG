-- Close Supabase advisor findings for a backend-only application data plane.
--
-- The browser uses Supabase Auth only. All public-schema table access and the
-- pgvector RPC flow through the FastAPI service-role boundary, so authenticated
-- browser clients do not need direct PostgREST/GraphQL table privileges.

create index if not exists documents_uploaded_by_idx
on public.documents (uploaded_by);

alter policy "profiles_select_own"
on public.profiles
using (id = (select auth.uid()));

alter policy "profiles_update_own"
on public.profiles
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

alter policy "workspaces_insert_owner"
on public.workspaces
with check (owner_id = (select auth.uid()));

alter policy "documents_insert_editors"
on public.documents
with check (
  uploaded_by = (select auth.uid())
  and public.has_workspace_role(workspace_id, array['owner', 'admin', 'editor'])
);

alter policy "chat_sessions_insert_editors"
on public.chat_sessions
with check (
  user_id = (select auth.uid())
  and public.has_workspace_role(workspace_id, array['owner', 'admin', 'editor'])
);

alter policy "chat_sessions_update_owners"
on public.chat_sessions
using (
  user_id = (select auth.uid())
  or public.has_workspace_role(workspace_id, array['owner', 'admin'])
)
with check (public.is_workspace_member(workspace_id));

alter policy "api_keys_select_owner_or_admin"
on public.api_keys
using (
  user_id = (select auth.uid())
  or public.has_workspace_role(workspace_id, array['owner', 'admin'])
);

alter policy "api_keys_insert_owner_or_admin"
on public.api_keys
with check (
  user_id = (select auth.uid())
  and public.has_workspace_role(workspace_id, array['owner', 'admin', 'editor'])
);

alter policy "api_keys_update_owner_or_admin"
on public.api_keys
using (
  user_id = (select auth.uid())
  or public.has_workspace_role(workspace_id, array['owner', 'admin'])
)
with check (
  user_id = (select auth.uid())
  or public.has_workspace_role(workspace_id, array['owner', 'admin'])
);

alter policy "api_keys_delete_owner_or_admin"
on public.api_keys
using (
  user_id = (select auth.uid())
  or public.has_workspace_role(workspace_id, array['owner', 'admin'])
);

drop policy if exists "workspace_settings_write_admins" on public.workspace_settings;
create policy "workspace_settings_insert_admins"
on public.workspace_settings for insert to authenticated
with check (public.has_workspace_role(workspace_id, array['owner', 'admin']));
create policy "workspace_settings_update_admins"
on public.workspace_settings for update to authenticated
using (public.has_workspace_role(workspace_id, array['owner', 'admin']))
with check (public.has_workspace_role(workspace_id, array['owner', 'admin']));
create policy "workspace_settings_delete_admins"
on public.workspace_settings for delete to authenticated
using (public.has_workspace_role(workspace_id, array['owner', 'admin']));

drop policy if exists "eval_runs_write_admins" on public.eval_runs;
create policy "eval_runs_insert_admins"
on public.eval_runs for insert to authenticated
with check (public.has_workspace_role(workspace_id, array['owner', 'admin']));
create policy "eval_runs_update_admins"
on public.eval_runs for update to authenticated
using (public.has_workspace_role(workspace_id, array['owner', 'admin']))
with check (public.has_workspace_role(workspace_id, array['owner', 'admin']));
create policy "eval_runs_delete_admins"
on public.eval_runs for delete to authenticated
using (public.has_workspace_role(workspace_id, array['owner', 'admin']));

drop policy if exists "eval_results_write_admins" on public.eval_results;
create policy "eval_results_insert_admins"
on public.eval_results for insert to authenticated
with check (public.has_workspace_role(workspace_id, array['owner', 'admin']));
create policy "eval_results_update_admins"
on public.eval_results for update to authenticated
using (public.has_workspace_role(workspace_id, array['owner', 'admin']))
with check (public.has_workspace_role(workspace_id, array['owner', 'admin']));
create policy "eval_results_delete_admins"
on public.eval_results for delete to authenticated
using (public.has_workspace_role(workspace_id, array['owner', 'admin']));

revoke execute on function public.match_document_chunks(extensions.vector, uuid, int, jsonb)
from anon, authenticated;

revoke all privileges on all tables in schema public from anon, authenticated;
revoke all privileges on all sequences in schema public from anon, authenticated;

alter default privileges in schema public
revoke all privileges on tables from anon, authenticated;
alter default privileges in schema public
revoke all privileges on sequences from anon, authenticated;
