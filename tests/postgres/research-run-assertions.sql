\set ON_ERROR_STOP on
begin;
set request.jwt.claim.role='service_role';
do $$
declare ctx jsonb; draft jsonb; plan_id uuid; r jsonb; claimed jsonb; saved jsonb; next_run jsonb; result jsonb; page jsonb;
  doc uuid='d0290000-0000-4000-8000-000000000001'; ver uuid='d0290000-0000-4000-8000-000000000002'; used integer;
begin
  select jsonb_build_object('workspace_id',w.id,'user_id','22222222-2222-4222-8222-222222222222',
    'membership_revision',w.capability_revision,'policy_id',s.active_policy_id,'policy_version',s.policy_version,
    'deadline',clock_timestamp()+interval '5 minutes') into ctx from public.workspaces w join public.workspace_settings s on s.workspace_id=w.id
    where w.id='11111111-1111-4111-8111-111111111111';
  insert into public.documents(id,workspace_id,uploaded_by,filename,original_filename,status)
    values(doc,'11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','research.txt','research.txt','ready');
  insert into public.document_versions(id,workspace_id,document_id,original_bucket,original_key,original_hash,original_bytes,
    original_verified_at,parser_version,chunker_version,lifecycle_epoch,publication_state,index_generation,data_classification,classification_declared_by,classification_declared_at)
    values(ver,'11111111-1111-4111-8111-111111111111',doc,'documents','synthetic-run',repeat('a',64),1,now(),'synthetic','synthetic',1,'ready','research-generation',
      'non_sensitive','22222222-2222-4222-8222-222222222222',now());
  update public.documents set active_version_id=ver where id=doc;
  select plan into strict draft from public.research_plans where plan->>'plan_id'='mode-EVIDENCE_ANSWER';
  draft=draft||jsonb_build_object('plan_id','answer-run','private_source_ids',jsonb_build_array(upper(doc::text)),'subquestions',jsonb_build_array('What is the exception?'));
  plan_id=(public.nexus_research_plan(ctx,'create',p_plan=>draft,p_key=>'answer-run')->>'id')::uuid;
  update public.nexus_account_usage set free_chat_queries=0 where user_id='22222222-2222-4222-8222-222222222222';
  r=public.nexus_research_run(ctx,'create',plan_id,p_key=>'start-one',p_command=>'{"non_sensitive_attested":true}');
  select free_chat_queries into used from public.nexus_account_usage where user_id='22222222-2222-4222-8222-222222222222';
  if r->>'state'<>'queued' or r->>'source_state'<>'CURRENT' or jsonb_array_length(r->'questions')<>2 then raise exception 'Run start did not save scope/questions'; end if;
  if public.nexus_research_run(ctx,'create',plan_id,p_key=>'start-one',p_command=>'{"non_sensitive_attested":true}')->>'id'<>r->>'id'
    or (select free_chat_queries from public.nexus_account_usage where user_id='22222222-2222-4222-8222-222222222222')<>used then raise exception 'Start replay consumed another account query'; end if;
  next_run=public.nexus_research_run(ctx,'create',plan_id,p_key=>'start-two',p_command=>'{"non_sensitive_attested":true}');
  page=public.nexus_research_run(ctx,'list',plan_id,p_limit=>1);
  if page->>'next_after' is null or jsonb_array_length(public.nexus_research_run(ctx,'list',plan_id,p_limit=>1,p_after=>(page->>'next_after')::uuid)->'items')<>1 then raise exception 'Run paging lost a saved run'; end if;
  claimed=public.nexus_research_step(ctx,'claim',(r->>'id')::uuid,1,0);
  if claimed->>'claimed'<>'true' or claimed->'run'->>'state'<>'running' then raise exception 'Run claim failed'; end if;
  if public.nexus_research_step(ctx,'claim',(r->>'id')::uuid,1,0)->>'claimed'<>'false' then raise exception 'Duplicate queue delivery claimed live question'; end if;
  result=jsonb_build_object('question',draft->>'question','answer','No sufficient evidence.','claim_state','UNSUPPORTED','sources','[]'::jsonb,'abstained',true,
    'validated_citation_ids','[]'::jsonb,'coverage',jsonb_build_object('completeness','NOT_EXHAUSTIVE','chunks_considered',0),
    'provider_cost_status','NOT_CALLED','review_state','COMPLETION_CRITERIA_NOT_AUTOMATICALLY_VERIFIED');
  saved=public.nexus_research_step(ctx,'commit',(r->>'id')::uuid,1,0,(claimed->>'token')::uuid,result);
  if saved->'run'->>'position'<>'1' or saved->'run'->>'state'<>'queued' then raise exception 'Question checkpoint not durable'; end if;
  claimed=public.nexus_research_step(ctx,'claim',(r->>'id')::uuid,1,1);
  perform public.nexus_research_run(ctx,'cancel',plan_id,(r->>'id')::uuid);
  if public.nexus_research_step(ctx,'commit',(r->>'id')::uuid,1,1,(claimed->>'token')::uuid,jsonb_set(result,'{question}',to_jsonb('What is the exception?'::text)))->'run'->>'position'<>'1'
    then raise exception 'In-flight cancelled result was committed'; end if;
  if public.nexus_research_step(ctx,'claim',(r->>'id')::uuid,1,1)->>'claimed'<>'false' then raise exception 'Cancelled run continued'; end if;
  saved=public.nexus_research_run(ctx,'resume',plan_id,(r->>'id')::uuid,p_command=>'{"non_sensitive_attested":true}');
  if saved->>'position'<>'1' or saved->>'generation'<>'2' then raise exception 'Resume discarded saved answer'; end if;
  if public.nexus_research_step(ctx,'claim',(r->>'id')::uuid,1,1)->>'claimed'<>'false' then raise exception 'Old delivery resumed new generation'; end if;
  claimed=public.nexus_research_step(ctx,'claim',(r->>'id')::uuid,2,1);
  result=jsonb_set(result,'{question}',to_jsonb('What is the exception?'::text));
  saved=public.nexus_research_step(ctx,'commit',(r->>'id')::uuid,2,1,(claimed->>'token')::uuid,result);
  if saved->'run'->>'state'<>'completed' or jsonb_array_length(saved->'run'->'results')<>2 then raise exception 'Execution completed before all durable answers'; end if;
  if public.nexus_research_step(ctx,'commit',(r->>'id')::uuid,2,1,(claimed->>'token')::uuid,result)->'run'->>'position'<>'2' then raise exception 'Duplicate commit appended twice'; end if;
  claimed=public.nexus_research_step(ctx,'claim',(next_run->>'id')::uuid,1,0);
  update public.research_runs set deadline=clock_timestamp()-interval '1 second' where id=(next_run->>'id')::uuid;
  if public.nexus_research_run(ctx,'read',plan_id,(next_run->>'id')::uuid)->>'state'<>'interrupted' then raise exception 'Expired run still looked active'; end if;
  saved=public.nexus_research_step(ctx,'commit',(next_run->>'id')::uuid,1,0,(claimed->>'token')::uuid,jsonb_set(result,'{question}',to_jsonb(draft->>'question')));
  if saved->'run'->>'position'<>'0' or saved->'run'->>'error_code'<>'RUN_DEADLINE' then raise exception 'Late answer was reported saved'; end if;
  update public.document_versions set index_generation='replacement' where id=ver;
  saved=public.nexus_research_run(ctx,'read',plan_id,(r->>'id')::uuid);
  if saved->>'source_state'<>'UNAVAILABLE_OR_CHANGED' or saved->'results'<>'[]'::jsonb then raise exception 'Changed source retained available answers'; end if;
  begin
    perform public.nexus_research_run(ctx,'resume',plan_id,(next_run->>'id')::uuid,p_command=>'{"non_sensitive_attested":true}');
    raise exception 'Changed source run resumed';
  exception when others then if sqlerrm<>'NR:SOURCE_UNAVAILABLE' then raise; end if; end;
end; $$;
rollback;
select 'RESEARCH_RUN_SQL_PASS: persistence/replay/account-once/paging/claim/checkpoint/cancel/resume/deadline/source-change; synthetic transaction rolled back';
