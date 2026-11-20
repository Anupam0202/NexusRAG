\set ON_ERROR_STOP on
-- Ordinary synthetic selected-source plan/start/reload through actual functions.
-- This file is run only inside the owned disposable local PostgreSQL rehearsal.
set request.jwt.claim.role='service_role';
begin;
insert into auth.users(id,email,raw_user_meta_data)
  values('22222252-2222-4222-8222-222222222222','diligence052@example.invalid','{}');
insert into public.workspace_members(workspace_id,user_id,role)
  values('11111111-1111-4111-8111-111111111111','22222252-2222-4222-8222-222222222222','editor');
do $$
declare
  ws uuid='11111111-1111-4111-8111-111111111111';actor uuid='22222252-2222-4222-8222-222222222222';
  context jsonb;plan jsonb;stored jsonb;started jsonb;replayed jsonb;reopened jsonb;
  sources jsonb='[]';doc uuid;version uuid;chunk uuid;body text;i integer;
begin
  for i in 1..60 loop
    doc=('d0520000-0000-4000-8100-'||lpad(i::text,12,'0'))::uuid;
    version=('e0520000-0000-4000-8100-'||lpad(i::text,12,'0'))::uuid;
    chunk=('f0520000-0000-4000-8100-'||lpad(i::text,12,'0'))::uuid;
    body='Synthetic Example Works '||i||' registry EX-'||i||'. Filing asserts ownership by Example Holdings; identity and current ownership require review.';
    insert into public.documents(id,workspace_id,uploaded_by,filename,original_filename,status)
      values(doc,ws,actor,'Synthetic entity '||i||'.txt','Synthetic entity '||i||'.txt','ready');
    insert into public.document_versions(id,workspace_id,document_id,original_bucket,original_key,original_hash,original_bytes,
      original_verified_at,parser_version,chunker_version,lifecycle_epoch,publication_state,index_generation,data_classification,
      classification_declared_by,classification_declared_at)
      values(version,ws,doc,'documents',doc::text,repeat('a',64),1,now(),'synthetic','synthetic',1,'ready','diligence052-generation',
        'non_sensitive',actor,now());
    update public.documents set active_version_id=version where id=doc;
    insert into public.document_chunks(id,workspace_id,document_id,version_id,chunk_index,content,original_text,original_content_hash,
      page_number,location,embedding_space_id)
      values(chunk,ws,doc,version,0,body,body,encode(sha256(convert_to(body,'UTF8')),'hex'),null,
        jsonb_build_object('char_start',0,'char_end',char_length(body)),'synthetic-space');
    sources=sources||jsonb_build_array(doc);
  end loop;
  select jsonb_build_object('workspace_id',w.id,'user_id',actor,'membership_revision',w.capability_revision,
    'policy_id',s.active_policy_id,'policy_version',s.policy_version,'deadline',clock_timestamp()+interval '5 minutes') into context
    from public.workspaces w join public.workspace_settings s on s.workspace_id=w.id where w.id=ws;
  plan=jsonb_build_object('plan_id','diligence052-ordinary','mode','DUE_DILIGENCE',
    'question','What do these synthetic filings actually report about Example Works?',
    'subquestions',(select jsonb_agg('Inspect synthetic registry evidence '||n) from generate_series(1,12) n),
    'private_source_ids',sources,'public_provider_ids','[]'::jsonb,'date_from',null,'date_to',null,'jurisdiction',null,
    'entity_scope','["Example Works"]'::jsonb,'rights_constraints','[]'::jsonb,'expected_calculations','[]'::jsonb,
    'completion_criteria','["Preserve exact identifiers, aliases, filings and temporal relationship wording; independently review uncertain matches."]'::jsonb);
  stored=public.nexus_research_plan(context,'create',p_plan=>plan,p_key=>'diligence052-ordinary-plan');
  if stored->'plan'<>plan then raise exception 'Due Diligence plan lost its selected source/entity scope';end if;
  started=public.nexus_research_run(context,'create',(stored->>'id')::uuid,p_key=>'diligence052-ordinary-start',
    p_command=>'{"non_sensitive_attested":true}');
  if started->>'mode'<>'DUE_DILIGENCE' or started->>'state'<>'queued'
    or started->>'persistence_state'<>'PERSISTED' or (started->>'total_steps')::integer<>13
    or jsonb_array_length(started->'source_snapshot')<>60 then raise exception 'Due Diligence start receipt lost accepted mode bounds';end if;
  replayed=public.nexus_research_run(context,'create',(stored->>'id')::uuid,p_key=>'diligence052-ordinary-start',
    p_command=>'{"non_sensitive_attested":true}');
  reopened=public.nexus_research_run(context,'read',(stored->>'id')::uuid,(started->>'id')::uuid);
  if replayed->>'id'<>started->>'id' or reopened<>started then raise exception 'Due Diligence ordinary retry/read did not recover the same stored run';end if;
  if (select free_chat_queries from public.nexus_account_usage where user_id=actor)<>1 then raise exception 'Ordinary Due Diligence retry repeated account admission';end if;
  plan=jsonb_set(jsonb_set(plan,'{question}',to_jsonb(repeat(chr(128202),10000))),'{plan_id}','"diligence052-unicode"');
  stored=public.nexus_research_plan(context,'create',p_plan=>plan,p_key=>'diligence052-unicode-plan');
  started=public.nexus_research_run(context,'create',(stored->>'id')::uuid,p_key=>'diligence052-unicode-start',
    p_command=>'{"non_sensitive_attested":true}');
  reopened=public.nexus_research_run(context,'read',(stored->>'id')::uuid,(started->>'id')::uuid);
  if char_length(reopened->'questions'->>0)<>10000 or reopened->'questions'->>0<>plan->>'question'
    then raise exception 'Accepted Unicode question did not survive plan/start/read';end if;
end;$$;
rollback;
select 'RESEARCH_DILIGENCE_ORDINARY_SQL_PASS selected60_questions13_subject_scope_persisted_replay_read; actual owned local database only';
