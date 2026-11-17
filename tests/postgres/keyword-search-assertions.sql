\set ON_ERROR_STOP on
-- Keyword search ranked in the database (NX-20) must find a question's rare words in any passage of the chosen
-- versions, rank rare words above common ones, and never return a passage of another workspace, of a version that
-- is not published or of one classified sensitive. The question is data, never a query.
begin;
set local client_min_messages = warning;

-- Workspace A: version 1 is published with 250 passages, the match sits beyond the first 200 by identifier;
-- version 2 is still processing; version 3 is sensitive. Workspace B holds the same rare word in a published version.
insert into public.documents(id,workspace_id,uploaded_by,filename,original_filename,status,chunk_count,lifecycle_state)
values ('ed100000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','policy.txt','policy.txt','ready',0,'active'),
       ('ed100000-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','draft.txt','draft.txt','processing',0,'active'),
       ('ed100000-0000-4000-8000-000000000003','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','private.txt','private.txt','ready',0,'active'),
       ('ed100000-0000-4000-8000-000000000004','44444444-4444-4444-8444-444444444444','33333333-3333-4333-8333-333333333333','other.txt','other.txt','ready',0,'active');
insert into public.document_versions(id,workspace_id,document_id,original_bucket,original_key,original_hash,original_bytes,
  original_verified_at,parser_version,chunker_version,lifecycle_epoch,publication_state,index_generation,data_classification,
  classification_declared_by,classification_declared_at)
values ('ed200000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','ed100000-0000-4000-8000-000000000001','documents','keyword/1.txt',repeat('e',64),64,now(),'test','test',1,'ready','generation-1','non_sensitive','22222222-2222-4222-8222-222222222222',now()),
       ('ed200000-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111','ed100000-0000-4000-8000-000000000002','documents','keyword/2.txt',repeat('e',64),64,now(),'test','test',1,'processing','generation-1','non_sensitive','22222222-2222-4222-8222-222222222222',now()),
       ('ed200000-0000-4000-8000-000000000003','11111111-1111-4111-8111-111111111111','ed100000-0000-4000-8000-000000000003','documents','keyword/3.txt',repeat('e',64),64,now(),'test','test',1,'ready','generation-1','sensitive',null,null),
       ('ed200000-0000-4000-8000-000000000004','44444444-4444-4444-8444-444444444444','ed100000-0000-4000-8000-000000000004','documents','keyword/4.txt',repeat('e',64),64,now(),'test','test',1,'ready','generation-1','non_sensitive','33333333-3333-4333-8333-333333333333',now());

