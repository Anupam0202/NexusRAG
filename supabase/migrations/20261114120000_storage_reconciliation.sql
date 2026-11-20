-- Reconciliation reports (NX-27): what file storage and the search index hold that the database does not know of,
-- and what the database expects that they no longer hold.
--
-- An upload stores its original before it writes its rows; a deletion removes index entries and the original
-- before the rows. A crash between two steps, or a store that lost data, can leave
--   a stored file that no row names, which no one can list, download or delete;
--   a document whose original is gone, which can no longer be downloaded or indexed again;
--   index entries of a version that no longer exists, which are a deleted document's text;
--   a document marked ready whose passages the index no longer holds, which cannot be answered from.
-- Both functions only report. The gateway logs their counts once a day; scripts/reconciliation.py shows the
-- details and removes leftovers when the operator asks (through the Storage API: Supabase refuses direct deletes
-- from storage.objects). Object names contain file names, so the reports are for the service role only.

-- Security definer because it reads storage.objects.
create or replace function public.nexus_storage_reconciliation(p_grace_seconds integer default 3600, p_limit integer default 100)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  -- An upload writes its object before its rows, so a younger object may still get them.
  v_grace interval := make_interval(secs => greatest(coalesce(p_grace_seconds, 3600), 600));
  v_limit integer := least(greatest(coalesce(p_limit, 100), 0), 1000);
  v_unreferenced jsonb;
  v_missing jsonb;
begin
  -- Objects of the documents bucket that no document, version or upload names. A delete marker of a versioned
  -- bucket is not a stored file.
  select jsonb_build_object(
           'count', count(*),
           'bytes', coalesce(sum(o.bytes), 0),
           'objects', coalesce(jsonb_agg(jsonb_build_object('name', o.name, 'created_at', o.created_at, 'bytes', o.bytes)
                                         order by o.created_at, o.name) filter (where o.rank <= v_limit), '[]'::jsonb))
    into v_unreferenced
    from (
      select x.name, x.created_at,
             case when x.metadata->>'size' ~ '^[0-9]{1,18}$' then (x.metadata->>'size')::bigint end as bytes,
             row_number() over (order by x.created_at, x.name) as rank
        from storage.objects x
       where x.bucket_id = 'documents'
         and x.created_at < now() - v_grace
         and coalesce((to_jsonb(x)->>'is_delete_marker')::boolean, false) = false
         and not exists (select 1 from public.document_versions v where v.original_bucket = x.bucket_id and v.original_key = x.name)
         and not exists (select 1 from public.documents d where d.storage_bucket = x.bucket_id and d.storage_path = x.name)
         and not exists (select 1 from public.document_uploads u where u.original_bucket = x.bucket_id and u.original_key = x.name)
    ) o;

  -- Versions and documents whose original is gone. Documents being deleted are left out (a deletion removes the
  -- original before the rows), and so are documents an earlier release only marked as deleted.
  select jsonb_build_object(
           'count', count(*),
           'rows', coalesce(jsonb_agg(jsonb_build_object('workspace_id', m.workspace_id, 'document_id', m.document_id,
                                                         'version_id', m.version_id)
                                      order by m.workspace_id, m.document_id, m.version_id nulls first)
                            filter (where m.rank <= v_limit), '[]'::jsonb))
    into v_missing
    from (
      select r.*, row_number() over (order by r.workspace_id, r.document_id, r.version_id nulls first) as rank
        from (
          select d.workspace_id, d.id as document_id, v.id as version_id, v.original_bucket as bucket, v.original_key as name
            from public.document_versions v
            join public.documents d on d.id = v.document_id
           where d.lifecycle_state = 'active' and d.status <> 'deleted'
          union all
          select d.workspace_id, d.id, null::uuid, d.storage_bucket, d.storage_path
            from public.documents d
           where d.lifecycle_state = 'active' and d.status <> 'deleted' and d.storage_path is not null
        ) r
       where not exists (select 1 from storage.objects o
                          where o.bucket_id = r.bucket and o.name = r.name
                            and coalesce((to_jsonb(o)->>'is_delete_marker')::boolean, false) = false)
    ) m;

  return jsonb_build_object(
    'format', 'nexusrag-storage-reconciliation/1',
    'checked_at', now(),
    'grace_seconds', extract(epoch from v_grace)::integer,
    'limit', v_limit,
    'unreferenced_objects', v_unreferenced,
    'missing_originals', v_missing);
