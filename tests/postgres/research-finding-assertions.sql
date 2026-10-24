\set ON_ERROR_STOP on
begin;
set request.jwt.claim.role='service_role';
do $$
declare ctx jsonb; draft jsonb; plan_id uuid; r jsonb; claim jsonb; answer jsonb; command jsonb; f jsonb; replay jsonb;
  fid uuid; b uuid='33333333-3333-4333-8333-333333333333'; doc uuid='d0300000-0000-4000-8000-000000000001';
  ver uuid='d0300000-0000-4000-8000-000000000002'; chunk uuid='d0300000-0000-4000-8000-000000000003';
  original text='Synthetic mass: 1.005 kg.'; hash text; entries integer;
begin
  select jsonb_build_object('workspace_id',w.id,'user_id','22222222-2222-4222-8222-222222222222',
    'membership_revision',w.capability_revision,'policy_id',s.active_policy_id,'policy_version',s.policy_version,
    'deadline',clock_timestamp()+interval '5 minutes') into ctx from public.workspaces w join public.workspace_settings s on s.workspace_id=w.id
    where w.id='11111111-1111-4111-8111-111111111111';
  hash=encode(sha256(convert_to(original,'UTF8')),'hex');
  insert into public.documents(id,workspace_id,uploaded_by,filename,original_filename,status,chunk_count)
    values(doc,(ctx->>'workspace_id')::uuid,(ctx->>'user_id')::uuid,'finding-source.txt','finding-source.txt','ready',1);
  insert into public.document_versions(id,workspace_id,document_id,original_bucket,original_key,original_hash,original_bytes,
    original_verified_at,parser_version,chunker_version,lifecycle_epoch,publication_state,index_generation,data_classification,classification_declared_by,classification_declared_at)
    values(ver,(ctx->>'workspace_id')::uuid,doc,'documents','synthetic-finding',hash,24,now(),'synthetic','synthetic',1,'ready','finding-generation',
      'non_sensitive',(ctx->>'user_id')::uuid,now());
  update public.documents set active_version_id=ver where id=doc;
  insert into public.document_chunks(id,workspace_id,document_id,version_id,chunk_index,content,original_text,original_content_hash,page_number,location,embedding_space_id)
    values(chunk,(ctx->>'workspace_id')::uuid,doc,ver,0,original,original,hash,2,'{"page":2,"section":"mass"}','synthetic-space');
  select plan into strict draft from public.research_plans where plan->>'plan_id'='mode-EVIDENCE_ANSWER';
  draft=draft||jsonb_build_object('plan_id','finding-research','private_source_ids',jsonb_build_array(doc),'subquestions','[]'::jsonb);
  plan_id=(public.nexus_research_plan(ctx,'create',p_plan=>draft,p_key=>'finding-research')->>'id')::uuid;
  update public.nexus_account_usage set free_chat_queries=0 where user_id=(ctx->>'user_id')::uuid;
  r=public.nexus_research_run(ctx,'create',plan_id,p_key=>'finding-research-start',p_command=>'{"non_sensitive_attested":true}');
  claim=public.nexus_research_step(ctx,'claim',(r->>'id')::uuid,1,0);
  answer=jsonb_build_object('question',draft->>'question','answer','Synthetic mass is 1.005 kg [S1].','claim_state','REVIEW_REQUIRED','abstained',false,
    'sources',jsonb_build_array(jsonb_build_object('citation_id','S1','document_id',doc,'version_id',ver,'chunk_id',chunk,'original_content_hash',hash)),
    'validated_citation_ids',jsonb_build_array('S1'),'coverage',jsonb_build_object('completeness','NOT_EXHAUSTIVE','chunks_considered',1),
    'provider_cost_status','UNKNOWN','review_state','COMPLETION_CRITERIA_NOT_AUTOMATICALLY_VERIFIED');
  perform public.nexus_research_step(ctx,'commit',(r->>'id')::uuid,1,0,(claim->>'token')::uuid,answer);
  command=jsonb_build_object('title','Saved synthetic answer','authored_markdown','','research_run_id',r->>'id','result_index',0);
  f=public.nexus_finding(ctx,'create',null,command,null,'research-finding',repeat('a',64));fid=(f->>'id')::uuid;
  if f->>'generated_markdown'<>answer->>'answer' or f->>'source_research_run_id'<>r->>'id'
    or f->>'source_research_position'<>'0' or f->'evidence'->0->>'original_text'<>original
    or f->'evidence'->0->>'original_content_hash'<>hash or f->'evidence'->0->'location'->>'page'<>'2'
    or f->'research_origin'->>'claim_state'<>'REVIEW_REQUIRED' then raise exception 'Research finding lost stored answer or exact provenance'; end if;
  replay=public.nexus_finding(ctx,'create',null,command,null,'research-finding',repeat('a',64));
  if replay->>'id'<>fid::text or replay->>'generated_markdown'<>answer->>'answer' then raise exception 'Finding retry lost saved answer'; end if;
  if (select count(*) from public.findings where source_research_run_id=(r->>'id')::uuid)<>1 then raise exception 'Finding retry duplicated a record'; end if;
  -- Ordinary explicit collaboration uses the existing versioned review contract.
  insert into public.workspace_members(workspace_id,user_id,role) values((ctx->>'workspace_id')::uuid,b,'editor')
    on conflict(workspace_id,user_id) do update set role='editor';
  ctx=ctx||jsonb_build_object('membership_revision',(select capability_revision from public.workspaces where id=(ctx->>'workspace_id')::uuid));
  perform public.nexus_finding(ctx,'share',fid,jsonb_build_object('user_id',b,'permission','contribute'),null,null,null);
  f=public.nexus_finding(ctx||jsonb_build_object('user_id',b),'read',fid,'{}',null,null,null);
  if f->>'generated_markdown'<>answer->>'answer' or f->>'permission'<>'contribute' then raise exception 'Shared review lost generated answer'; end if;
  f=public.nexus_finding(ctx||jsonb_build_object('user_id',b),'review',fid,'{"decision":"changes_requested","comment":"Check the quantity context"}',1,null,null);
  if jsonb_array_length(f->'reviews')<>1 then raise exception 'Independent review did not persist'; end if;
  f=public.nexus_finding(ctx,'edit',fid,'{"title":"Updated finding","authored_markdown":"Reviewed context note"}',1,null,null);
  if f->>'revision'<>'2' or jsonb_array_length(f->'reviews')<>0 or f->>'generated_markdown'<>answer->>'answer'
    then raise exception 'New revision retained an old approval or lost source text'; end if;
  f=public.nexus_finding(ctx||jsonb_build_object('user_id',b),'review',fid,'{"decision":"approved","comment":"Inspected synthetic original"}',2,null,null);
  if f->'reviews'->0->>'reviewer_id'<>b::text or f->'reviews'->0->>'revision'<>'2' then raise exception 'Reviewer/revision receipt lost'; end if;
  -- A stored research reference never becomes a rights-cleared manual note.
  select count(*) into entries from public.evidence_exports;
  begin
    perform public.nexus_record_finding_export(ctx,fid,2,'{}',encode(sha256(convert_to('{}','UTF8')),'hex'));
    raise exception 'Unreviewed source export was offered as a manual-note export';
  exception when others then if sqlerrm<>'NR:RIGHTS_BLOCKED' then raise; end if; end;
  if (select count(*) from public.evidence_exports)<>entries then raise exception 'Blocked export stored a success receipt'; end if;
  update public.document_versions set index_generation='replacement' where id=ver;
  f=public.nexus_finding(ctx,'read',fid,'{}',null,null,null);
  if f->>'source_unavailable'<>'true' or f->'generated_markdown'<>'null'::jsonb or f->'evidence'<>'[]'::jsonb
    then raise exception 'Source change retained an available answer'; end if;
  begin
    perform public.nexus_finding(ctx||jsonb_build_object('user_id',b),'review',fid,'{"decision":"approved","comment":""}',2,null,null);
    raise exception 'Unavailable source still offered review completion';
  exception when others then if sqlerrm<>'NR:SOURCE_UNAVAILABLE' then raise; end if; end;
  update public.document_versions set index_generation='finding-generation' where id=ver;
  delete from public.research_runs where id=(r->>'id')::uuid;
  f=public.nexus_finding(ctx,'read',fid,'{}',null,null,null);
  if f->>'source_unavailable'<>'true' or f->'source_research_run_id'<>'null'::jsonb or f->>'source_research_position'<>'0'
    or f->'generated_markdown'<>'null'::jsonb or exists(select 1 from public.finding_versions where finding_id=fid and generated_markdown is not null)
    then raise exception 'Removed run retained generated copies or became an ordinary note'; end if;
  if f->>'authored_markdown'<>'Reviewed context note' then raise exception 'Generated-source cleanup erased independently authored notes'; end if;
  perform public.nexus_finding(ctx,'delete',fid,'{}',null,null,null);
  if exists(select 1 from public.finding_versions where finding_id=fid and (authored_markdown<>'' or generated_markdown is not null))
    then raise exception 'Finding removal retained version text'; end if;
end; $$;
rollback;
select 'RESEARCH_FINDING_SQL_PASS: exact saved-answer provenance/retry/share/review/revision/source-change/generated-copy-removal; synthetic rollback, not hosted acceptance';
