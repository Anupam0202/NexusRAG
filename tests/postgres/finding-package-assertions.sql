\set ON_ERROR_STOP on
begin;
set request.jwt.claim.role='service_role';
-- Compare the summary fast path with the authoritative exact-byte read.
-- This helper and every fixture mutation disappear with the outer rollback.
create function pg_temp.assert_finding_package_parity(
  ctx jsonb,finding_id uuid,package_id uuid,expected_state text,expected_reason text default null
) returns void language plpgsql as $$
declare detail jsonb;listed jsonb;item jsonb;
begin
  detail=public.nexus_finding_package(ctx,'read',finding_id,package_id);
  listed=public.nexus_finding_package(ctx,'list',finding_id,p_limit=>50);
  select value into item from jsonb_array_elements(listed->'items') where value->>'id'=package_id::text;
  if item is distinct from detail-'manifest_text' or item ? 'manifest_text'
    or item->>'state' is distinct from expected_state or item->>'reason' is distinct from expected_reason
    then raise exception 'Package summary/read parity failed: expected %/%, detail %, summary %',
      expected_state,expected_reason,detail-'manifest_text',item;end if;
end;$$;
do $$
declare ctx jsonb;draft jsonb;r jsonb;claim jsonb;answer jsonb;f jsonb;rights jsonb;command jsonb;package jsonb;second_package jsonb;replay jsonb;manifest jsonb;
  ws uuid='11111111-1111-4111-8111-111111111111';actor uuid='22222222-2222-4222-8222-222222222222';
  reviewer uuid='33333333-3333-4333-8333-333333333333';doc uuid='d0610000-0000-4000-8000-000000000001';
  ver uuid='d0610000-0000-4000-8000-000000000002';chunk uuid='d0610000-0000-4000-8000-000000000003';
  original text='Owned synthetic statement: 1.005 kg; not a certification.';hash text;fid uuid;pid uuid;rid uuid;entries integer;
  fixture record;renewed jsonb;later_answer jsonb;legacy_finding jsonb;legacy_package jsonb;
  legacy_session uuid='d0610000-0000-4000-8000-000000000004';legacy_job uuid='d0610000-0000-4000-8000-000000000005';
  legacy_reservation uuid='d0610000-0000-4000-8000-000000000006';legacy_run uuid='d0610000-0000-4000-8000-000000000007';
