\set ON_ERROR_STOP on
begin;
set request.jwt.claim.role='service_role';
set local track_functions='pl';
do $$
declare ctx jsonb;draft jsonb;pid uuid;r jsonb;claim jsonb;answer jsonb;quotes jsonb;coverage jsonb;prior jsonb;finding jsonb;
  rights jsonb;package jsonb;ids jsonb='[]';selections jsonb='[]';doc uuid;ver uuid;chunk uuid;original text;
  actor uuid='22222222-2222-4222-8222-222222222222';reviewer uuid='33333333-3333-4333-8333-333333333333';
  ws uuid='11111111-1111-4111-8111-111111111111';i integer;k integer;first_chunk integer;last_chunk integer;fid uuid;
  calls_before bigint;calls_after bigint;common_before bigint;common_after bigint;listed jsonb;started timestamptz;first_elapsed numeric;page_elapsed numeric;
  expired_id uuid;changed_id uuid;first_package uuid;expected jsonb;
begin
  insert into public.workspace_members(workspace_id,user_id,role) values(ws,reviewer,'editor') on conflict(workspace_id,user_id) do update set role='editor';
  select jsonb_build_object('workspace_id',ws,'user_id',actor,'membership_revision',w.capability_revision,'policy_id',s.active_policy_id,
    'policy_version',s.policy_version,'deadline',clock_timestamp()+interval '15 minutes') into ctx from public.workspaces w
    join public.workspace_settings s on s.workspace_id=w.id where w.id=ws;
  for i in 1..60 loop
    doc=('d0611000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid;ver=('e0611000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid;
    insert into public.documents(id,workspace_id,uploaded_by,filename,original_filename,status)
      values(doc,ws,actor,'Package capacity '||i,'Package capacity '||i,'ready');
    insert into public.document_versions(id,workspace_id,document_id,original_bucket,original_key,original_hash,original_bytes,original_verified_at,
      parser_version,chunker_version,lifecycle_epoch,publication_state,index_generation,data_classification,classification_declared_by,classification_declared_at)
      values(ver,ws,doc,'documents','synthetic-package-capacity-'||i,repeat('a',64),1,now(),'synthetic','synthetic',1,'ready','capacity-generation','non_sensitive',actor,now());
    update public.documents set active_version_id=ver where id=doc;
    ids=ids||to_jsonb(doc::text);selections=selections||jsonb_build_array(jsonb_build_object('version_id',ver,'expected_review_id',null));
  end loop;
  for i in 1..156 loop
    doc=('d0611000-0000-4000-8000-'||lpad(((i-1)%60+1)::text,12,'0'))::uuid;
    ver=('e0611000-0000-4000-8000-'||lpad(((i-1)%60+1)::text,12,'0'))::uuid;
    chunk=('f0611000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid;
    -- The persisted chunk limit is UTF8 bytes, not characters or escaped JSON bytes.
    original=repeat(chr(1),32768);
    if octet_length(original)<>32768 then raise exception 'Fixture did not reach the existing chunk boundary';end if;
    insert into public.document_chunks(id,workspace_id,document_id,version_id,chunk_index,content,original_text,original_content_hash,page_number,location,embedding_space_id)
      values(chunk,ws,doc,ver,i,original,original,encode(sha256(convert_to(original,'UTF8')),'hex'),i,jsonb_build_object('page',i),'synthetic-space');
  end loop;
  select plan into strict draft from public.research_plans where plan->>'plan_id'='mode-DEEP_RESEARCH';
  draft=draft||jsonb_build_object('plan_id','package-capacity','question','Synthesize all retained source citations.','private_source_ids',ids,
    'subquestions',(select jsonb_agg('Capacity question '||n order by n) from generate_series(1,12) n),
    'public_provider_ids','[]'::jsonb,'entity_scope','[]'::jsonb,'rights_constraints','[]'::jsonb,'expected_calculations','[]'::jsonb,
    'date_from',null,'date_to',null,'jurisdiction',null);
  pid=(public.nexus_research_plan(ctx,'create',p_plan=>draft,p_key=>'package-capacity-plan')->>'id')::uuid;
  update public.nexus_account_usage set free_chat_queries=0 where user_id=actor;
  r=public.nexus_research_run(ctx,'create',pid,p_key=>'package-capacity-start',p_command=>'{"non_sensitive_attested":true}');
  for k in 0..12 loop
    first_chunk=case when k=12 then 1 else k*12+1 end;last_chunk=case when k=12 then 156 else (k+1)*12 end;
    claim=public.nexus_research_step(ctx,'claim',(r->>'id')::uuid,1,k);
    select jsonb_agg(jsonb_build_object('citation_id','S'||ordinal,'document_id',c.document_id,'version_id',c.version_id,'chunk_id',c.id,
      'filename',d.filename,'content',left(c.original_text,850),'original_content_hash',c.original_content_hash,'location',c.location,
      'page_number',c.page_number,'chunk_index',c.chunk_index,'excerpt',true) order by ordinal) into quotes
      from (select *,row_number() over(order by chunk_index) ordinal from public.document_chunks where workspace_id=ws
        and id::text like 'f0611000-%' and chunk_index between first_chunk and last_chunk) c join public.documents d on d.id=c.document_id;
    select jsonb_agg(jsonb_build_object('document_id',d.id,'filename',d.filename,
      'evidence_state',case when exists(select 1 from jsonb_array_elements(quotes) q where q->>'document_id'=d.id::text) then 'CITED' else 'NO_INDEXED_EVIDENCE' end,
      'context_citation_ids',(select coalesce(jsonb_agg(q->'citation_id' order by ordinal),'[]') from jsonb_array_elements(quotes) with ordinality x(q,ordinal) where q->>'document_id'=d.id::text),
      'consulted_sources',(select coalesce(jsonb_agg(jsonb_build_object('version_id',c.version_id,'chunk_id',c.id,'original_content_hash',c.original_content_hash,
        'page_number',c.page_number,'chunk_index',c.chunk_index) order by c.chunk_index),'[]') from public.document_chunks c
        where c.document_id=d.id and c.chunk_index between first_chunk and last_chunk)) order by d.id) into coverage
      from public.documents d where d.workspace_id=ws and d.id::text like 'd0611000-%';
    select case when k<12 then '[]'::jsonb else jsonb_agg(jsonb_build_object('result_index',ordinal-1,'question',v->'question',
      'claim_state',v->'claim_state','abstained',v->'abstained') order by ordinal) end into prior
      from jsonb_array_elements(r->'results') with ordinality x(v,ordinal);
    answer=jsonb_build_object('question',r->'questions'->k,'answer',(select string_agg('Synthetic source ['||(q->>'citation_id')||'].',' ' order by ordinal) from jsonb_array_elements(quotes) with ordinality x(q,ordinal)),
      'claim_state','REVIEW_REQUIRED','sources',quotes,'abstained',false,'validated_citation_ids',(select jsonb_agg(q->'citation_id' order by ordinal) from jsonb_array_elements(quotes) with ordinality x(q,ordinal)),
      'coverage',jsonb_build_object('completeness','NOT_EXHAUSTIVE','chunks_considered',156),'provider_cost_status','NOT_CALLED',
      'review_state','COMPLETION_CRITERIA_NOT_AUTOMATICALLY_VERIFIED','deep',jsonb_build_object('schema_version','research-deep/1',
      'phase',case when k=12 then 'SYNTHESIS' else 'SUBQUESTION' end,'criterion_index',k,'question_count',13,'documents',coverage,'prior_results',prior,
      'limitations','["Synthetic capacity, not provider quality or certification."]'::jsonb,'gaps','[]'::jsonb,
      'interpretation','REVIEW_REQUIRED_CITATIONS_NOT_ENTAILMENT','coverage','BOUNDED_CANDIDATES_AND_CONTEXT_NOT_EXHAUSTIVE'));
    r=public.nexus_research_step(ctx,'commit',(r->>'id')::uuid,1,k,(claim->>'token')::uuid,answer)->'run';
    if (r->>'position')::integer<>k+1 then raise exception 'Actual research-step contract did not commit full synthesis';end if;
  end loop;
  finding=public.nexus_finding(ctx,'create',null,jsonb_build_object('title','Full156source capacity package','authored_markdown',repeat(chr(1),100000),
    'research_run_id',r->>'id','result_index',12),null,'package-capacity-finding',repeat('b',64));fid=(finding->>'id')::uuid;
  rights=public.nexus_finding_export_rights(ctx,'record',fid,jsonb_build_object('selections',selections,'policy',jsonb_build_object('decision','ALLOW',
    'basis','OWNED_CONTENT','rationale',repeat('a',1900),'evidence_reference',repeat('b',1900),'attribution',repeat('c',3800),
    'duties',jsonb_build_array('Keep all qualifications'),'review_by','2027-01-01T00:00:00Z')),1,'capacity-rights');
  perform public.nexus_finding(ctx,'share',fid,jsonb_build_object('user_id',reviewer,'permission','contribute'),null,null,null);
  perform public.nexus_finding(ctx||jsonb_build_object('user_id',reviewer),'review',fid,jsonb_build_object('decision','approved','comment',repeat(chr(1),5000)),1,null,null);
  package=public.nexus_finding_package(ctx,'create',fid,p_revision=>1,p_key=>'capacity-export');
  if package->>'state'<>'ready' or (package->>'manifest_bytes')::integer<30000000
    or jsonb_array_length((package->>'manifest_text')::jsonb->'evidence')<>156 then raise exception 'Full escaped original capacity was truncated or not exported';end if;
  perform set_config('nexusrag.test_capacity_package',package::text,true);
  package=public.nexus_finding_package(ctx,'create_receipt',fid,p_revision=>1,p_key=>'capacity-export');
  if package ? 'manifest_text' or package->>'schema_version'<>'finding-package-receipt/1' or octet_length(package::text)>4096 then raise exception 'Creation response copied the large manifest';end if;
  perform set_config('nexusrag.test_capacity_receipt',package::text,true);
  first_package=(package->>'id')::uuid;
  -- Equivalent artifacts can belong to different requestors. Keep their real
  -- receipt shape and exact common manifest without persisting 50 text copies.
  with added as (
    insert into public.evidence_exports(workspace_id,requested_by,format,state,manifest_hash)
    select ws,('a0612000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'JSON_LD','ready',package->>'manifest_hash'
      from generate_series(1,49) n returning id
  ) insert into public.finding_packages(id,workspace_id,finding_id,finding_revision,manifest_bytes,component_version,component_digest)
    select added.id,ws,fid,1,(package->>'manifest_bytes')::integer,original.component_version,original.component_digest
      from added cross join public.finding_packages original where original.id=first_package;
  foreach i in array array[20,50] loop
    select coalesce(calls,0) into calls_before from pg_stat_xact_user_functions
      where funcid='public.nexus_finding_package_manifest(jsonb,uuid,bigint)'::regprocedure;
    select coalesce(calls,0) into common_before from pg_stat_xact_user_functions
      where funcid='public.nexus_finding_package_common(jsonb,uuid)'::regprocedure;
    started=clock_timestamp();
    listed=public.nexus_finding_package(ctx,'list',fid,p_limit=>i);
    page_elapsed=extract(epoch from clock_timestamp()-started);
    select coalesce(calls,0) into calls_after from pg_stat_xact_user_functions
      where funcid='public.nexus_finding_package_manifest(jsonb,uuid,bigint)'::regprocedure;
    select coalesce(calls,0) into common_after from pg_stat_xact_user_functions
      where funcid='public.nexus_finding_package_common(jsonb,uuid)'::regprocedure;
    if coalesce(calls_after,0)-coalesce(calls_before,0)<>0 or coalesce(common_after,0)-coalesce(common_before,0)<>1 then
      raise exception 'Package page repeated maximum-capacity materialization: limit %, manifests %, common %',
        i,coalesce(calls_after,0)-coalesce(calls_before,0),coalesce(common_after,0)-coalesce(common_before,0);end if;
    if page_elapsed>=8 then raise exception 'Package page exceeded unchanged Gateway 8second RPC deadline: %seconds',page_elapsed;end if;
    if jsonb_array_length(listed->'items') is distinct from i
      or (i=20 and listed->>'next_after' is distinct from listed->'items'->19->>'id')
      or (i=50 and listed->'next_after' is distinct from 'null'::jsonb)
      or exists(select 1 from jsonb_array_elements(listed->'items') item where item ? 'manifest_text'
        or item->>'state' is distinct from 'ready' or item->'reason' is distinct from 'null'::jsonb
        or item->>'manifest_hash' is distinct from package->>'manifest_hash'
        or item->'manifest_bytes' is distinct from package->'manifest_bytes'
        or item->>'requested_by' is distinct from (select requested_by::text from public.evidence_exports where id=(item->>'id')::uuid))
      then raise exception 'Maximum-capacity package page lost exact receipt metadata, requestors or pagination';end if;
    if i=20 then first_elapsed=page_elapsed;end if;
  end loop;
  select id into expired_id from public.finding_packages where finding_id=fid order by id limit 1;
  select id into changed_id from public.finding_packages where finding_id=fid order by id offset 1 limit 1;
  update public.evidence_exports set expires_at=clock_timestamp()-interval '1 second' where id=expired_id;
  update public.evidence_exports set manifest_hash=repeat('d',64) where id=changed_id;
  listed=public.nexus_finding_package(ctx,'list',fid,p_limit=>50);
  if (select count(*) from jsonb_array_elements(listed->'items') item where item->>'state'='ready')<>48
    or not exists(select 1 from jsonb_array_elements(listed->'items') item where item->>'id'=expired_id::text and item->>'reason'='EXPIRED')
    or not exists(select 1 from jsonb_array_elements(listed->'items') item where item->>'id'=changed_id::text and item->>'reason'='COMPONENT_CHANGED')
    then raise exception 'Shared revision validation hid per-receipt expiry or digest differences';end if;
  raise notice 'FINDING_PACKAGE_LIST_CAPACITY_SQL_PASS pages=20,50 full_materializations=0,0 common=1,1 default_page_seconds=% maximum_page_seconds=%',first_elapsed,page_elapsed;

  -- Fifty actual edit/review/export workflows produce distinct maximum-size
  -- artifacts. Reusing a per-revision full hash is insufficient for this case.
  delete from public.evidence_exports where id in(select id from public.finding_packages where finding_id=fid and id<>first_package);
  update public.evidence_exports set state='ready',expires_at=null,manifest_hash=package->>'manifest_hash' where id=first_package;
  expected=jsonb_build_array((package-'schema_version')||jsonb_build_object('schema_version','finding-package/1'));
  for k in 2..50 loop
    perform public.nexus_finding(ctx,'edit',fid,jsonb_build_object('title','Maximum package revision '||k,
      'authored_markdown',repeat(chr(1),100000)),k-1,null,null);
    perform public.nexus_finding(ctx||jsonb_build_object('user_id',reviewer),'review',fid,
      jsonb_build_object('decision','approved','comment',repeat(chr(1),5000)),k,null,null);
    package=public.nexus_finding_package(ctx,'create_receipt',fid,p_revision=>k,p_key=>'capacity-export-revision-'||k);
    if package->>'state' is distinct from 'ready' or (package->>'manifest_bytes')::integer not between 30000000 and 33554432
      then raise exception 'Revision % did not produce an actual maximum-capacity artifact',k;end if;
    expected=expected||jsonb_build_array((package-'schema_version')||jsonb_build_object('schema_version','finding-package/1'));
  end loop;
  foreach i in array array[20,50] loop
    ctx=ctx||jsonb_build_object('deadline',clock_timestamp()+interval '30 seconds');
    select coalesce(calls,0) into calls_before from pg_stat_xact_user_functions
      where funcid='public.nexus_finding_package_manifest(jsonb,uuid,bigint)'::regprocedure;
    select coalesce(calls,0) into common_before from pg_stat_xact_user_functions
      where funcid='public.nexus_finding_package_common(jsonb,uuid)'::regprocedure;
    started=clock_timestamp();
    listed=public.nexus_finding_package(ctx,'list',fid,p_limit=>i);
    page_elapsed=extract(epoch from clock_timestamp()-started);
    select coalesce(calls,0) into calls_after from pg_stat_xact_user_functions
      where funcid='public.nexus_finding_package_manifest(jsonb,uuid,bigint)'::regprocedure;
    select coalesce(calls,0) into common_after from pg_stat_xact_user_functions
      where funcid='public.nexus_finding_package_common(jsonb,uuid)'::regprocedure;
    if coalesce(calls_after,0)-coalesce(calls_before,0)<>0 or coalesce(common_after,0)-coalesce(common_before,0)<>1
      then raise exception 'Historical package page repeated full manifests/common sources: limit %',i;end if;
    if jsonb_array_length(listed->'items') is distinct from i
      or (select count(distinct item->>'finding_revision') from jsonb_array_elements(listed->'items') item)<>i
      or (i=20 and listed->>'next_after' is distinct from listed->'items'->19->>'id')
      or (i=50 and listed->'next_after' is distinct from 'null'::jsonb)
      or exists(select 1 from jsonb_array_elements(listed->'items') item where item ? 'manifest_text'
        or not exists(select 1 from jsonb_array_elements(expected) saved where saved=item))
      then raise exception 'Historical maximum-capacity page lost exact receipt metadata/revisions/pagination';end if;
    if page_elapsed>=8 then raise exception 'Historical maximum-capacity page exceeded unchanged Gateway 8second RPC deadline: %seconds',page_elapsed;end if;
    if i=20 then first_elapsed=page_elapsed;end if;
  end loop;
  raise notice 'FINDING_PACKAGE_DISTINCT_REVISION_CAPACITY_SQL_PASS revisions=50 pages=20,50 full_materializations=0,0 common=1,1 default_page_seconds=% maximum_page_seconds=%',first_elapsed,page_elapsed;
end;$$;
\if :{?package_capacity_output}
\o :package_capacity_output
select current_setting('nexusrag.test_capacity_package');
\o
\endif
\if :{?package_capacity_receipt_output}
\o :package_capacity_receipt_output
select current_setting('nexusrag.test_capacity_receipt');
\o
\endif
rollback;
select 'FINDING_PACKAGE_CAPACITY_SQL_PASS: actual13step Deep synthesis,60versions,156full32768byte originals,worst JSON escaping,independent review,exact package;no provider/hosted acceptance';
