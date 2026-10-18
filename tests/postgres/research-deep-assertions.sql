\set ON_ERROR_STOP on
begin;
set request.jwt.claim.role='service_role';
do $$
declare ctx jsonb;draft jsonb;plan_id uuid;r jsonb;replay jsonb;claimed jsonb;stale jsonb;result jsonb;quotes jsonb;documents jsonb;prior jsonb;finding jsonb;context_receipt jsonb;
  ids jsonb='[]';doc uuid;ver uuid;chunk uuid;source_text text;i integer;k integer;generation integer=1;prior_deadline timestamptz;
begin
  select jsonb_build_object('workspace_id',w.id,'user_id','22222222-2222-4222-8222-222222222222','membership_revision',w.capability_revision,
    'policy_id',s.active_policy_id,'policy_version',s.policy_version,'deadline',clock_timestamp()+interval '15 minutes') into ctx
    from public.workspaces w join public.workspace_settings s on s.workspace_id=w.id where w.id='11111111-1111-4111-8111-111111111111';
  for i in 1..60 loop
    doc=('d0410000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid;ver=('e0410000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid;chunk=('f0410000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid;
    source_text=chr(128202)||' Synthetic retention is30days. Inspect the original context.';
    insert into public.documents(id,workspace_id,uploaded_by,filename,original_filename,status)
      values(doc,(ctx->>'workspace_id')::uuid,(ctx->>'user_id')::uuid,'Deep source'||i,'Deep source'||i,'ready');
    insert into public.document_versions(id,workspace_id,document_id,original_bucket,original_key,original_hash,original_bytes,original_verified_at,
      parser_version,chunker_version,lifecycle_epoch,publication_state,index_generation,data_classification,classification_declared_by,classification_declared_at)
      values(ver,(ctx->>'workspace_id')::uuid,doc,'documents','synthetic-deep-'||i,repeat('a',64),1,now(),'synthetic','synthetic',1,'ready','deep-generation','non_sensitive',(ctx->>'user_id')::uuid,now());
    update public.documents set active_version_id=ver where id=doc;
    insert into public.document_chunks(id,workspace_id,document_id,version_id,chunk_index,content,original_text,original_content_hash,page_number,location,embedding_space_id)
      values(chunk,(ctx->>'workspace_id')::uuid,doc,ver,0,source_text,source_text,encode(sha256(convert_to(source_text,'UTF8')),'hex'),2,'{"page":2}','synthetic-space');
    ids=ids||to_jsonb(doc::text);
  end loop;
  select plan into strict draft from public.research_plans where plan->>'plan_id'='mode-DEEP_RESEARCH';
  draft=draft||jsonb_build_object('plan_id','deep-sixty','question','Synthesize the original source evidence.','private_source_ids',ids,
    'subquestions',(select jsonb_agg('Subquestion'||n order by n) from generate_series(1,12) n),
    'public_provider_ids','[]'::jsonb,'entity_scope','[]'::jsonb,'rights_constraints','[]'::jsonb,'expected_calculations','[]'::jsonb,'date_from',null,'date_to',null,'jurisdiction',null);
  plan_id=(public.nexus_research_plan(ctx,'create',p_plan=>draft,p_key=>'deep-sixty')->>'id')::uuid;
  update public.nexus_account_usage set free_chat_queries=0 where user_id=(ctx->>'user_id')::uuid;
  r=public.nexus_research_run(ctx,'create',plan_id,p_key=>'deep-start',p_command=>'{"non_sensitive_attested":true}');
  if r->>'mode'<>'DEEP_RESEARCH' or r->>'total_steps'<>'13' or jsonb_array_length(r->'source_snapshot')<>60
    or r->'questions'->>0<>'Subquestion1' or r->'questions'->>12<>draft->>'question'
    or (r->>'deadline')::timestamptz<clock_timestamp()+interval '595 seconds' then raise exception 'Deep Research reduced/reordered the accepted scope';end if;
  replay=public.nexus_research_run(ctx,'create',plan_id,p_key=>'deep-start',p_command=>'{"non_sensitive_attested":true}');
  if replay->>'id'<>r->>'id' or (select free_chat_queries from public.nexus_account_usage where user_id=(ctx->>'user_id')::uuid)<>1 then raise exception 'Deep retry admitted twice';end if;
  prior_deadline=(r->>'deadline')::timestamptz;
  replay=public.nexus_research_run(ctx,'resume',plan_id,(r->>'id')::uuid,p_command=>'{"non_sensitive_attested":true}');
  if (replay->>'deadline')::timestamptz<>prior_deadline then raise exception 'Deep queued retry extended deadline';end if;
  for k in 0..12 loop
    if k=1 then
      stale=public.nexus_research_step(ctx,'claim',(r->>'id')::uuid,generation,k);
      perform public.nexus_research_run(ctx,'cancel',plan_id,(r->>'id')::uuid);
      r=public.nexus_research_run(ctx,'resume',plan_id,(r->>'id')::uuid,p_command=>'{"non_sensitive_attested":true}');generation=2;
      if r->>'position'<>'1' or r->>'generation'<>'2' or (r->>'deadline')::timestamptz<clock_timestamp()+interval '595 seconds' then raise exception 'Deep resume lost progress/window';end if;
    end if;
    claimed=public.nexus_research_step(ctx,'claim',(r->>'id')::uuid,generation,k);
    if claimed->>'claimed'<>'true' then raise exception 'Deep step did not claim';end if;
    if k=0 then
      context_receipt=public.nexus_research_candidates(ctx,(r->>'id')::uuid,generation,k,array(select jsonb_array_elements_text(ids)::uuid));
      if jsonb_array_length(context_receipt->'items')<>60 or context_receipt->>'lexical_rows_read'<>'60' then raise exception 'Deep candidate RPC narrowed the60source scope';end if;
    end if;
    if k=12 then
      context_receipt=public.nexus_research_deep_context(ctx,(r->>'id')::uuid,generation,k);
      if jsonb_array_length(context_receipt->'items')<>1 then raise exception 'Deep synthesis failed to recover prior source originals';end if;
    end if;
    select jsonb_build_array(jsonb_build_object('citation_id','S1','document_id',c.document_id,'version_id',c.version_id,'chunk_id',c.id,
      'filename',d.filename,'content',c.original_text,'original_content_hash',c.original_content_hash,'location',c.location,'page_number',2,'chunk_index',0,'excerpt',false)) into quotes
      from public.document_chunks c join public.documents d on d.id=c.document_id where c.document_id=(ids->>0)::uuid;
    select jsonb_agg(jsonb_build_object('document_id',c.document_id,'filename',d.filename,
      'evidence_state',case when ordinal=1 then 'CITED' else 'CANDIDATES_ONLY' end,
      'context_citation_ids',case when ordinal=1 then '["S1"]'::jsonb else '[]'::jsonb end,
      'consulted_sources',jsonb_build_array(jsonb_build_object('version_id',c.version_id,'chunk_id',c.id,'original_content_hash',c.original_content_hash,'page_number',2,'chunk_index',0))) order by ordinal) into documents
      from jsonb_array_elements(r->'source_snapshot') with ordinality snapshot(s,ordinal) join public.document_chunks c on c.document_id=(s->>'document_id')::uuid
      and c.version_id=(s->>'version_id')::uuid and c.workspace_id=(ctx->>'workspace_id')::uuid join public.documents d on d.id=c.document_id;
    select case when k<12 then '[]'::jsonb else coalesce(jsonb_agg(jsonb_build_object('result_index',ordinal-1,'question',x->'question',
      'claim_state',x->'claim_state','abstained',x->'abstained') order by ordinal),'[]') end into prior from jsonb_array_elements(r->'results') with ordinality item(x,ordinal);
    result=jsonb_build_object('question',r->'questions'->k,'answer','Review the synthetic original retention statement [S1].',
      'claim_state','REVIEW_REQUIRED','sources',quotes,'abstained',false,'validated_citation_ids','["S1"]'::jsonb,
      'coverage',jsonb_build_object('completeness','NOT_EXHAUSTIVE','chunks_considered',60),'provider_cost_status','NOT_CALLED','review_state','COMPLETION_CRITERIA_NOT_AUTOMATICALLY_VERIFIED',
      'deep',jsonb_build_object('schema_version','research-deep/1','phase',case when k=12 then 'SYNTHESIS' else 'SUBQUESTION' end,
        'criterion_index',k,'question_count',13,'documents',documents,'prior_results',prior,'limitations','["Independent review required."]'::jsonb,'gaps','[]'::jsonb,
        'interpretation','REVIEW_REQUIRED_CITATIONS_NOT_ENTAILMENT','coverage','BOUNDED_CANDIDATES_AND_CONTEXT_NOT_EXHAUSTIVE'));
    if k=1 then
      replay=public.nexus_research_step(ctx,'commit',(r->>'id')::uuid,1,k,(stale->>'token')::uuid,result)->'run';
      if replay->>'position'<>'1' or replay->>'state'<>'running' then raise exception 'Cancelled Deep generation changed resumed progress';end if;
    end if;
    r=public.nexus_research_step(ctx,'commit',(r->>'id')::uuid,generation,k,(claimed->>'token')::uuid,result)->'run';
    if (r->>'position')::integer<>k+1 or (k<12 and r->>'state'<>'queued') then raise exception 'Deep checkpoint missing/premature';end if;
    replay=public.nexus_research_step(ctx,'commit',(r->>'id')::uuid,generation,k,(claimed->>'token')::uuid,result)->'run';
    if replay->>'position'<>r->>'position' then raise exception 'Deep duplicate appended twice';end if;
  end loop;
  replay=public.nexus_research_run(ctx,'list',plan_id);
  if replay->'items'->0->'results'<>'[]'::jsonb or replay->'items'->0->'results_included'<>'false'::jsonb or replay->'items'->0->>'position'<>'13' then raise exception 'Deep list copied results/lost progress';end if;
  r=public.nexus_research_run(ctx,'read',plan_id,(r->>'id')::uuid);
  if r->>'state'<>'completed' or (select sum(jsonb_array_length(x->'deep'->'documents')) from jsonb_array_elements(r->'results') x)<>780
    or jsonb_array_length(r->'results'->12->'deep'->'prior_results')<>12 then raise exception 'Deep synthesis/source coverage not durable';end if;
  finding=public.nexus_finding(ctx,'create',null,jsonb_build_object('title','Deep synthesis','authored_markdown','','research_run_id',r->>'id','result_index',12),null,
    'deep-synthesis-finding',encode(sha256(convert_to('deep-synthesis-finding','UTF8')),'hex'));
  if finding->>'source_research_position'<>'12' or finding->'research_origin'->'deep'->>'phase'<>'SYNTHESIS'
    or jsonb_array_length(finding->'research_origin'->'deep'->'prior_results')<>12 or jsonb_array_length(finding->'evidence')<>1 then raise exception 'Deep Finding lineage lost';end if;
end; $$;
rollback;
select 'RESEARCH_DEEP_SQL_PASS:60sources12subquestions+main13steps780receipts,600s,originals,cancel/resume/retry,list/read/Finding12;local synthetic direct SQL,not actual executor or hosted quality';