begin
  insert into public.workspace_members(workspace_id,user_id,role) values(ws,reviewer,'editor') on conflict(workspace_id,user_id) do update set role='editor';
  select jsonb_build_object('workspace_id',ws,'user_id',actor,'membership_revision',w.capability_revision,
    'policy_id',s.active_policy_id,'policy_version',s.policy_version,'deadline',clock_timestamp()+interval '5 minutes') into ctx
    from public.workspaces w join public.workspace_settings s on s.workspace_id=w.id where w.id=ws;
  hash=encode(sha256(convert_to(original,'UTF8')),'hex');
  insert into public.documents(id,workspace_id,uploaded_by,filename,original_filename,status,chunk_count)
    values(doc,ws,actor,'owned-source.txt','owned-source.txt','ready',1);
  insert into public.document_versions(id,workspace_id,document_id,original_bucket,original_key,original_hash,original_bytes,
    original_verified_at,parser_version,chunker_version,lifecycle_epoch,publication_state,index_generation,data_classification,classification_declared_by,classification_declared_at)
    values(ver,ws,doc,'documents','synthetic-package61',hash,octet_length(original),now(),'synthetic','synthetic',1,'ready','package-generation',
      'non_sensitive',actor,now());
  update public.documents set active_version_id=ver where id=doc;
  insert into public.document_chunks(id,workspace_id,document_id,version_id,chunk_index,content,original_text,original_content_hash,page_number,location,embedding_space_id)
    values(chunk,ws,doc,ver,0,original,original,hash,2,'{"page":2,"section":"mass"}','synthetic-space');
  select plan into strict draft from public.research_plans where plan->>'plan_id'='mode-EVIDENCE_ANSWER';
  draft=draft||jsonb_build_object('plan_id','package61','private_source_ids',jsonb_build_array(doc),
    'subquestions',jsonb_build_array('Follow-up synthetic question'));
  pid=(public.nexus_research_plan(ctx,'create',p_plan=>draft,p_key=>'package61-plan')->>'id')::uuid;
  update public.nexus_account_usage set free_chat_queries=0 where user_id=actor;
  r=public.nexus_research_run(ctx,'create',pid,p_key=>'package61-run',p_command=>'{"non_sensitive_attested":true}');
  claim=public.nexus_research_step(ctx,'claim',(r->>'id')::uuid,1,0);
  answer=jsonb_build_object('question',draft->>'question','answer','Synthetic mass is 1.005 kg [S1].','claim_state','REVIEW_REQUIRED','abstained',false,
    'sources',jsonb_build_array(jsonb_build_object('citation_id','S1','document_id',doc,'version_id',ver,'chunk_id',chunk,'original_content_hash',hash)),
    'validated_citation_ids',jsonb_build_array('S1'),'coverage',jsonb_build_object('completeness','NOT_EXHAUSTIVE','chunks_considered',1),
    'provider_cost_status','UNKNOWN','review_state','COMPLETION_CRITERIA_NOT_AUTOMATICALLY_VERIFIED');
  perform public.nexus_research_step(ctx,'commit',(r->>'id')::uuid,1,0,(claim->>'token')::uuid,answer);
  f=public.nexus_finding(ctx,'create',null,jsonb_build_object('title','Exported synthetic answer','authored_markdown','Retain all limitations',
    'research_run_id',r->>'id','result_index',0),null,'package61-finding',repeat('f',64));fid=(f->>'id')::uuid;
  rights=public.nexus_finding_export_rights(ctx,'read',fid);
  if rights->>'eligible'<>'false' or rights->'items'->0->>'version_id'<>ver::text then raise exception 'Unknown rights were not represented';end if;
  begin perform public.nexus_finding_package(ctx,'create',fid,p_revision=>1,p_key=>'blocked');raise exception 'Missing rights exported';
    exception when others then if sqlerrm<>'NR:RIGHTS_BLOCKED' then raise;end if;end;
  command=jsonb_build_object('selections',jsonb_build_array(jsonb_build_object('version_id',ver,'expected_review_id',null)),
    'policy',jsonb_build_object('decision','ALLOW','basis','OWNED_CONTENT','rationale','Synthetic author owns this fixture.',
    'evidence_reference','urn:fixture:owned61','attribution','Synthetic fixture author','duties',jsonb_build_array('Retain qualifications'),
    'review_by',clock_timestamp()+interval '1 day'));
  rights=public.nexus_finding_export_rights(ctx,'record',fid,command,1,'review61');rid=(rights->'items'->0->>'review_id')::uuid;
  replay=public.nexus_finding_export_rights(ctx,'record',fid,command,1,'review61');
  if rights<>replay or rights->>'eligible'<>'true' or (select count(*) from public.finding_export_rights where version_id=ver)<>1 then raise exception 'Rights retry was not durable';end if;
  begin perform public.nexus_finding_package(ctx,'create',fid,p_revision=>1,p_key=>'unreviewed');raise exception 'Unreviewed Finding exported';
    exception when others then if sqlerrm<>'NR:REVIEW_REQUIRED' then raise;end if;end;
  perform public.nexus_finding(ctx,'share',fid,jsonb_build_object('user_id',reviewer,'permission','contribute'),null,null,null);
  perform public.nexus_finding(ctx||jsonb_build_object('user_id',reviewer),'review',fid,'{"decision":"approved","comment":"Inspected exact source and limitations"}',1,null,null);
  package=public.nexus_finding_package(ctx,'create',fid,p_revision=>1,p_key=>'package61');
  pid=(package->>'id')::uuid;manifest=(package->>'manifest_text')::jsonb;
  perform set_config('nexusrag.test_package',package::text,true);
  if package->>'state'<>'ready' or package->>'serialization'<>'POSTGRES_JSONB_TEXT_UTF8/1'
    or encode(sha256(convert_to(package->>'manifest_text','UTF8')),'hex')<>package->>'manifest_hash'
    or manifest->'analysis'<>answer or manifest->'evidence'->0->>'original_text'<>original
    or manifest->'@included'->0->>'rights_review_id'<>rid::text or manifest->>'claim_state'<>'HUMAN_REVIEWED_NOT_CERTIFICATION'
    then raise exception 'Package lost actual persisted result, exact quotes, rights or qualification';end if;
  replay=public.nexus_finding_package(ctx,'create',fid,p_revision=>1,p_key=>'package61');
  if replay<>package then raise exception 'Package retry changed exact bytes';end if;
  replay=public.nexus_finding_package(ctx,'create',fid,p_revision=>1,p_key=>'package61-new-click');
  if replay<>package or (select count(*) from public.finding_packages where finding_id=fid)<>1 then raise exception 'Equivalent export duplicated package';end if;
  if public.nexus_finding_package(ctx,'read',fid,pid)<>package then raise exception 'Reload changed package';end if;
  if public.nexus_finding_package(ctx,'list',fid)->'items'->0 ? 'manifest_text' then raise exception 'List duplicated private manifest';end if;
  if not exists(select 1 from public.finding_packages where id=pid
    and component_version='FINDING_COMPONENTS_UTF8/1' and component_digest ~ '^[a-f0-9]{64}$')
    then raise exception 'New package did not retain its compact component receipt';end if;
  perform pg_temp.assert_finding_package_parity(ctx,fid,pid,'ready');

  -- Later admitted steps can append results without changing this saved result.
  -- Run timestamps/generation and a Finding's later current revision are not
  -- replacements for the exact inputs to this historical package.
  claim=public.nexus_research_step(ctx,'claim',(r->>'id')::uuid,1,1);
  later_answer=answer||jsonb_build_object('question','Follow-up synthetic question');
  perform public.nexus_research_step(ctx,'commit',(r->>'id')::uuid,1,1,(claim->>'token')::uuid,later_answer);
  perform pg_temp.assert_finding_package_parity(ctx,fid,pid,'ready');

  -- Isolate each ordinary changed-component case so no mutation can make a
  -- subsequent check pass merely because a previous case already withheld it.
  for fixture in select * from (values
    ('revision title',format('update public.finding_versions set title=title||%L where finding_id=%L and revision=1',' changed',fid),'COMPONENT_CHANGED'),
    ('authored note',format('update public.finding_versions set authored_markdown=authored_markdown||%L where finding_id=%L and revision=1',' changed',fid),'COMPONENT_CHANGED'),
    ('generated text',format('update public.finding_versions set generated_markdown=generated_markdown||%L where finding_id=%L and revision=1',' changed',fid),'COMPONENT_CHANGED'),
    ('version timestamp',format('update public.finding_versions set created_at=created_at+interval ''1 second'' where finding_id=%L and revision=1',fid),'COMPONENT_CHANGED'),
    ('review comment',format('update public.finding_reviews set comment=comment||%L where finding_id=%L and revision=1',' changed',fid),'COMPONENT_CHANGED'),
    ('review timestamp',format('update public.finding_reviews set created_at=created_at+interval ''1 second'' where finding_id=%L and revision=1',fid),'COMPONENT_CHANGED'),
    ('review decision',format('update public.finding_reviews set decision=''changes_requested'' where finding_id=%L and revision=1',fid),'REVIEW_REQUIRED'),
    ('source filename',format('update public.documents set filename=''renamed-owned-source.txt'' where id=%L',doc),'COMPONENT_CHANGED'),
    ('source locator',format('update public.document_chunks set location=''"changed locator"''::jsonb where id=%L',chunk),'COMPONENT_CHANGED'),
    ('raw original',format('update public.document_chunks set original_text=original_text||%L where id=%L',' changed',chunk),'SOURCE_UNAVAILABLE'),
    ('saved analysis',format('update public.research_runs set results=jsonb_set(results,''{0,answer}'',''"Changed saved answer [S1]."''::jsonb) where id=%L',r->>'id'),'COMPONENT_CHANGED'),
    ('rights attribution',format('update public.finding_export_rights set policy=jsonb_set(policy,''{attribution}'',''"Changed attribution"''::jsonb) where id=%L',rid),'COMPONENT_CHANGED'),
    ('rights review timestamp',format('update public.finding_export_rights set created_at=created_at+interval ''1 second'' where id=%L',rid),'COMPONENT_CHANGED'),
    ('rights expiry',format('update public.finding_export_rights set policy=jsonb_set(policy,''{review_by}'',''"2000-01-01T00:00:00Z"''::jsonb) where id=%L',rid),'RIGHTS_BLOCKED'),
    ('rights revocation',format('update public.finding_export_rights set policy=jsonb_set(policy,''{decision}'',''"REVOKED"''::jsonb) where id=%L',rid),'RIGHTS_BLOCKED'),
    ('version original hash',format('update public.document_versions set original_hash=repeat(''e'',64) where id=%L',ver),'RIGHTS_BLOCKED'),
    ('source generation',format('update public.document_versions set index_generation=''replacement-generation'' where id=%L',ver),'SOURCE_UNAVAILABLE'),
    ('source publication',format('update public.document_versions set publication_state=''failed'' where id=%L',ver),'SOURCE_UNAVAILABLE'),
    ('document epoch',format('update public.documents set lifecycle_epoch=lifecycle_epoch+1 where id=%L',doc),'SOURCE_UNAVAILABLE'),
    ('active source version',format('update public.documents set active_version_id=null where id=%L',doc),'SOURCE_UNAVAILABLE'),
    ('revision redaction',format('update public.finding_versions set redacted_at=clock_timestamp() where finding_id=%L and revision=1',fid),'SOURCE_UNAVAILABLE'),
    ('receipt hash',format('update public.evidence_exports set manifest_hash=repeat(''e'',64) where id=%L',pid),'COMPONENT_CHANGED'),
    ('receipt bytes',format('update public.finding_packages set manifest_bytes=manifest_bytes+1 where id=%L',pid),'COMPONENT_CHANGED'),
    ('receipt expiry',format('update public.evidence_exports set expires_at=clock_timestamp()-interval ''1 second'' where id=%L',pid),'EXPIRED')
  ) cases(label,statement,reason) loop
    begin
      execute fixture.statement;
      perform pg_temp.assert_finding_package_parity(ctx,fid,pid,'expired',fixture.reason);
      raise exception using errcode='P0610',message='rollback this component fixture';
    exception when sqlstate 'P0610' then null;
      when others then raise exception 'Component parity case % failed: %',fixture.label,sqlerrm;
    end;
  end loop;
  perform pg_temp.assert_finding_package_parity(ctx,fid,pid,'ready');

  -- Legacy/unknown cache versions must use exact full validation, not assume
  -- that an absent or unfamiliar compact digest is a successful receipt.
  for fixture in select * from (values ('legacy NULL',null::text),('unknown version','FUTURE_COMPONENTS_TEST/1')) cases(label,version) loop
    begin
      update public.finding_packages set component_version=fixture.version,
        component_digest=case when fixture.version is null then null else repeat('a',64) end where id=pid;
      perform pg_temp.assert_finding_package_parity(ctx,fid,pid,'ready');
      update public.finding_versions set authored_markdown=authored_markdown||' changed after fallback' where finding_id=fid and revision=1;
      perform pg_temp.assert_finding_package_parity(ctx,fid,pid,'expired','COMPONENT_CHANGED');
      raise exception using errcode='P0610',message='rollback this fallback fixture';
    exception when sqlstate 'P0610' then null;
      when others then raise exception 'Component fallback case % failed: %',fixture.label,sqlerrm;
    end;
  end loop;

  begin
    renewed=public.nexus_finding_export_rights(ctx,'record',fid,
      jsonb_set(command,'{selections,0,expected_review_id}',to_jsonb(rid)),1,'renew-package61');
    perform pg_temp.assert_finding_package_parity(ctx,fid,pid,'expired','COMPONENT_CHANGED');
    renewed=public.nexus_finding_package(ctx,'create',fid,p_revision=>1,p_key=>'renewed-package61');
    if renewed->>'id'=pid::text then raise exception 'Renewed rights reused a superseded component receipt';end if;
    perform pg_temp.assert_finding_package_parity(ctx,fid,(renewed->>'id')::uuid,'ready');
    raise exception using errcode='P0610',message='rollback this renewal fixture';
  exception when sqlstate 'P0610' then null;
  end;

  -- The retained chat/query-backed Finding path uses different source metadata
  -- from Research runs. Exercise it with actual local durable records.
  insert into public.chat_sessions(id,workspace_id,user_id,title,visibility)
    values(legacy_session,ws,actor,'Synthetic package query','private');
  insert into public.ingestion_jobs(id,workspace_id,kind,status) values(legacy_job,ws,'queries','completed');
  insert into public.usage_reservations(id,workspace_id,actor_id,operation_id,reserved_queries,reserved_tokens,state,expires_at)
    values(legacy_reservation,ws,actor,legacy_job,1,10,'settled',clock_timestamp()+interval '1 hour');
  insert into public.query_runs(id,workspace_id,user_id,session_id,job_id,reservation_id,idempotency_key,payload_hash,request,context,state,deadline,final_answer)
    values(legacy_run,ws,actor,legacy_session,legacy_job,legacy_reservation,'package61-legacy-query',repeat('a',64),'{}',ctx,'completed',
      clock_timestamp()+interval '1 hour',jsonb_build_object('markdown','Legacy synthetic answer [S1].','citations',jsonb_build_array(jsonb_build_object('id',chunk))));
  insert into public.query_run_sources(workspace_id,run_id,document_id,version_id,lifecycle_epoch) values(ws,legacy_run,doc,ver,1);
  legacy_finding=public.nexus_finding(ctx,'create',null,jsonb_build_object('title','Legacy source-linked package','authored_markdown','Legacy qualification',
    'run_id',legacy_run),null,'package61-legacy-finding',repeat('b',64));
  perform public.nexus_finding(ctx,'share',(legacy_finding->>'id')::uuid,jsonb_build_object('user_id',reviewer,'permission','contribute'),null,null,null);
  perform public.nexus_finding(ctx||jsonb_build_object('user_id',reviewer),'review',(legacy_finding->>'id')::uuid,
    '{"decision":"approved","comment":"Inspected legacy synthetic source"}',1,null,null);
  legacy_package=public.nexus_finding_package(ctx,'create',(legacy_finding->>'id')::uuid,p_revision=>1,p_key=>'package61-legacy-export');
  perform pg_temp.assert_finding_package_parity(ctx,(legacy_finding->>'id')::uuid,(legacy_package->>'id')::uuid,'ready');
  begin
    update public.document_chunks set original_text=original_text||' changed legacy original' where id=chunk;
    perform pg_temp.assert_finding_package_parity(ctx,(legacy_finding->>'id')::uuid,(legacy_package->>'id')::uuid,'expired','COMPONENT_CHANGED');
    raise exception using errcode='P0610',message='rollback this legacy original fixture';
  exception when sqlstate 'P0610' then null;
  end;
  begin
    update public.query_runs set final_answer=jsonb_set(final_answer,'{citations}','[]') where id=legacy_run;
    perform pg_temp.assert_finding_package_parity(ctx,(legacy_finding->>'id')::uuid,(legacy_package->>'id')::uuid,'expired','RIGHTS_BLOCKED');
    raise exception using errcode='P0610',message='rollback this legacy citation fixture';
  exception when sqlstate 'P0610' then null;
  end;

  perform public.nexus_finding(ctx,'edit',fid,'{"title":"Revision two","authored_markdown":"New revision without approval"}',1,null,null);
  if public.nexus_finding_package(ctx,'read',fid,pid)<>package then raise exception 'Immutable prior revision export was lost on edit';end if;
  perform public.nexus_finding(ctx||jsonb_build_object('user_id',reviewer),'review',fid,'{"decision":"approved","comment":"Inspected revision two"}',2,null,null);
  second_package=public.nexus_finding_package(ctx,'create',fid,p_revision=>2,p_key=>'package61-revision-two');
  perform set_config('timezone','Asia/Kolkata',true);
  replay=public.nexus_finding_package(ctx,'list',fid,p_limit=>50);
  perform set_config('timezone','UTC',true);
  if jsonb_array_length(replay->'items') is distinct from 2
    or not exists(select 1 from jsonb_array_elements(replay->'items') item where item=package-'manifest_text')
    or not exists(select 1 from jsonb_array_elements(replay->'items') item where item=second_package-'manifest_text')
    then raise exception 'Package list mixed historical revisions or changed metadata across session timezones';end if;
  command=jsonb_set(command,'{selections,0,expected_review_id}',to_jsonb(rid));command=jsonb_set(command,'{policy,decision}','"REVOKED"');
  perform public.nexus_finding_export_rights(ctx,'record',fid,command,2,'revoke61');
  replay=public.nexus_finding_package(ctx,'read',fid,pid);
  if replay->>'state'<>'expired' or replay->'manifest_text'<>'null'::jsonb or replay->>'reason'<>'RIGHTS_BLOCKED' then raise exception 'Revoked package was still downloadable';end if;
  replay=public.nexus_finding_package(ctx,'list',fid,p_limit=>50);
  if jsonb_array_length(replay->'items') is distinct from 2
    or exists(select 1 from jsonb_array_elements(replay->'items') item where item->>'state' is distinct from 'expired'
      or item->>'reason' is distinct from 'RIGHTS_BLOCKED' or item ? 'manifest_text')
    then raise exception 'Rights revocation was not reflected in every historical package summary';end if;
  update public.documents set lifecycle_state='deleting',lifecycle_epoch=lifecycle_epoch+1 where id=doc;
  if (select lifecycle_state from public.documents where id=doc)<>'deleting' or exists(select 1 from public.finding_export_rights where version_id=ver) then raise exception 'Source removal lost state change or retained private review text';end if;
  replay=public.nexus_finding_package(ctx,'read',fid,pid);
  if replay->>'state' is distinct from 'expired' or replay->'manifest_text' is distinct from 'null'::jsonb
    or replay->>'reason' is distinct from 'SOURCE_UNAVAILABLE'
    then raise exception 'Removed source remained downloadable or lost its withholding reason';end if;
  begin perform public.nexus_finding_export_rights(ctx,'read',fid);raise exception 'Removed source still offered export rights';
    exception when others then if sqlerrm<>'NR:SOURCE_UNAVAILABLE' then raise;end if;end;
  replay=public.nexus_finding_package(ctx,'list',fid);
  if jsonb_array_length(replay->'items') is distinct from 2
    or not exists(select 1 from jsonb_array_elements(replay->'items') item where item->>'id'=pid::text and item->>'manifest_hash'=package->>'manifest_hash')
    or not exists(select 1 from jsonb_array_elements(replay->'items') item where item->>'id'=second_package->>'id' and item->>'manifest_hash'=second_package->>'manifest_hash')
    or exists(select 1 from jsonb_array_elements(replay->'items') item where item->>'state' is distinct from 'expired'
      or item->>'reason' is distinct from 'SOURCE_UNAVAILABLE' or item ? 'manifest_text')
    then raise exception 'Removed source hid or changed the retained package receipt';end if;
end;$$;
\if :{?package_output}
\o :package_output
select current_setting('nexusrag.test_package');
\o
\endif
rollback;
select 'FINDING_PACKAGE_SQL_PASS: real result/rights/review/retry/hash/reload/historical revision/revocation/lifecycle/retained receipt after source removal; disposable rollback, not hosted acceptance';
