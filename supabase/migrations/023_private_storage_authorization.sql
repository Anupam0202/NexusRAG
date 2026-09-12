-- V6 private evidence storage authorization and bounded cleanup interfaces.
-- LOCAL REVIEW REQUIRED before applying: replaces legacy direct object policies.
begin;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values(
 'documents','documents',false,25000000,
 array[
  'application/pdf','application/json','application/zip',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/csv','text/html','text/markdown','text/plain',
  'image/jpeg','image/png','image/webp'
 ]::text[]
)
on conflict(id) do update set
 name=excluded.name,
 public=false,
 file_size_limit=excluded.file_size_limit,
 allowed_mime_types=excluded.allowed_mime_types;

create or replace function nexusrag_private.can_read_document_object(p_name text)
returns boolean
language sql
stable
security definer
set search_path=public,storage,pg_temp
as $$
 select
  current_setting('request.jwt.claim.role',true)='service_role'
  or exists(
   select 1
   from public.document_versions v
   join public.documents d on d.workspace_id=v.workspace_id and d.id=v.document_id
   join public.workspaces w on w.id=v.workspace_id
   join public.workspace_members m on m.workspace_id=v.workspace_id
   where v.original_bucket='documents'
    and v.original_key=p_name
    and m.user_id=(select auth.uid())
    and w.lifecycle_state='active'
    and d.lifecycle_state='active'
    and v.publication_state='ready'
  )
$$;

create or replace function nexusrag_private.can_write_document_object(p_name text)
returns boolean
language sql
stable
security definer
set search_path=public,storage,pg_temp
as $$
 select
  current_setting('request.jwt.claim.role',true)='service_role'
  or exists(
   select 1
   from public.document_uploads u
   join public.workspaces w on w.id=u.workspace_id
   join public.workspace_members m on m.workspace_id=u.workspace_id
   where u.original_bucket='documents'
    and u.original_key=p_name
    and u.actor_id=(select auth.uid())
    and m.user_id=(select auth.uid())
    and m.role in('owner','admin','editor')
    and w.lifecycle_state='active'
    and u.state='receiving'
    and u.write_token is not null
    and u.expected_bytes between 1 and 25000000
    and u.expires_at>clock_timestamp()
  )
$$;

revoke execute on function nexusrag_private.can_read_document_object(text) from public,anon;
revoke execute on function nexusrag_private.can_write_document_object(text) from public,anon;
grant execute on function nexusrag_private.can_read_document_object(text) to authenticated,service_role;
grant execute on function nexusrag_private.can_write_document_object(text) to authenticated,service_role;

-- Replace broad workspace-prefix authorization with exact allocated-object authorization.
drop policy if exists "storage_documents_select_members" on storage.objects;
drop policy if exists "storage_documents_insert_editors" on storage.objects;
drop policy if exists "storage_documents_update_editors" on storage.objects;
drop policy if exists "storage_documents_delete_editors" on storage.objects;
drop policy if exists "nexusrag_documents_select" on storage.objects;
drop policy if exists "nexusrag_documents_insert" on storage.objects;
drop policy if exists "nexusrag_documents_update" on storage.objects;

create policy "nexusrag_documents_select"
on storage.objects for select to authenticated
using(bucket_id='documents' and nexusrag_private.can_read_document_object(name));

create policy "nexusrag_documents_insert"
on storage.objects for insert to authenticated
with check(bucket_id='documents' and nexusrag_private.can_write_document_object(name));

create policy "nexusrag_documents_update"
on storage.objects for update to authenticated
using(bucket_id='documents' and nexusrag_private.can_write_document_object(name))
with check(bucket_id='documents' and nexusrag_private.can_write_document_object(name));

-- Client deletion is intentionally unavailable. Durable deletion is service-mediated
-- and must create provider receipts before an operation can become verified.

create or replace function public.claim_expired_document_uploads(p_limit integer default 100)
returns table(upload_id uuid,workspace_id uuid,bucket_id text,object_name text)
language plpgsql
security invoker
set search_path=public,pg_temp
as $$
begin
 if current_setting('request.jwt.claim.role',true)<>'service_role' then
  raise exception 'NR:FORBIDDEN' using errcode='42501';
 end if;
 if p_limit not between 1 and 500 then
  raise exception 'NR:INVALID_SCOPE' using errcode='22023';
 end if;
 return query
 with candidates as(
  select u.id
  from public.document_uploads u
  where u.expires_at<=clock_timestamp()
   and u.state in('allocated','receiving','stored','failed','cancelled')
   and u.cleanup_state<>'verified'
  order by u.expires_at,u.id
  for update skip locked
  limit p_limit
 ),updated as(
  update public.document_uploads u
  set state=case when u.state in('allocated','receiving','stored') then 'cancelled' else u.state end,
      cleanup_state='pending',failed_at=coalesce(u.failed_at,clock_timestamp())
  from candidates c
  where u.id=c.id
  returning u.id,u.workspace_id,u.original_bucket,u.original_key
 )
 select id,updated.workspace_id,original_bucket,original_key from updated;
end;$$;

revoke execute on function public.claim_expired_document_uploads(integer) from public,anon,authenticated;
grant execute on function public.claim_expired_document_uploads(integer) to service_role;

commit;
