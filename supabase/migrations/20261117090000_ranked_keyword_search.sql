-- Keyword search ranked in the database (NX-20).
--
-- Chat combines vector search with keyword matching. The keyword side read the first 200 passages of the selected
-- documents in identifier order and scored only those, so in a workspace or a long document with more passages an
-- exact term (a reference code, a name, a clause number) in any other passage was never matched. This function
-- searches every passage of the given versions and returns the best matches.
--
-- A passage scores for each distinct word of the question it contains, weighted by how rare that word is among the
-- passages searched (BM25's inverse document frequency), so "the" and "what" count for almost nothing and a code that
-- appears once counts for most. Words are compared whole and lower-cased with the 'simple' configuration, which works
-- for every language and never stems. The question is never parsed as a query: its words are compared as plain
-- values, so no character in it can change what is searched. At most the 32 longest distinct words of a question are
-- used.
--
-- Only the service role may call it. The gateway checks membership and passes the versions it has confirmed are
-- current; the function itself also keeps to published, non-sensitive versions of the given workspace.

-- Passages with a word longer than text search indexes (2,047 characters, such as an encoded blob) are indexed
-- without it; keep the notice each one raises out of the release log.
set client_min_messages = warning;
create index if not exists document_chunks_simple_words_idx on public.document_chunks
  using gin ((pg_catalog.tsvector_to_array(pg_catalog.to_tsvector('simple'::regconfig, coalesce(content, '')))));

create or replace function public.nexus_keyword_chunks(p_workspace uuid, p_version_ids uuid[], p_question text,
                                                       p_limit integer default 50)
returns table (
  id uuid, workspace_id uuid, document_id uuid, version_id uuid, chunk_index integer, page_number integer,
  content text, original_text text, original_content_hash text, location jsonb, metadata jsonb,
  keyword_score double precision)
language sql
stable
security invoker
set search_path = ''
as $$
  with question as (
    select array(
      select words.lexeme
        from (select distinct lexeme
                from unnest(pg_catalog.tsvector_to_array(
                       pg_catalog.to_tsvector('simple'::regconfig, left(coalesce(p_question, ''), 4000)))) lexeme
               where char_length(lexeme) between 2 and 64) words
       order by char_length(words.lexeme) desc, words.lexeme
       limit 32) as terms
  ), scope as (
    select v.id
      from public.document_versions v
     where v.workspace_id = p_workspace
       and v.id = any(p_version_ids)
       and v.publication_state = 'ready'
       and v.data_classification = 'non_sensitive'
       and cardinality(p_version_ids) between 1 and 100
  ), searched as (
    select count(*)::double precision as passages
      from public.document_chunks c
     where c.workspace_id = p_workspace and c.version_id in (select scope.id from scope)
  ), matched as (
    select c.id, c.workspace_id, c.document_id, c.version_id, c.chunk_index, c.page_number, c.content, c.original_text,
           c.original_content_hash, c.location, c.metadata,
           array(select t from unnest(q.terms) t
                  where t = any(pg_catalog.tsvector_to_array(pg_catalog.to_tsvector('simple'::regconfig, coalesce(c.content, '')))))
             as found
      from public.document_chunks c, question q
     where c.workspace_id = p_workspace
       and c.version_id in (select scope.id from scope)
       and pg_catalog.tsvector_to_array(pg_catalog.to_tsvector('simple'::regconfig, coalesce(c.content, ''))) && q.terms
  ), rarity as (
    -- A word is in a passage only if that passage matched, so the matched passages give each word's frequency.
    select t as term,
           ln(1 + ((select s.passages from searched s) - count(*) + 0.5) / (count(*) + 0.5)) as weight
      from matched m, unnest(m.found) t
     group by t
  )
  select m.id, m.workspace_id, m.document_id, m.version_id, m.chunk_index, m.page_number, m.content, m.original_text,
         m.original_content_hash, m.location, m.metadata,
         (select sum(r.weight) from rarity r where r.term = any(m.found))::double precision as keyword_score
    from matched m
   order by keyword_score desc, m.id
   limit least(greatest(coalesce(p_limit, 50), 1), 100)
$$;

revoke all on function public.nexus_keyword_chunks(uuid, uuid[], text, integer) from public, anon, authenticated;
grant execute on function public.nexus_keyword_chunks(uuid, uuid[], text, integer) to service_role;

comment on function public.nexus_keyword_chunks(uuid, uuid[], text, integer) is
  'NX-20: the passages of the given published, non-sensitive versions that best match the question''s words, weighted by rarity. Read-only; service role only.';
