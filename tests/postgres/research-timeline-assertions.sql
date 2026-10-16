\set ON_ERROR_STOP on
begin;
set request.jwt.claim.role='service_role';
do $$
declare ctx jsonb;draft jsonb;plan_id uuid;r jsonb;replay jsonb;claimed jsonb;result jsonb;events jsonb;quotes jsonb;citations jsonb;finding jsonb;
  ids jsonb='[]';doc uuid;ver uuid;chunk uuid;source_text text;i integer;k integer;generation integer=1;prior_deadline timestamptz;
begin
  select jsonb_build_object('workspace_id',w.id,'user_id','22222222-2222-4222-8222-222222222222','membership_revision',w.capability_revision,
    'policy_id',s.active_policy_id,'policy_version',s.policy_version,'deadline',clock_timestamp()+interval '5 minutes') into ctx
    from public.workspaces w join public.workspace_settings s on s.workspace_id=w.id where w.id='11111111-1111-4111-8111-111111111111';
  for i in 1..40 loop
    doc=('d0330000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid;ver=('e0330000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid;chunk=('f0330000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid;
    source_text=chr(128202)||' Issued 2024. Effective 2024-02-29.';
    insert into public.documents(id,workspace_id,uploaded_by,filename,original_filename,status)
      values(doc,(ctx->>'workspace_id')::uuid,(ctx->>'user_id')::uuid,'Timeline'||i,'Timeline'||i,'ready');
    insert into public.document_versions(id,workspace_id,document_id,original_bucket,original_key,original_hash,original_bytes,original_verified_at,
      parser_version,chunker_version,lifecycle_epoch,publication_state,index_generation,data_classification,classification_declared_by,classification_declared_at)
      values(ver,(ctx->>'workspace_id')::uuid,doc,'documents','synthetic-timeline-'||i,repeat('a',64),1,now(),'synthetic','synthetic',1,'ready','timeline-generation','non_sensitive',(ctx->>'user_id')::uuid,now());
    update public.documents set active_version_id=ver where id=doc;
    insert into public.document_chunks(id,workspace_id,document_id,version_id,chunk_index,content,original_text,original_content_hash,page_number,location,embedding_space_id)
      values(chunk,(ctx->>'workspace_id')::uuid,doc,ver,0,source_text,source_text,encode(sha256(convert_to(source_text,'UTF8')),'hex'),2,'{"page":2}','synthetic-space');
    ids=ids||to_jsonb(doc::text);
  end loop;
  select plan into strict draft from public.research_plans where plan->>'plan_id'='mode-TIMELINE';
  draft=draft||jsonb_build_object('plan_id','timeline-forty','question','Build a source chronology.','private_source_ids',ids,
    'subquestions',jsonb_build_array('Criterion2','Criterion3','Criterion4','Criterion5','Criterion6','Criterion7','Criterion8','Criterion9'),
    'public_provider_ids','[]'::jsonb,'entity_scope','[]'::jsonb,'rights_constraints','[]'::jsonb,'expected_calculations','[]'::jsonb,'date_from',null,'date_to',null,'jurisdiction',null);
  plan_id=(public.nexus_research_plan(ctx,'create',p_plan=>draft,p_key=>'timeline-forty')->>'id')::uuid;
  update public.nexus_account_usage set free_chat_queries=0 where user_id=(ctx->>'user_id')::uuid;
  r=public.nexus_research_run(ctx,'create',plan_id,p_key=>'timeline-start',p_command=>'{"non_sensitive_attested":true}');
  if r->>'mode'<>'TIMELINE' or r->>'total_steps'<>'45' or jsonb_array_length(r->'questions')<>9 or jsonb_array_length(r->'source_snapshot')<>40 then raise exception 'Timeline reduced accepted scope'; end if;
  replay=public.nexus_research_run(ctx,'create',plan_id,p_key=>'timeline-start',p_command=>'{"non_sensitive_attested":true}');
  if replay->>'id'<>r->>'id' or (select free_chat_queries from public.nexus_account_usage where user_id=(ctx->>'user_id')::uuid)<>1 then raise exception 'Timeline retry admitted twice'; end if;
  prior_deadline=(r->>'deadline')::timestamptz;
  replay=public.nexus_research_run(ctx,'resume',plan_id,(r->>'id')::uuid,p_command=>'{"non_sensitive_attested":true}');
  if (replay->>'deadline')::timestamptz<>prior_deadline then raise exception 'Queued Timeline retry extended deadline'; end if;
  for k in 0..44 loop
    if k=1 then
      perform public.nexus_research_run(ctx,'cancel',plan_id,(r->>'id')::uuid);
      r=public.nexus_research_run(ctx,'resume',plan_id,(r->>'id')::uuid,p_command=>'{"non_sensitive_attested":true}');generation=2;
      if r->>'position'<>'1' or r->>'generation'<>'2' or (r->>'deadline')::timestamptz<clock_timestamp()+interval '295 seconds' then raise exception 'Timeline lost resume progress/window'; end if;
    end if;
    claimed=public.nexus_research_step(ctx,'claim',(r->>'id')::uuid,generation,k);
    if claimed->>'claimed'<>'true' then raise exception 'Timeline step%did not claim',k; end if;
    select jsonb_agg(jsonb_build_object('citation_id','S'||((ordinal-1)%8+1),'document_id',c.document_id,'version_id',c.version_id,'chunk_id',c.id,
      'filename',d.filename,'content',c.original_text,'original_content_hash',c.original_content_hash,'location',c.location,'page_number',2,'chunk_index',0,'excerpt',false) order by ordinal),
      jsonb_agg(to_jsonb('S'||((ordinal-1)%8+1)) order by ordinal) into quotes,citations
      from jsonb_array_elements(r->'source_snapshot') with ordinality source(s,ordinal) join public.document_chunks c on c.document_id=(s->>'document_id')::uuid
      and c.version_id=(s->>'version_id')::uuid and c.workspace_id=(ctx->>'workspace_id')::uuid join public.documents d on d.id=c.document_id
      where ordinal>(k%5)*8 and ordinal<=(k%5)*8+8;
    select jsonb_agg(jsonb_build_object('document_id',s->'document_id','filename',s->>'filename','citation_id',s->>'citation_id','quote',q.quote,
      'quote_start',position(q.quote in s->>'content')-1,'quote_end',position(q.quote in s->>'content')-1+length(q.quote),'date_text',q.date_text,
      'date_role',q.role_name,'date',public.nexus_timeline_date(q.date_text),'claim_state','REVIEW_REQUIRED') order by q.date_text,s->>'document_id') into events
      from jsonb_array_elements(quotes) s cross join (values('Issued 2024.','2024','PUBLISHED'),('Effective 2024-02-29.','2024-02-29','EFFECTIVE')) q(quote,date_text,role_name);
    result=jsonb_build_object('question',(r->'questions')->(k/5),'answer','Inspect the saved source events.','claim_state','REVIEW_REQUIRED','sources',quotes,'abstained',false,
      'validated_citation_ids',citations,'coverage',jsonb_build_object('completeness','NOT_EXHAUSTIVE','chunks_considered',8),'provider_cost_status','NOT_CALLED',
      'review_state','COMPLETION_CRITERIA_NOT_AUTOMATICALLY_VERIFIED','timeline',jsonb_build_object('schema_version','research-timeline/1','criterion_index',k/5,'batch_index',k%5,
      'batch_count',5,'total_documents',40,'events',events,'gaps','[]'::jsonb,'interpretation','REVIEW_REQUIRED_BOUNDS_NOT_CAUSAL_ORDER','coverage','AT_MOST_TWO_EVENTS_PER_DOCUMENT_PER_CRITERION_NOT_EXHAUSTIVE'));
    r=public.nexus_research_step(ctx,'commit',(r->>'id')::uuid,generation,k,(claimed->>'token')::uuid,result)->'run';
    if (r->>'position')::integer<>k+1 or (k<44 and r->>'state'<>'queued') then raise exception 'Timeline checkpoint missing/premature'; end if;
    replay=public.nexus_research_step(ctx,'commit',(r->>'id')::uuid,generation,k,(claimed->>'token')::uuid,result)->'run';
    if replay->>'position'<>r->>'position' then raise exception 'Timeline duplicate appended twice'; end if;
  end loop;
  replay=public.nexus_research_run(ctx,'list',plan_id);
  if replay->'items'->0->'results'<>'[]'::jsonb or replay->'items'->0->'results_included'<>'false'::jsonb or replay->'items'->0->>'position'<>'45' then raise exception 'Timeline list copied results/lost progress'; end if;
  r=public.nexus_research_run(ctx,'read',plan_id,(r->>'id')::uuid);
  if r->>'state'<>'completed' or (select sum(jsonb_array_length(e->'timeline'->'events')) from jsonb_array_elements(r->'results') e)<>720 then raise exception 'Timeline full source events not durable'; end if;
  finding=public.nexus_finding(ctx,'create',null,jsonb_build_object('title','Final Timeline batch','authored_markdown','','research_run_id',r->>'id','result_index',44),null,
    'full-timeline-finding',encode(sha256(convert_to('full-timeline-finding','UTF8')),'hex'));
  if finding->>'source_research_position'<>'44' or finding->'research_origin'->'timeline'->>'criterion_index'<>'8'
    or jsonb_array_length(finding->'research_origin'->'timeline'->'events')<>16 or jsonb_array_length(finding->'evidence')<>8 then raise exception 'Timeline Finding lineage lost'; end if;
end; $$;
rollback;
select 'RESEARCH_TIMELINE_SQL_PASS:40sources9criteria45batches720events,Unicode source spans,retry/cancel/resume300s,list/read/Finding44; synthetic transaction rolled back';
