\set ON_ERROR_STOP on
begin;
set request.jwt.claim.role='service_role';
insert into public.workspace_policy_versions(id,workspace_id,version,policy)
  values('66666666-6666-4666-8666-666666666666','11111111-1111-4111-8111-111111111111',1,'{}') on conflict(workspace_id,version) do nothing;
insert into public.workspace_settings(workspace_id,active_policy_id,policy_version)
  values('11111111-1111-4111-8111-111111111111','66666666-6666-4666-8666-666666666666',1) on conflict(workspace_id) do nothing;
do $$
declare ws uuid='11111111-1111-4111-8111-111111111111';actor uuid='22222222-2222-4222-8222-222222222222';reviewer uuid='33333333-3333-4333-8333-333333333333';
  before_doc uuid='d0620000-0000-4000-8000-000000000001';after_doc uuid='d0620000-0000-4000-8000-000000000002';
  before_version uuid='e0620000-0000-4000-8000-000000000001';after_version uuid='e0620000-0000-4000-8000-000000000002';
  before_chunk uuid='f0620000-0000-4000-8000-000000000001';after_chunk uuid='f0620000-0000-4000-8000-000000000002';
  ctx jsonb;other_ctx jsonb;source jsonb;before_body jsonb;after_body jsonb;prepared jsonb;captured jsonb;second jsonb;changed jsonb;review jsonb;finding jsonb;package jsonb;rights jsonb;initial_rights jsonb;command jsonb;listed jsonb;
  item record;source_id uuid;change_id uuid;finding_id uuid;package_id uuid;original text;source_before jsonb;
