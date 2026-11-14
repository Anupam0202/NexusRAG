\set ON_ERROR_STOP on
begin;
set request.jwt.claim.role='service_role';
do $$
declare ctx jsonb;draft jsonb;plan_id uuid;r jsonb;replay jsonb;claimed jsonb;stale jsonb;result jsonb;quotes jsonb;documents jsonb;pair jsonb;finding jsonb;
  ids jsonb='[]';doc uuid;ver uuid;chunk uuid;source_text text;i integer;k integer;generation integer=1;prior_deadline timestamptz;
begin
  select jsonb_build_object('workspace_id',w.id,'user_id','22222222-2222-4222-8222-222222222222','membership_revision',w.capability_revision,
    'policy_id',s.active_policy_id,'policy_version',s.policy_version,'deadline',clock_timestamp()+interval '5 minutes') into ctx
    from public.workspaces w join public.workspace_settings s on s.workspace_id=w.id where w.id='11111111-1111-4111-8111-111111111111';
  for i in 1..50 loop
    doc=('d0380000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid;ver=('e0380000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid;chunk=('f0380000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid;
    source_text=chr(128202)||' Observed 30 days. Later reported 45 days.';
    insert into public.documents(id,workspace_id,uploaded_by,filename,original_filename,status)
      values(doc,(ctx->>'workspace_id')::uuid,(ctx->>'user_id')::uuid,'Context'||i,'Context'||i,'ready');
    insert into public.document_versions(id,workspace_id,document_id,original_bucket,original_key,original_hash,original_bytes,original_verified_at,
      parser_version,chunker_version,lifecycle_epoch,publication_state,index_generation,data_classification,classification_declared_by,classification_declared_at)
      values(ver,(ctx->>'workspace_id')::uuid,doc,'documents','synthetic-contradiction-'||i,repeat('a',64),1,now(),'synthetic','synthetic',1,'ready','contradiction-generation','non_sensitive',(ctx->>'user_id')::uuid,now());
    update public.documents set active_version_id=ver where id=doc;
    insert into public.document_chunks(id,workspace_id,document_id,version_id,chunk_index,content,original_text,original_content_hash,page_number,location,embedding_space_id)
      values(chunk,(ctx->>'workspace_id')::uuid,doc,ver,0,source_text,source_text,encode(sha256(convert_to(source_text,'UTF8')),'hex'),2,'{"page":2}','synthetic-space');
    ids=ids||to_jsonb(doc::text);
  end loop;
  select plan into strict draft from public.research_plans where plan->>'plan_id'='mode-CONTRADICTION_ANALYSIS';
  draft=draft||jsonb_build_object('plan_id','contradiction-fifty','question','Inspect potentially conflicting source statements.','private_source_ids',ids,
    'subquestions',jsonb_build_array('Criterion2','Criterion3','Criterion4','Criterion5','Criterion6','Criterion7','Criterion8','Criterion9','Criterion10','Criterion11'),
    'public_provider_ids','[]'::jsonb,'entity_scope','[]'::jsonb,'rights_constraints','[]'::jsonb,'expected_calculations','[]'::jsonb,'date_from',null,'date_to',null,'jurisdiction',null);
  plan_id=(public.nexus_research_plan(ctx,'create',p_plan=>draft,p_key=>'contradiction-fifty')->>'id')::uuid;
  update public.nexus_account_usage set free_chat_queries=0 where user_id=(ctx->>'user_id')::uuid;
  r=public.nexus_research_run(ctx,'create',plan_id,p_key=>'contradiction-start',p_command=>'{"non_sensitive_attested":true}');
  if r->>'mode'<>'CONTRADICTION_ANALYSIS' or r->>'total_steps'<>'11' or jsonb_array_length(r->'questions')<>11 or jsonb_array_length(r->'source_snapshot')<>50
    or (r->>'deadline')::timestamptz<clock_timestamp()+interval '415 seconds' then raise exception 'Contradiction reduced accepted source/question/runtime scope'; end if;
  replay=public.nexus_research_run(ctx,'create',plan_id,p_key=>'contradiction-start',p_command=>'{"non_sensitive_attested":true}');
  if replay->>'id'<>r->>'id' or (select free_chat_queries from public.nexus_account_usage where user_id=(ctx->>'user_id')::uuid)<>1 then raise exception 'Contradiction retry admitted twice'; end if;
  prior_deadline=(r->>'deadline')::timestamptz;
  replay=public.nexus_research_run(ctx,'resume',plan_id,(r->>'id')::uuid,p_command=>'{"non_sensitive_attested":true}');
  if (replay->>'deadline')::timestamptz<>prior_deadline then raise exception 'Queued contradiction retry extended deadline'; end if;
  for k in 0..10 loop
    if k=1 then
      stale=public.nexus_research_step(ctx,'claim',(r->>'id')::uuid,generation,k);
      perform public.nexus_research_run(ctx,'cancel',plan_id,(r->>'id')::uuid);
      r=public.nexus_research_run(ctx,'resume',plan_id,(r->>'id')::uuid,p_command=>'{"non_sensitive_attested":true}');generation=2;
      if r->>'position'<>'1' or r->>'generation'<>'2' or (r->>'deadline')::timestamptz<clock_timestamp()+interval '415 seconds' then raise exception 'Contradiction lost resume progress/window'; end if;
    end if;
    claimed=public.nexus_research_step(ctx,'claim',(r->>'id')::uuid,generation,k);
    if claimed->>'claimed'<>'true' then raise exception 'Contradiction step did not claim'; end if;
    select jsonb_agg(jsonb_build_object('citation_id',case ordinal when 1 then 'S1' else 'S2' end,'document_id',c.document_id,'version_id',c.version_id,'chunk_id',c.id,
      'filename',d.filename,'content',c.original_text,'original_content_hash',c.original_content_hash,'location',c.location,'page_number',2,'chunk_index',0,'excerpt',false) order by ordinal) into quotes
      from jsonb_array_elements(r->'source_snapshot') with ordinality snapshot(s,ordinal) join public.document_chunks c on c.document_id=(s->>'document_id')::uuid
      and c.version_id=(s->>'version_id')::uuid and c.workspace_id=(ctx->>'workspace_id')::uuid join public.documents d on d.id=c.document_id where ordinal in(1,50);
    pair=jsonb_build_object('left',jsonb_build_object('document_id',quotes->0->'document_id','citation_id','S1','quote','Observed 30 days.','quote_start',2,'quote_end',19),
      'right',jsonb_build_object('document_id',quotes->1->'document_id','citation_id','S2','quote','Later reported 45 days.',
        'quote_start',position('Later reported 45 days.' in source_text)-1,'quote_end',length(source_text)),
      'relationship','INSUFFICIENT_CONTEXT','explanation','Entity and reporting-period equivalence require independent review.','claim_state','REVIEW_REQUIRED');
    select jsonb_agg(jsonb_build_object('document_id',c.document_id,'filename',d.filename,'evidence_state',case when ordinal in(1,50) then 'PAIRED_CANDIDATE' else 'NO_PAIR_PROPOSED' end,
      'consulted_sources',jsonb_build_array(jsonb_build_object('version_id',c.version_id,'chunk_id',c.id,'original_content_hash',c.original_content_hash,'page_number',2,'chunk_index',0))) order by ordinal) into documents
      from jsonb_array_elements(r->'source_snapshot') with ordinality snapshot(s,ordinal) join public.document_chunks c on c.document_id=(s->>'document_id')::uuid
      and c.version_id=(s->>'version_id')::uuid and c.workspace_id=(ctx->>'workspace_id')::uuid join public.documents d on d.id=c.document_id;
    result=jsonb_build_object('question',r->'questions'->k,'answer','Inspect both quoted statements and their contexts; this is not an automatic conflict verdict.',
      'claim_state','REVIEW_REQUIRED','sources',quotes,'abstained',false,'validated_citation_ids',jsonb_build_array('S1','S2'),
      'coverage',jsonb_build_object('completeness','NOT_EXHAUSTIVE','chunks_considered',50),'provider_cost_status','NOT_CALLED','review_state','COMPLETION_CRITERIA_NOT_AUTOMATICALLY_VERIFIED',
      'contradiction',jsonb_build_object('schema_version','research-contradiction/1','criterion_index',k,'total_documents',50,'pairs',jsonb_build_array(pair),'documents',documents,
        'rejected_pairs',0,'interpretation','REVIEW_REQUIRED_NO_AUTOMATIC_CONFLICT_VERDICT','coverage','BOUNDED_RETRIEVAL_AT_MOST_SIX_PAIRS_NOT_EXHAUSTIVE'));
    if k=1 then
      replay=public.nexus_research_step(ctx,'commit',(r->>'id')::uuid,1,k,(stale->>'token')::uuid,result)->'run';
      if replay->>'position'<>'1' or replay->>'state'<>'running' then raise exception 'Cancelled generation changed the resumed run'; end if;
    end if;
    r=public.nexus_research_step(ctx,'commit',(r->>'id')::uuid,generation,k,(claimed->>'token')::uuid,result)->'run';
    if (r->>'position')::integer<>k+1 or (k<10 and r->>'state'<>'queued') then raise exception 'Contradiction checkpoint missing/premature'; end if;
    replay=public.nexus_research_step(ctx,'commit',(r->>'id')::uuid,generation,k,(claimed->>'token')::uuid,result)->'run';
    if replay->>'position'<>r->>'position' then raise exception 'Contradiction duplicate appended twice'; end if;
  end loop;
  replay=public.nexus_research_run(ctx,'list',plan_id);
  if replay->'items'->0->'results'<>'[]'::jsonb or replay->'items'->0->'results_included'<>'false'::jsonb or replay->'items'->0->>'position'<>'11' then raise exception 'Contradiction list copied results/lost progress'; end if;
  r=public.nexus_research_run(ctx,'read',plan_id,(r->>'id')::uuid);
  if r->>'state'<>'completed' or (select sum(jsonb_array_length(e->'contradiction'->'documents')) from jsonb_array_elements(r->'results') e)<>550 then raise exception 'Contradiction full source receipts not durable'; end if;
  finding=public.nexus_finding(ctx,'create',null,jsonb_build_object('title','Final contradiction criterion','authored_markdown','','research_run_id',r->>'id','result_index',10),null,
    'full-contradiction-finding',encode(sha256(convert_to('full-contradiction-finding','UTF8')),'hex'));
  if finding->>'source_research_position'<>'10' or finding->'research_origin'->'contradiction'->>'criterion_index'<>'10'
    or jsonb_array_length(finding->'research_origin'->'contradiction'->'pairs')<>1 or jsonb_array_length(finding->'evidence')<>2 then raise exception 'Contradiction Finding lineage lost'; end if;
end; $$;
rollback;
select 'RESEARCH_CONTRADICTION_SQL_PASS:50sources11criteria550consultedreceipts,exact Unicode paired quotes,420s,retry/cancel/resume,list/read/Finding10; synthetic transaction rolled back';
