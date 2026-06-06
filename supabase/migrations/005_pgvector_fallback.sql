-- Optional Supabase pgvector fallback for small/free demos.
-- Qdrant remains the recommended production vector database.

create schema if not exists extensions;
create extension if not exists vector with schema extensions;

alter table public.document_chunks
  add column if not exists embedding extensions.vector(384);

create index if not exists document_chunks_workspace_embedding_hnsw
on public.document_chunks
using hnsw (embedding extensions.vector_cosine_ops)
where embedding is not null;

create or replace function public.match_document_chunks(
  query_embedding extensions.vector(384),
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
set search_path = public, extensions, pg_temp
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
      not (match_filters ? 'filename')
      or d.filename = match_filters->>'filename'
      or dc.metadata->>'filename' = match_filters->>'filename'
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

grant execute on function public.match_document_chunks(extensions.vector, uuid, int, jsonb)
to authenticated, service_role;
