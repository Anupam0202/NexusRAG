-- Expand pgvector fallback filtering to match the Qdrant/local retrieval surface.

create or replace function public.match_document_chunks(
  query_embedding vector(384),
  match_workspace_id uuid,
  match_count int default 10,
  match_filters jsonb default '{}'::jsonb
)
returns table (
  id uuid,
  workspace_id uuid,
  document_id uuid,
  chunk_id text,
  content text,
  content_hash text,
  page_number int,
  chunk_index int,
  filename text,
  metadata jsonb,
  score double precision
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    dc.id,
    dc.workspace_id,
    dc.document_id,
    coalesce(dc.metadata->>'chunk_id', dc.qdrant_point_id, dc.id::text) as chunk_id,
    dc.content,
    dc.content_hash,
    dc.page_number,
    dc.chunk_index,
    coalesce(dc.metadata->>'filename', d.filename) as filename,
    dc.metadata,
    1 - (dc.embedding <=> query_embedding) as score
  from public.document_chunks dc
  left join public.documents d
    on d.id = dc.document_id
   and d.workspace_id = dc.workspace_id
  where dc.workspace_id = match_workspace_id
    and dc.embedding is not null
    and (
      not (match_filters ? 'document_id')
      or dc.document_id = (match_filters->>'document_id')::uuid
    )
    and (
      not (match_filters ? 'document_ids')
      or dc.document_id::text in (
        select value from jsonb_array_elements_text(match_filters->'document_ids') as value
      )
    )
    and (
      not (match_filters ? 'filename')
      or d.filename = match_filters->>'filename'
      or dc.metadata->>'filename' = match_filters->>'filename'
    )
    and (
      not (match_filters ? 'file_types')
      or lower(coalesce(dc.metadata->>'file_type', '')) in (
        select lower(value) from jsonb_array_elements_text(match_filters->'file_types') as value
      )
    )
    and (
      not (match_filters ? 'uploaded_by')
      or d.uploaded_by::text = match_filters->>'uploaded_by'
      or dc.metadata->>'uploaded_by' = match_filters->>'uploaded_by'
    )
    and (
      not (match_filters ? 'uploaded_after_epoch')
      or extract(epoch from d.created_at)::bigint >= (match_filters->>'uploaded_after_epoch')::bigint
    )
    and (
      not (match_filters ? 'uploaded_before_epoch')
      or extract(epoch from d.created_at)::bigint <= (match_filters->>'uploaded_before_epoch')::bigint
    )
    and (
      not (match_filters ? 'metadata')
      or dc.metadata @> match_filters->'metadata'
    )
    and (
      not (match_filters ? 'min_page')
      or coalesce(dc.page_number, 0) >= (match_filters->>'min_page')::int
    )
    and (
      not (match_filters ? 'max_page')
      or coalesce(dc.page_number, 0) <= (match_filters->>'max_page')::int
    )
  order by dc.embedding <=> query_embedding
  limit greatest(1, least(coalesce(match_count, 10), 100));
$$;

grant execute on function public.match_document_chunks(vector, uuid, int, jsonb)
to authenticated, service_role;
