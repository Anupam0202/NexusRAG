-- Disposable local records only, rolled back at the end; never run on hosted data.
\set ON_ERROR_STOP on
begin;
set request.jwt.claim.role='service_role';
do $$
declare ctx jsonb;draft jsonb;plan_id uuid;r jsonb;claimed jsonb;receipt jsonb;ids jsonb='[]';documents uuid[];
  doc uuid;ver uuid;chunk uuid;source_text text;i integer;j integer;
begin
  select jsonb_build_object('workspace_id',w.id,'user_id','22222222-2222-4222-8222-222222222222','membership_revision',w.capability_revision,
    'policy_id',s.active_policy_id,'policy_version',s.policy_version,'deadline',clock_timestamp()+interval '5 minutes') into ctx
    from public.workspaces w join public.workspace_settings s on s.workspace_id=w.id where w.id='11111111-1111-4111-8111-111111111111';
  for i in 1..50 loop
    doc=('d0390000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid;ver=('e0390000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid;
    insert into public.documents(id,workspace_id,uploaded_by,filename,original_filename,status)
      values(doc,(ctx->>'workspace_id')::uuid,(ctx->>'user_id')::uuid,'Synthetic'||i,'Synthetic'||i,'ready');
    insert into public.document_versions(id,workspace_id,document_id,original_bucket,original_key,original_hash,original_bytes,original_verified_at,
      parser_version,chunker_version,lifecycle_epoch,publication_state,index_generation,data_classification,classification_declared_by,classification_declared_at)
      values(ver,(ctx->>'workspace_id')::uuid,doc,'documents','synthetic-query-'||i,repeat('a',64),1,now(),'synthetic','synthetic',1,'ready','query-generation','non_sensitive',(ctx->>'user_id')::uuid,now());
    update public.documents set active_version_id=ver where id=doc;
    for j in 0..5 loop
      chunk=('f0390000-0000-4000-8000-'||lpad((i*10+j)::text,12,'0'))::uuid;source_text='Synthetic source '||i||' chunk '||j;
      insert into public.document_chunks(id,workspace_id,document_id,version_id,chunk_index,content,original_text,original_content_hash,page_number,location,embedding_space_id)
        values(chunk,(ctx->>'workspace_id')::uuid,doc,ver,j,source_text,source_text,encode(sha256(convert_to(source_text,'UTF8')),'hex'),2,'{"page":2}','synthetic-space');
    end loop;
    ids=ids||to_jsonb(doc::text);
  end loop;
  select plan into strict draft from public.research_plans where plan->>'plan_id'='mode-CONTRADICTION_ANALYSIS';
  draft=draft||jsonb_build_object('plan_id','query-fair-scope','question','Inspect the full source scope.','private_source_ids',ids,'subquestions','[]'::jsonb,
    'public_provider_ids','[]'::jsonb,'entity_scope','[]'::jsonb,'rights_constraints','[]'::jsonb,'expected_calculations','[]'::jsonb,'date_from',null,'date_to',null,'jurisdiction',null);
  plan_id=(public.nexus_research_plan(ctx,'create',p_plan=>draft,p_key=>'query-fair-scope')->>'id')::uuid;
  update public.nexus_account_usage set free_chat_queries=0 where user_id=(ctx->>'user_id')::uuid;
  r=public.nexus_research_run(ctx,'create',plan_id,p_key=>'query-fair-start',p_command=>'{"non_sensitive_attested":true}');
  claimed=public.nexus_research_step(ctx,'claim',(r->>'id')::uuid,1,0);
  if claimed->>'claimed'<>'true' then raise exception 'Query fixture did not claim'; end if;
  select array_agg(value::uuid) into documents from jsonb_array_elements_text(ids);
  receipt=public.nexus_research_candidates(ctx,(r->>'id')::uuid,1,0,documents);
  if receipt->>'schema_version'<>'research-candidates/1' or (receipt->>'lexical_rows_read')::integer<>201
    or (receipt->>'lexical_limit_reached')::boolean is distinct from true or jsonb_array_length(receipt->'items')<>151
    or (select count(distinct item->>'document_id') from jsonb_array_elements(receipt->'items') item)<>50
    or (select count(distinct item->>'id') from jsonb_array_elements(receipt->'items') item)<>151 then
    raise exception 'Fair SQL read lost scope or exceeded its row/candidate budget';
  end if;
  if exists(select 1 from jsonb_array_elements(receipt->'items') item where item->>'workspace_id'<>ctx->>'workspace_id'
    or item->>'original_content_hash'<>encode(sha256(convert_to(item->>'original_text','UTF8')),'hex')) then raise exception 'Original candidate receipt changed'; end if;
  perform public.nexus_research_run(ctx,'cancel',plan_id,(r->>'id')::uuid);
  begin
    perform public.nexus_research_candidates(ctx,(r->>'id')::uuid,1,0,documents);
    raise exception 'Cancelled run still read current-step candidates';
  exception when raise_exception then if sqlerrm<>'NR:VERSION_CONFLICT' then raise;end if;end;
end; $$;
rollback;
\echo RESEARCH_FAIR_CANDIDATE_SQL_PASS sources=50 stored_chunks=300 rows_read=201 candidates=151 sources_retained=50 cancelled_cursor_stopped