create temporary table keyword_passages(id uuid, version_id uuid, content text) on commit drop;
-- 248 ordinary passages that all say "what the policy does", sorted first by identifier.
insert into keyword_passages
select ('ed300000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'ed200000-0000-4000-8000-000000000001',
       'This section says what the policy does for members, number ' || n || '.'
  from generate_series(1, 248) n;
-- Beyond the first 200: the rare code, and one passage with only a common word of the question plus "penalties".
insert into keyword_passages values
  ('ed3fffff-0000-4000-8000-000000000001', 'ed200000-0000-4000-8000-000000000001', 'Clause ZX-4471 sets the late-payment penalties at two percent.'),
  ('ed3fffff-0000-4000-8000-000000000002', 'ed200000-0000-4000-8000-000000000001', 'Penalties apply as described elsewhere; what follows is general.'),
  -- Excluded by version state, classification or workspace, though each holds the rare code.
  ('ed3fffff-0000-4000-8000-000000000003', 'ed200000-0000-4000-8000-000000000002', 'Draft clause ZX-4471 penalties.'),
  ('ed3fffff-0000-4000-8000-000000000004', 'ed200000-0000-4000-8000-000000000003', 'Sensitive clause ZX-4471 penalties.'),
  ('ed3fffff-0000-4000-8000-000000000005', 'ed200000-0000-4000-8000-000000000004', 'Other workspace clause ZX-4471 penalties.'),
  -- A passage with a word longer than text search indexes (2,047 characters) is still searchable by its other words.
  ('ed3fffff-0000-4000-8000-000000000006', 'ed200000-0000-4000-8000-000000000001', 'Appendix ' || repeat('q', 3000) || ' quorum rules.');
insert into public.document_chunks(id,workspace_id,document_id,version_id,chunk_index,content,original_text,original_content_hash,page_number,location,embedding_space_id)
select p.id, v.workspace_id, v.document_id, v.id, row_number() over (partition by v.id order by p.id)::int - 1, p.content, p.content,
       encode(sha256(convert_to(p.content, 'UTF8')), 'hex'), 1, '{"page":1}', 'synthetic-space'
  from keyword_passages p join public.document_versions v on v.id = p.version_id;

-- 1. The rare code is found beyond the first 200 passages and ranks first; a passage with only common words ranks
--    below one with a rarer word; every result belongs to the published, non-sensitive version of workspace A.
do $$
declare ids uuid[]; scores float8[]; versions uuid[];
begin
  select array_agg(id order by keyword_score desc, id), array_agg(keyword_score order by keyword_score desc, id),
         array_agg(distinct version_id)
    into ids, scores, versions
    from public.nexus_keyword_chunks('11111111-1111-4111-8111-111111111111',
           array['ed200000-0000-4000-8000-000000000001','ed200000-0000-4000-8000-000000000002',
                 'ed200000-0000-4000-8000-000000000003','ed200000-0000-4000-8000-000000000004']::uuid[],
           'What does clause ZX-4471 say about penalties?', 10);
  if ids[1] <> 'ed3fffff-0000-4000-8000-000000000001' then raise exception 'the rare code did not rank first: %', ids; end if;
  if ids[2] <> 'ed3fffff-0000-4000-8000-000000000002' then raise exception 'the rarer word did not rank second: %', ids; end if;
  if versions <> array['ed200000-0000-4000-8000-000000000001']::uuid[] then
    raise exception 'a passage outside the published, non-sensitive version of the workspace was returned: %', versions; end if;
  if array_length(ids, 1) <> 10 or scores[1] <= scores[2] or scores[2] <= scores[3] then
    raise exception 'results are not limited and ranked by rarity: % %', ids, scores; end if;
  if exists (select 1 from unnest(ids) id where id::text like 'ed3fffff-0000-4000-8000-00000000000_' and id not in
             ('ed3fffff-0000-4000-8000-000000000001','ed3fffff-0000-4000-8000-000000000002')) then
    raise exception 'an excluded passage was returned: %', ids; end if;
end $$;

-- 2. Words are compared whole and lower-cased, and a passage with an over-long word is found by its others.
do $$
begin
  if (select count(*) from public.nexus_keyword_chunks('11111111-1111-4111-8111-111111111111',
        array['ed200000-0000-4000-8000-000000000001']::uuid[], 'QUORUM', 5)) <> 1 then
    raise exception 'a passage with an over-long word was not found by its other words'; end if;
  if exists (select 1 from public.nexus_keyword_chunks('11111111-1111-4111-8111-111111111111',
        array['ed200000-0000-4000-8000-000000000001']::uuid[], 'quor', 5)) then
    raise exception 'a word matched part of another word'; end if;
end $$;

-- 3. The question is data: query operators, quotes and SQL are words or nothing, and never an error.
do $$
declare question text; found_ids uuid[];
begin
  foreach question in array array[$q$'); delete from public.document_chunks; --$q$, 'zx-4471 & !penalties | :* <->',
                                  'ZX-4471"', E'\\x00   penalties', repeat('word ', 5000)] loop
    select array_agg(id) into found_ids from public.nexus_keyword_chunks('11111111-1111-4111-8111-111111111111',
           array['ed200000-0000-4000-8000-000000000001']::uuid[], question, 5);
  end loop;
  if (select count(*) from public.document_chunks c join keyword_passages p on p.id = c.id) <> 254 then
    raise exception 'a question changed the stored passages'; end if;
  select array_agg(id order by keyword_score desc, id) into found_ids from public.nexus_keyword_chunks('11111111-1111-4111-8111-111111111111',
         array['ed200000-0000-4000-8000-000000000001']::uuid[], 'zx-4471 & !penalties | :* <->', 5);
  if found_ids[1] <> 'ed3fffff-0000-4000-8000-000000000001' then
    raise exception 'query operators in a question changed the search: %', found_ids; end if;
end $$;

-- 4. Bounds: nothing without words or versions, nothing for more than 100 versions, and 1 to 100 results.
do $$
declare many uuid[];
begin
  select array_agg(gen_random_uuid()) into many from generate_series(1, 100);
  many := many || 'ed200000-0000-4000-8000-000000000001'::uuid;
  if exists (select 1 from public.nexus_keyword_chunks('11111111-1111-4111-8111-111111111111', many, 'ZX-4471', 5))
     or exists (select 1 from public.nexus_keyword_chunks('11111111-1111-4111-8111-111111111111', null, 'ZX-4471', 5))
     or exists (select 1 from public.nexus_keyword_chunks('11111111-1111-4111-8111-111111111111', '{}', 'ZX-4471', 5))
     or exists (select 1 from public.nexus_keyword_chunks('11111111-1111-4111-8111-111111111111',
                  array['ed200000-0000-4000-8000-000000000001']::uuid[], ' ?! ', 5))
     or exists (select 1 from public.nexus_keyword_chunks('11111111-1111-4111-8111-111111111111',
                  array['ed200000-0000-4000-8000-000000000001']::uuid[], null, 5)) then
    raise exception 'a search without words or within bounds returned passages'; end if;
  if (select count(*) from public.nexus_keyword_chunks('11111111-1111-4111-8111-111111111111',
        array['ed200000-0000-4000-8000-000000000001']::uuid[], 'policy', 0)) <> 1
     or (select count(*) from public.nexus_keyword_chunks('11111111-1111-4111-8111-111111111111',
        array['ed200000-0000-4000-8000-000000000001']::uuid[], 'policy', 1000)) <> 100
     or (select count(*) from public.nexus_keyword_chunks('11111111-1111-4111-8111-111111111111',
        array['ed200000-0000-4000-8000-000000000001']::uuid[], 'policy', null)) <> 50 then
    raise exception 'the number of results is not kept between 1 and 100, 50 by default'; end if;
end $$;

-- 5. Only the service role can run it, it changes nothing, and it finds the same as the service role.
do $$
declare fn regprocedure := 'public.nexus_keyword_chunks(uuid,uuid[],text,integer)'::regprocedure;
begin
  if has_function_privilege('anon', fn, 'execute') or has_function_privilege('authenticated', fn, 'execute') then
    raise exception 'a browser role can run the keyword search'; end if;
  if not has_function_privilege('service_role', fn, 'execute') then raise exception 'the service role cannot run the keyword search'; end if;
  if (select provolatile from pg_proc where oid = fn) <> 's' or (select prosecdef from pg_proc where oid = fn) then
    raise exception 'the keyword search must be read-only and run with the caller''s rights'; end if;
end $$;
set local role service_role;
set local request.jwt.claim.role = 'service_role';
do $$
begin
  if (select id from public.nexus_keyword_chunks('11111111-1111-4111-8111-111111111111',
        array['ed200000-0000-4000-8000-000000000001']::uuid[], 'ZX-4471', 1)) <> 'ed3fffff-0000-4000-8000-000000000001' then
    raise exception 'the service role does not get the keyword search'; end if;
end $$;
rollback;
select 'KEYWORD_SEARCH_SQL_PASS';