end;
$$;

revoke all on function public.nexus_storage_reconciliation(integer, integer) from public, anon, authenticated;
grant execute on function public.nexus_storage_reconciliation(integer, integer) to service_role;

comment on function public.nexus_storage_reconciliation(integer, integer) is
  'NX-27: stored originals no row names (older than the grace period) and rows of live documents whose original is gone. Read-only; service role only.';

-- p_indexed is what the search index holds, as its facet request answers for the version_id field:
-- [{"value": "<version id>", "count": <entries>}, ...]. p_complete says whether that list is the whole index; only
-- then can a version be reported as missing from it.
create or replace function public.nexus_index_reconciliation(p_indexed jsonb, p_complete boolean default true, p_limit integer default 100)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 100), 0), 1000);
  v_orphaned jsonb;
  v_unindexed jsonb;
begin
  if p_indexed is null or jsonb_typeof(p_indexed) <> 'array' then
    raise exception 'NR:INVALID_SCOPE';
  end if;

  -- Index entries of versions the database does not have. A value that is not an identifier at all cannot belong
  -- to a version either.
  select jsonb_build_object(
           'versions', count(*),
           'entries', coalesce(sum(i.entries), 0),
           'version_ids', coalesce(jsonb_agg(i.value order by i.value) filter (where i.rank <= v_limit), '[]'::jsonb))
    into v_orphaned
    from (
      select x.value, x.entries, row_number() over (order by x.value) as rank
        from (
          select e->>'value' as value,
                 case when e->>'value' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (e->>'value')::uuid end as version_id,
                 case when e->>'count' ~ '^[0-9]{1,18}$' then (e->>'count')::bigint else 0 end as entries
            from jsonb_array_elements(p_indexed) e
           where jsonb_typeof(e) = 'object' and e->>'value' is not null
        ) x
       where x.version_id is null
          or not exists (select 1 from public.document_versions v where v.id = x.version_id)
    ) i;

  -- Documents that can be asked about (live, with a published active version that has passages) whose passages the
  -- index does not hold.
  if coalesce(p_complete, false) then
    select jsonb_build_object(
             'count', count(*),
             'rows', coalesce(jsonb_agg(jsonb_build_object('workspace_id', m.workspace_id, 'document_id', m.document_id,
                                                           'version_id', m.version_id)
                                        order by m.workspace_id, m.document_id) filter (where m.rank <= v_limit), '[]'::jsonb))
      into v_unindexed
      from (
        select d.workspace_id, d.id as document_id, v.id as version_id,
               row_number() over (order by d.workspace_id, d.id) as rank
          from public.documents d
          join public.document_versions v on v.id = d.active_version_id
         where d.lifecycle_state = 'active' and d.status = 'ready' and v.publication_state = 'ready'
           and exists (select 1 from public.document_chunks c where c.version_id = v.id)
           and not exists (select 1 from jsonb_array_elements(p_indexed) e
                            where jsonb_typeof(e) = 'object' and lower(e->>'value') = v.id::text)
      ) m;
  end if;

  return jsonb_build_object(
    'format', 'nexusrag-index-reconciliation/1',
    'checked_at', now(),
    'limit', v_limit,
    'complete', coalesce(p_complete, false),
    'orphaned_entries', v_orphaned,
    'unindexed_versions', v_unindexed);
end;
$$;

revoke all on function public.nexus_index_reconciliation(jsonb, boolean, integer) from public, anon, authenticated;
grant execute on function public.nexus_index_reconciliation(jsonb, boolean, integer) to service_role;

comment on function public.nexus_index_reconciliation(jsonb, boolean, integer) is
  'NX-27: index entries of versions that no longer exist, and answerable documents the index holds nothing of. Read-only; service role only.';
