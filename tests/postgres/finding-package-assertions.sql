\set ON_ERROR_STOP on
begin;
set request.jwt.claim.role='service_role';
do $$
declare ctx jsonb;draft jsonb;r jsonb;claim jsonb;answer jsonb;f jsonb;rights jsonb;command jsonb;package jsonb;replay jsonb;manifest jsonb;
  ws uuid='11111111-1111-4111-8111-111111111111';actor uuid='22222222-2222-4222-8222-222222222222';
  reviewer uuid='33333333-3333-4333-8333-333333333333';doc uuid='d0610000-0000-4000-8000-000000000001';
  ver uuid='d0610000-0000-4000-8000-000000000002';chunk uuid='d0610000-0000-4000-8000-000000000003';
  original text='Owned synthetic statement: 1.005 kg; not a certification.';hash text;fid uuid;pid uuid;rid uuid;entries integer;
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
  draft=draft||jsonb_build_object('plan_id','package61','private_source_ids',jsonb_build_array(doc),'subquestions','[]'::jsonb);
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
  perform public.nexus_finding(ctx,'edit',fid,'{"title":"Revision two","authored_markdown":"New revision without approval"}',1,null,null);
  if public.nexus_finding_package(ctx,'read',fid,pid)<>package then raise exception 'Immutable prior revision export was lost on edit';end if;
  command=jsonb_set(command,'{selections,0,expected_review_id}',to_jsonb(rid));command=jsonb_set(command,'{policy,decision}','"REVOKED"');
  perform public.nexus_finding_export_rights(ctx,'record',fid,command,2,'revoke61');
  replay=public.nexus_finding_package(ctx,'read',fid,pid);
  if replay->>'state'<>'expired' or replay->'manifest_text'<>'null'::jsonb or replay->>'reason'<>'RIGHTS_BLOCKED' then raise exception 'Revoked package was still downloadable';end if;
  update public.documents set lifecycle_state='deleting',lifecycle_epoch=lifecycle_epoch+1 where id=doc;
  if (select lifecycle_state from public.documents where id=doc)<>'deleting' or exists(select 1 from public.finding_export_rights where version_id=ver) then raise exception 'Source removal lost state change or retained private review text';end if;
  replay=public.nexus_finding_package(ctx,'read',fid,pid);
  if replay->>'state'<>'expired' or replay->'manifest_text'<>'null'::jsonb then raise exception 'Removed source remained downloadable';end if;
end;$$;
\if :{?package_output}
\o :package_output
select current_setting('nexusrag.test_package');
\o
\endif
rollback;
select 'FINDING_PACKAGE_SQL_PASS: real result/rights/review/retry/hash/reload/historical revision/revocation/lifecycle; disposable rollback, not hosted acceptance';