begin
  insert into public.workspace_members(workspace_id,user_id,role) values(ws,reviewer,'editor') on conflict(workspace_id,user_id) do update set role='editor';
  select jsonb_build_object('workspace_id',ws,'user_id',actor,'membership_revision',w.capability_revision,'policy_id',s.active_policy_id,
    'policy_version',s.policy_version,'deadline',clock_timestamp()+interval '10 minutes') into ctx from public.workspaces w join public.workspace_settings s on s.workspace_id=w.id where w.id=ws;
  other_ctx=ctx||jsonb_build_object('user_id',reviewer);
  insert into public.provider_registry(id,display_name,authority,documentation_url,terms_url,status,terms_hash,terms_checked_at)
    values('synthetic-radar062','Synthetic supplied provider','Synthetic fixture author','https://example.invalid/docs','https://example.invalid/terms','APPROVED',repeat('a',64),now());
  insert into public.workspace_provider_policies(workspace_id,provider_id,status,allowed_actions,rights_hash,reviewed_by,reviewed_at)
    values(ws,'synthetic-radar062','APPROVED',array['STORE','DISPLAY','MONITOR','EXPORT'],repeat('a',64),actor,now());
  for item in select * from(values(before_doc,before_version,before_chunk,'Daily quota: 100 requests per account.'),
    (after_doc,after_version,after_chunk,'Daily quota: 10 requests per account.')) fixture(doc,ver,chunk,original) loop
    insert into public.documents(id,workspace_id,uploaded_by,filename,original_filename,status,chunk_count)
      values(item.doc,ws,actor,'Supplied quota '||item.doc||'.txt','Supplied quota.txt','ready',1);
    insert into public.document_versions(id,workspace_id,document_id,original_bucket,original_key,original_hash,original_bytes,original_verified_at,
      parser_version,chunker_version,lifecycle_epoch,publication_state,index_generation,data_classification,classification_declared_by,classification_declared_at)
      values(item.ver,ws,item.doc,'documents','synthetic-radar062-'||item.ver,encode(sha256(convert_to(item.original,'UTF8')),'hex'),octet_length(item.original),now(),
        'synthetic','synthetic',1,'ready','radar-generation','non_sensitive',actor,now());
    update public.documents set active_version_id=item.ver where id=item.doc;
    insert into public.document_chunks(id,workspace_id,document_id,version_id,chunk_index,content,original_text,original_content_hash,page_number,location,embedding_space_id)
      values(item.chunk,ws,item.doc,item.ver,0,item.original,item.original,encode(sha256(convert_to(item.original,'UTF8')),'hex'),1,'{"page":1,"section":"quota"}','synthetic-space');
  end loop;
  source=public.nexus_radar(ctx,'source_create',p_command=>'{"provider_id":"synthetic-radar062","source_url":"https://example.invalid/quota","title":"Supplied quota policy","kind":"QUOTA","affected_workflows":["research"]}',p_key=>'source062');source_id=(source->>'id')::uuid;
  if source->>'revision' is distinct from '0' or source->'monitor'->>'tier' is distinct from 'MANUAL_REVIEW' or source->'monitor'->>'retrieval_method' is distinct from 'SUPPLIED_DOCUMENT'
    or source->'monitor'->'enabled' is distinct from 'false'::jsonb or source->'monitor'->'next_run_at' is distinct from 'null'::jsonb then raise exception 'Supplied source activated acquisition/scheduling or lost initial revision';end if;
  if public.nexus_radar(ctx,'source_create',p_command=>'{"provider_id":"synthetic-radar062","source_url":"https://example.invalid/quota","title":"Supplied quota policy","kind":"QUOTA","affected_workflows":["research"]}',p_key=>'source062') is distinct from source
    then raise exception 'Source retry duplicated its durable record';end if;
  listed=public.nexus_radar(ctx,'chunks',p_id=>before_doc,p_limit=>1);
  if listed->>'version_id' is distinct from before_version::text or listed->'items'->0->>'id' is distinct from before_chunk::text
    or listed->'items'->0->>'original_content_hash' is distinct from (select original_content_hash from public.document_chunks where id=before_chunk) then raise exception 'Chunk selector lost actual pinned evidence';end if;
  before_body=jsonb_build_object('expected_revision',0,'document_id',before_doc,'version_id',before_version,'chunk_ids',jsonb_build_array(before_chunk),
    'captured_at','2026-10-26T00:00:00Z','rights_rationale','The synthetic author supplied this approved fixture.');
  prepared=public.nexus_radar(ctx,'prepare_snapshot',source_id,p_command=>before_body,p_key=>'before062');
  before_body=before_body||jsonb_build_object('classification',jsonb_build_object('previous_hash',null,'current_hash',prepared->'current'->'normalized_hash',
    'previous_selection_hash',null,'current_selection_hash',prepared->'current'->'selection_hash','materiality','NONE','matched_signals','[]'::jsonb));
  captured=public.nexus_radar(ctx,'capture',source_id,p_command=>before_body,p_key=>'before062');
  if captured->'change'->>'status' is distinct from 'BASELINE' or captured->'snapshot'->>'coverage' is distinct from 'SELECTED_CHUNKS_NOT_FULL_DOCUMENT'
    or captured->'snapshot'->>'revision' is distinct from '1' or captured->'change'->'before_chunk_ids' is distinct from '[]'::jsonb then raise exception 'Baseline source/version/coverage was not durable';end if;
  if public.nexus_radar(ctx,'capture',source_id,p_command=>before_body,p_key=>'before062') is distinct from captured then raise exception 'Capture retry changed confirmed snapshot/change IDs';end if;
  after_body=jsonb_build_object('expected_revision',1,'document_id',after_doc,'version_id',after_version,'chunk_ids',jsonb_build_array(after_chunk),
    'captured_at','2026-10-26T00:00:01Z','rights_rationale','The synthetic author supplied this approved fixture.');
  prepared=public.nexus_radar(ctx,'prepare_snapshot',source_id,p_command=>after_body,p_key=>'after062');
  after_body=after_body||jsonb_build_object('classification',jsonb_build_object('previous_hash',prepared->'previous'->'normalized_hash','current_hash',prepared->'current'->'normalized_hash',
    'previous_selection_hash',prepared->'previous'->'selection_hash','current_selection_hash',prepared->'current'->'selection_hash','materiality','OPERATIONAL','matched_signals','["quota"]'::jsonb));
  second=public.nexus_radar(ctx,'capture',source_id,p_command=>after_body,p_key=>'after062');changed=second->'change';change_id=(changed->>'id')::uuid;
  if changed->>'status' is distinct from 'CHANGED' or changed->>'materiality' is distinct from 'OPERATIONAL' or changed->>'review_state' is distinct from 'PENDING'
    or changed->'selections'->'before'->0->>'id' is distinct from before_chunk::text or changed->'selections'->'after'->0->>'id' is distinct from after_chunk::text then raise exception 'Changed quota lost exact pair or review state';end if;
  listed=public.nexus_radar(ctx,'source_read',source_id,p_limit=>1);
  if listed->'latest_snapshot'->>'id' is distinct from second->'snapshot'->>'id' or jsonb_array_length(listed->'snapshots'->'items') is distinct from 1
    or listed->'changes'->'items'->0 ? 'before_text_preview' then raise exception 'Paginated history lost latest source or copied raw comparison text';end if;
  begin perform public.nexus_radar(ctx,'review',p_id=>change_id,p_command=>'{"expected_review_revision":0,"decision":"approved","comment":"self"}',p_key=>'self062');
    raise exception 'Capturing author independently approved own change';exception when others then if sqlerrm is distinct from 'NR:FORBIDDEN' then raise;end if;end;
  review=public.nexus_radar(other_ctx,'review',p_id=>change_id,p_command=>'{"expected_review_revision":0,"decision":"approved","comment":"Inspected both exact synthetic quota originals","affected_workflows":["research"]}',p_key=>'review062');
  if review->>'review_state' is distinct from 'APPROVED' or review->>'review_revision' is distinct from '1' or review->'reviews'->0->>'reviewer_id' is distinct from reviewer::text then raise exception 'Exact pair review was not independently durable';end if;
  finding=public.nexus_radar(ctx,'finding',p_id=>change_id,p_command=>'{"expected_review_revision":1,"title":"Synthetic quota decreased","authored_markdown":"Selected evidence only; inspect full provider policy separately."}',p_key=>'finding062');finding_id=(finding->>'id')::uuid;
  if finding->'confirmed_creation'->>'schema_version' is distinct from 'radar-finding-creation/1'
    or finding->'confirmed_creation'->>'finding_id' is distinct from finding_id::text
    or finding->'confirmed_creation'->>'created_by' is distinct from actor::text
    or finding->'confirmed_creation'->>'expected_review_revision' is distinct from '1'
    or finding->'confirmed_creation'->>'authored_markdown_hash' is distinct from encode(sha256(convert_to('Selected evidence only; inspect full provider policy separately.','UTF8')),'hex')
    or finding->>'source_radar_change_id' is distinct from change_id::text or finding->>'source_research_run_id' is not null or finding->>'source_run_id' is not null
    or finding->'evidence'->0->>'citation_id' is distinct from 'S1' or finding->'evidence'->1->>'citation_id' is distinct from 'S2'
    or jsonb_array_length(finding->'evidence') is distinct from 2 or finding->'radar_origin'->>'current_hash' is distinct from changed->>'current_hash' then raise exception 'Radar Finding became an unlinked manual note or fabricated run';end if;
  begin perform public.nexus_record_finding_export(ctx,finding_id,1,'{}',repeat('a',64));raise exception 'Source-backed Radar Finding used manual-note export';
    exception when others then if sqlerrm is distinct from 'NR:RIGHTS_BLOCKED' then raise;end if;end;
  perform public.nexus_finding(ctx,'share',finding_id,jsonb_build_object('user_id',reviewer,'permission','contribute'),null,null,null);
  perform public.nexus_finding(other_ctx,'review',finding_id,'{"decision":"approved","comment":"Inspected exact Finding revision and both sources"}',1,null,null);
  rights=public.nexus_finding_export_rights(ctx,'read',finding_id);
  initial_rights=rights;
  command=jsonb_build_object('selections',(select jsonb_agg(jsonb_build_object('version_id',right_item->'version_id','expected_review_id',null)) from jsonb_array_elements(rights->'items') right_item),
    'policy',jsonb_build_object('decision','ALLOW','basis','OWNED_CONTENT','rationale','Synthetic author owns these supplied originals.','evidence_reference','urn:fixture:radar062',
    'attribution','Synthetic fixture author','duties','[]'::jsonb,'review_by','2027-01-01T00:00:00Z'));
  rights=public.nexus_finding_export_rights(ctx,'record',finding_id,command,1,'rights062');
  package=public.nexus_finding_package(ctx,'create',finding_id,p_revision=>1,p_key=>'package062');package_id=(package->>'id')::uuid;
  if package->>'state' is distinct from 'ready' or (package->>'manifest_text')::jsonb->'analysis'->>'id' is distinct from change_id::text
    or jsonb_array_length((package->>'manifest_text')::jsonb->'evidence') is distinct from 2 or encode(sha256(convert_to(package->>'manifest_text','UTF8')),'hex') is distinct from package->>'manifest_hash'
    or (package->>'manifest_text')::jsonb->'prov:wasGeneratedBy'->>'@id' is distinct from 'urn:nexusrag:radar-change:'||change_id::text then raise exception 'Radar package lost actual source/diff/review/PROV or exact artifact hash';end if;
  if public.nexus_finding_package(ctx,'read',finding_id,package_id) is distinct from package then raise exception 'Reload lost exact Radar package bytes';end if;
  perform set_config('nexusrag.radar_fixture',jsonb_build_object('schema_version','radar-browser-sql-fixture/1',
    'providers',public.nexus_radar(ctx,'providers'),'chunks_before',public.nexus_radar(ctx,'chunks',p_id=>before_doc),
    'chunks_after',public.nexus_radar(ctx,'chunks',p_id=>after_doc),'empty_source',source,'baseline_capture',captured,'changed_capture',second,
    'approved_change',review,'finding',finding,'finding_reviewed',public.nexus_research_finding_view(ctx,finding_id),
    'rights_initial',initial_rights,'rights_approved',rights,'package',package,'source_detail',public.nexus_radar(ctx,'source_read',source_id))::text,true);
  perform public.nexus_radar(other_ctx,'review',p_id=>change_id,p_command=>'{"expected_review_revision":1,"decision":"changes_requested","comment":"Withdraw provisional change approval"}',p_key=>'withdraw062');
  if public.nexus_finding_package(ctx,'read',finding_id,package_id)->>'reason' is distinct from 'REVIEW_REQUIRED' then raise exception 'Withdrawn pair approval remained exportable';end if;
  perform public.nexus_radar(other_ctx,'review',p_id=>change_id,p_command=>'{"expected_review_revision":2,"decision":"approved","comment":"Resolved qualification"}',p_key=>'rereview062');
  if public.nexus_finding_package(ctx,'read',finding_id,package_id)->>'reason' is distinct from 'COMPONENT_CHANGED' then raise exception 'Re-reviewed source pair silently reused old artifact';end if;
  source_before=public.nexus_radar(ctx,'source_read',source_id);
  begin perform public.nexus_radar(ctx,'capture',source_id,p_command=>after_body,p_key=>'stale062');raise exception 'Stale source revision overwrote latest capture';
    exception when others then if sqlerrm is distinct from 'NR:VERSION_CONFLICT' then raise;end if;end;
  if public.nexus_radar(ctx,'source_read',source_id) is distinct from source_before then raise exception 'Failed capture mutated durable latest source';end if;
  update public.documents set lifecycle_state='deleting',lifecycle_epoch=lifecycle_epoch+1 where id=before_doc;
  if public.nexus_radar(ctx,'change_read',p_id=>change_id)->>'source_available' is distinct from 'false'
    or public.nexus_finding_package(ctx,'read',finding_id,package_id)->>'reason' is distinct from 'SOURCE_UNAVAILABLE' then raise exception 'Removed before snapshot remained available/exportable';end if;
  listed=public.nexus_radar(ctx,'source_read',source_id);
  if jsonb_array_length(listed->'snapshots'->'items') is distinct from 2 or jsonb_array_length(listed->'changes'->'items') is distinct from 2 then raise exception 'Source loss discarded retained snapshot/change metadata';end if;
  if exists(select 1 from public.monitors where id=(source->'monitor'->>'id')::uuid and(enabled or next_run_at is not null)) then raise exception 'Supplied Radar enabled recurring retrieval';end if;
  if (select status from public.provider_registry where id='synthetic-radar062') is distinct from 'APPROVED' or (select count(*) from public.provider_terms_snapshots where provider_id='synthetic-radar062') is distinct from 0 then raise exception 'Workspace capture modified global provider registry/terms snapshots';end if;
end;$$;
\if :{?radar_fixture_output}
\o :radar_fixture_output
select current_setting('nexusrag.radar_fixture');
\o
\endif
rollback;
select 'RADAR_SUPPLIED_SNAPSHOT_SQL_PASS:actual selected originals/baseline/change/retry/reload/independent pair review/Finding/independent Finding review/version rights/exact package/withdrawal/source loss;no provider or hosted acceptance';
