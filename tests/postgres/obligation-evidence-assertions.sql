\set ON_ERROR_STOP on
begin;
set request.jwt.claim.role='service_role';
-- Uses the real preceding Obligation executor's50-source/12-candidate/11-step
-- saved result. All test mutations roll back; no admissions/counters are reset.
create function pg_temp.obligation_context(actor uuid) returns jsonb language sql as $$
  select jsonb_build_object('workspace_id',w.id,'user_id',actor,'membership_revision',w.capability_revision,
    'policy_id',s.active_policy_id,'policy_version',s.policy_version,'deadline',clock_timestamp()+interval '10 minutes')
  from public.workspaces w join public.workspace_settings s on s.workspace_id=w.id where w.id='11111111-1111-4111-8111-111111111111';
$$;
-- A rollback-only projection barrier deterministically interleaves the real
-- logical lifecycle AFTER original/hash projection and BEFORE final rights.
-- This is controlled SQL scheduling, not a claim of independent-session timing.
create function pg_temp.obligation_projection_lifecycle(ctx jsonb) returns void language plpgsql as $$
begin
  if current_setting('nexusrag063.interleaving',true)='armed' then
    perform set_config('nexusrag063.interleaving','fired',true);
    perform public.tombstone_document((ctx->>'workspace_id')::uuid,current_setting('nexusrag063.interleaving_document')::uuid,(ctx->>'user_id')::uuid);
  end if;
end;$$;
do $$
declare ws uuid='11111111-1111-4111-8111-111111111111';owner_actor uuid='22222222-2222-4222-8222-222222222222';
  author_actor uuid='22222244-2222-4222-8222-222222222222';reviewer uuid='33333333-3333-4333-8333-333333333333';
  ctx jsonb;author_ctx jsonb;r public.research_runs%rowtype;ordinary_run public.research_runs%rowtype;f jsonb;fid uuid;ordinary_fid uuid;
  rights jsonb;response jsonb;command jsonb;policy jsonb;confirmation jsonb;old_command jsonb;selected jsonb;expected jsonb;got jsonb;listed jsonb;
  after_id uuid;i integer;count_before integer;before_usage jsonb;started timestamptz;list_ms numeric;max_list_ms numeric=0;large_policy jsonb;short_command jsonb;unrelated_count integer;affected_hashes text[];a jsonb;b jsonb;c jsonb;head public.finding_serving_rights%rowtype;blocked_id uuid;unrelated_id uuid;projection_definition text;
begin
  select jsonb_agg(to_jsonb(x) order by user_id) into before_usage from public.nexus_account_usage x;
  insert into public.workspace_members(workspace_id,user_id,role) values(ws,reviewer,'editor') on conflict(workspace_id,user_id) do update set role='editor';
  ctx=pg_temp.obligation_context(owner_actor);author_ctx=pg_temp.obligation_context(author_actor);
  select rr.* into strict r from public.research_runs rr join public.research_plans p on p.workspace_id=rr.workspace_id and p.id=rr.plan_id
    where rr.workspace_id=ws and p.plan->>'plan_id'='obligation-capacity-plan' and rr.idempotency_key='obligation-capacity-start';
  if r.mode<>'OBLIGATION_ANALYSIS' or jsonb_array_length(r.source_snapshot)<>50 or jsonb_array_length(r.results)<>11
    or jsonb_array_length(r.results->10->'obligations'->'candidates')<>12 then raise exception 'Real maximum Obligation fixture missing';end if;
  f=public.nexus_finding(author_ctx,'create',null,jsonb_build_object('title','Serving063 📊','authored_markdown','Qualified candidates only',
    'research_run_id',r.id,'result_index',10),null,'serving063-assertion',repeat('a',64));fid=(f->>'id')::uuid;
  perform public.nexus_finding(author_ctx,'share',fid,jsonb_build_object('user_id',owner_actor,'permission','contribute'),null,null,null);
  perform public.nexus_finding(author_ctx,'share',fid,jsonb_build_object('user_id',reviewer,'permission','contribute'),null,null,null);
  response=public.nexus_obligation_evidence(ctx,'read','SERVE_API',fid,1);
  if response->>'state'<>'REVIEW_REQUIRED' or response->'title'<>'null'::jsonb or response->'result'<>'null'::jsonb or response->'evidence'<>'[]'::jsonb then raise exception 'Unreviewed content served';end if;
  rights=public.nexus_finding_serving_rights(ctx,'read',fid,'SERVE_API');
  if jsonb_array_length(rights->'items')<>50 or rights->>'eligible'<>'false' or exists(select 1 from jsonb_array_elements(rights->'items') x where x->>'state'<>'UNKNOWN') then raise exception 'Unknown rights lost snapshot scope';end if;
  policy=jsonb_build_object('decision','ALLOW','basis','OWNED_CONTENT','rationale','Owned synthetic 📊 fixture','evidence_reference','urn:synthetic:obligation063',
    'attribution','Synthetic author','duties',jsonb_build_array('Retain all limitations 📊'),'review_by','2030-01-01T00:00:00.000Z');
  select jsonb_agg(jsonb_build_object('version_id',x->'version_id','expected_review_id',null)) into selected from jsonb_array_elements(rights->'items') x;
  perform public.nexus_finding_export_rights(ctx,'record',fid,jsonb_build_object('selections',selected,'policy',policy),1,'serving063-export');
  if public.nexus_finding_serving_rights(ctx,'read',fid,'SERVE_API')->>'eligible'<>'false' then raise exception 'EXPORT implicitly granted API';end if;
  select jsonb_agg(jsonb_build_object('version_id',x->'version_id','original_hash',x->'original_hash','expected_review_id',x->'review_id')) into selected from jsonb_array_elements(rights->'items') x;
  command=jsonb_build_object('selections',selected,'policy',policy);old_command=command;
  rights=public.nexus_finding_serving_rights(ctx,'record',fid,'SERVE_API',command,1,'serving063-api');confirmation=rights->'confirmed_review';
  if rights->>'eligible'<>'true' or confirmation ? 'command' or confirmation ? 'policy' or confirmation->>'actor_id'<>owner_actor::text
    or confirmation->>'serialization'<>'OBLIGATION_SERVING_INTENT_UTF8/1'
    or confirmation->>'intent_hash'<>public.nexus_serving_intent_hash(fid,1,'SERVE_API',owner_actor,command) then raise exception 'Compact intent confirmation not actual persisted identity';end if;
  count_before=(select count(*) from public.finding_serving_rights where workspace_id=ws);
  if public.nexus_finding_serving_rights(ctx,'record',fid,'SERVE_API',command,1,'serving063-api')->'confirmed_review'<>confirmation
    or (select count(*) from public.finding_serving_rights where workspace_id=ws)<>count_before then raise exception 'Replay duplicated decisions';end if;
  begin perform public.nexus_finding_serving_rights(ctx,'record',fid,'SERVE_API',jsonb_set(command,'{policy,rationale}','"Different intent"'),1,'serving063-api');raise exception 'Changed intent accepted';
    exception when others then if sqlerrm<>'NR:VERSION_CONFLICT' then raise;end if;end;
  perform public.nexus_finding(ctx,'review',fid,'{"decision":"approved","comment":"Independent exact-source review"}',1,null,null);
  response=public.nexus_obligation_evidence(ctx,'read','SERVE_API',fid,1);
  if response->>'state'<>'READY' or response->'result'<>r.results->10 or response->'source_snapshot'<>r.source_snapshot or jsonb_array_length(response->'evidence')<>50
    or jsonb_array_length(response->'rights')<>50 or response->'result'->'obligations'->'candidates'->11->>'control_state'<>'PROPOSED_NOT_IMPLEMENTED'
    or response->'result'->'obligations'->'candidates'->11->>'applicability_state'<>'NOT_DETERMINED' then raise exception 'Maximum typed result or qualifications lost';end if;
  if public.nexus_obligation_evidence(ctx,'read','SERVE_MCP',fid,1)->>'state'<>'RIGHTS_BLOCKED' then raise exception 'API implicitly granted MCP';end if;
  -- State and published rights must come from the final current view. The
  -- controlled barrier calls the REAL tombstone function after real projection;
  -- all schema/data edits disappear with this nested rollback.
  begin
    select pg_get_functiondef('public.nexus_research_finding_view(jsonb,uuid)'::regprocedure) into projection_definition;
    if strpos(projection_definition,'if change is null then return f;end if;')=0 then raise exception 'Known frozen projection barrier missing';end if;
    execute replace(projection_definition,'if change is null then return f;end if;',
      'if change is null then perform pg_temp.obligation_projection_lifecycle(p_context);return f;end if;');
    perform set_config('nexusrag063.interleaving_document',r.source_snapshot->1->>'document_id',true);
    perform set_config('nexusrag063.interleaving','armed',true);
    response=public.nexus_obligation_evidence(ctx,'read','SERVE_API',fid,1);
    if current_setting('nexusrag063.interleaving')<>'fired' or response->>'state'<>'SOURCE_UNAVAILABLE'
      or response->'result'<>'null'::jsonb or response->'evidence'<>'[]'::jsonb or response->'rights'<>'[]'::jsonb
      then raise exception 'Projection/lifecycle interleaving returned incoherent READY: state %, source %, rights %',response->>'state',response->>'source_state',response->>'rights_state';end if;
    raise exception using errcode='P0630',message='rollback controlled projection lifecycle';exception when sqlstate 'P0630' then null;end;

  -- A shared policy batch can also be erased by a source OUTSIDE this
  -- Finding's own snapshot. Seed only the cross-source batch coupling here;
  -- the lifecycle, original projection and final rights reads are real SQL.
  -- This tests current-state coherence, not a synthetic human-review receipt.
  begin
    select rr.* into strict ordinary_run from public.research_runs rr
      where rr.workspace_id=ws and rr.idempotency_key='actual-OBLIGATION_ANALYSIS-start';
    b=ordinary_run.source_snapshot->0;
    if exists(select 1 from jsonb_array_elements(r.source_snapshot) s where s->>'document_id'=b->>'document_id')
      then raise exception 'Outside-source interleaving fixture overlaps served snapshot';end if;
    select * into strict head from public.finding_serving_rights where workspace_id=ws
      and version_id=(r.source_snapshot->0->>'version_id')::uuid and action='SERVE_API' order by created_at desc,id desc limit 1;
    insert into public.finding_serving_rights(workspace_id,version_id,original_hash,action,actor_id,policy,intent_hash)
      select ws,v.id,v.original_hash,'SERVE_API',owner_actor,head.policy,head.intent_hash from public.document_versions v
        where v.workspace_id=ws and v.id=(b->>'version_id')::uuid;
    select pg_get_functiondef('public.nexus_research_finding_view(jsonb,uuid)'::regprocedure) into projection_definition;
    if strpos(projection_definition,'if change is null then return f;end if;')=0 then raise exception 'Known frozen projection barrier missing';end if;
    execute replace(projection_definition,'if change is null then return f;end if;',
      'if change is null then perform pg_temp.obligation_projection_lifecycle(p_context);return f;end if;');
    perform set_config('nexusrag063.interleaving_document',b->>'document_id',true);
    perform set_config('nexusrag063.interleaving','armed',true);
    response=public.nexus_obligation_evidence(ctx,'read','SERVE_API',fid,1);
    if current_setting('nexusrag063.interleaving')<>'fired' or response->>'state'<>'RIGHTS_BLOCKED'
      or response->>'source_state'<>'CURRENT' or response->>'rights_state'<>'RIGHTS_BLOCKED'
      or response->'result'<>'null'::jsonb or response->'evidence'<>'[]'::jsonb or response->'rights'<>'[]'::jsonb
      then raise exception 'Outside-source policy erasure returned incoherent content: state %, source %, rights %',response->>'state',response->>'source_state',response->>'rights_state';end if;
    rights=public.nexus_finding_serving_rights(ctx,'read',fid,'SERVE_API');
    if rights->>'source_state'<>'CURRENT' or rights->>'eligible'<>'false'
      or exists(select 1 from jsonb_array_elements(rights->'items') s where s->>'state'<>'REVOKED' or s->'policy'<>'null'::jsonb or s->>'policy_erased_at' is null)
      then raise exception 'Outside-source erasure did not retain exact withdrawn policy heads';end if;
    raise exception using errcode='P0630',message='rollback controlled outside-source policy erasure';exception when sqlstate 'P0630' then null;end;

  -- Actual clock expiry, including a same-intent ALLOW retry whose submitted
  -- review_by is now past. Receipt identity survives; current eligibility does
  -- not. A separate new reviewed renewal restores only that version's rights.
  rights=public.nexus_finding_serving_rights(ctx,'read',fid,'SERVE_API');selected=rights->'items'->0;
  short_command=jsonb_build_object('selections',jsonb_build_array(jsonb_build_object('version_id',selected->'version_id','original_hash',selected->'original_hash','expected_review_id',selected->'review_id')),
    'policy',policy||jsonb_build_object('review_by',clock_timestamp()+interval '100 milliseconds'));
  rights=public.nexus_finding_serving_rights(ctx,'record',fid,'SERVE_API',short_command,1,'serving063-short-expiry');count_before=(select count(*) from public.finding_serving_rights where workspace_id=ws);
  perform pg_sleep(0.2);rights=public.nexus_finding_serving_rights(ctx,'record',fid,'SERVE_API',short_command,1,'serving063-short-expiry');
  if rights->'items'->0->>'state'<>'EXPIRED' or rights->>'eligible'<>'false' or rights->'confirmed_review'->>'intent_hash'<>public.nexus_serving_intent_hash(fid,1,'SERVE_API',owner_actor,short_command)
    or (select count(*) from public.finding_serving_rights where workspace_id=ws)<>count_before then raise exception 'Expired same intent resurrected eligibility or duplicated a decision';end if;
  response=public.nexus_obligation_evidence(ctx,'read','SERVE_API',fid,1);
  if response->>'state'<>'RIGHTS_BLOCKED' or response->'result'<>'null'::jsonb then raise exception 'Expired rights still served result';end if;
  selected=rights->'items'->0;short_command=jsonb_build_object('selections',jsonb_build_array(jsonb_build_object('version_id',selected->'version_id','original_hash',selected->'original_hash','expected_review_id',selected->'review_id')),'policy',policy);
  rights=public.nexus_finding_serving_rights(ctx,'record',fid,'SERVE_API',short_command,1,'serving063-expiry-renewal');if rights->>'eligible'<>'true' then raise exception 'Explicit dated renewal not effective';end if;
  perform public.nexus_finding(pg_temp.obligation_context(reviewer),'review',fid,'{"decision":"changes_requested","comment":"Reinspect exceptions"}',1,null,null);
  response=public.nexus_obligation_evidence(ctx,'read','SERVE_API',fid,1);
  if response->>'review_state'<>'CHANGES_REQUESTED' or response->'result'<>'null'::jsonb or response->'reviews'<>'[]'::jsonb then raise exception 'Review withdrawal retained content';end if;
  perform public.nexus_finding(pg_temp.obligation_context(reviewer),'review',fid,'{"decision":"approved","comment":"Exceptions retained"}',1,null,null);

  --50 nearly8kB policies, fifty genuine domain entries and interleaved notes.
  -- Lists use a state-only aggregate, never50 complete policy projections/entry.
  large_policy=policy||jsonb_build_object('rationale',repeat('r',2000),'evidence_reference',repeat('e',2000),'attribution',repeat('a',4000),'duties','[]'::jsonb);
  if octet_length(large_policy::text)<8000 or octet_length(large_policy::text)>8192 then raise exception 'Near8192-byte policy fixture lost its boundary: %',octet_length(large_policy::text);end if;
  rights=public.nexus_finding_serving_rights(ctx,'read',fid,'SERVE_API');
  select jsonb_agg(jsonb_build_object('version_id',x->'version_id','original_hash',x->'original_hash','expected_review_id',x->'review_id')) into selected from jsonb_array_elements(rights->'items') x;
  perform public.nexus_finding_serving_rights(ctx,'record',fid,'SERVE_API',jsonb_build_object('selections',selected,'policy',large_policy),1,'serving063-large-policy');
  for i in 1..54 loop
    f=public.nexus_finding(author_ctx,'create',null,jsonb_build_object('title','Paged obligation '||i,'research_run_id',r.id,'result_index',10),null,'serving063-page-'||i,encode(sha256(convert_to(i::text,'UTF8')),'hex'));
    perform public.nexus_finding(author_ctx,'share',(f->>'id')::uuid,jsonb_build_object('user_id',owner_actor,'permission','read'),null,null,null);
    perform public.nexus_finding(ctx,'create',null,jsonb_build_object('title','Interleaved generic note '||i,'authored_markdown','Not an obligation'),null,'serving063-note-'||i,repeat('b',64));
  end loop;
  select jsonb_agg(f0.id::text order by f0.id) into expected from public.findings f0 join public.obligation_evidence_origins o on o.workspace_id=f0.workspace_id and o.finding_id=f0.id
    where f0.workspace_id=ws and f0.deleted_at is null and(f0.owner_id=owner_actor or exists(select 1 from public.finding_participants p where p.workspace_id=ws and p.finding_id=f0.id and p.user_id=owner_actor));
  foreach i in array array[20,50] loop
    got='[]';after_id=null;
    loop
      started=clock_timestamp();listed=public.nexus_obligation_evidence(ctx,'list','SERVE_API',p_limit=>i,p_after=>after_id);list_ms=extract(epoch from clock_timestamp()-started)*1000;max_list_ms=greatest(max_list_ms,list_ms);
      if list_ms>=8000 then raise exception 'Unchanged8s list RPC exceeded:%ms',list_ms;end if;
      if exists(select 1 from jsonb_array_elements(listed->'items') x where x ? 'title' or x ? 'result' or x ? 'source_snapshot' or x ? 'rights') then raise exception 'Metadata list leaked/materialized content';end if;
      got=got||(select coalesce(jsonb_agg(x->'finding_id'),'[]') from jsonb_array_elements(listed->'items') x);after_id=(listed->>'next_after')::uuid;exit when after_id is null;
    end loop;
    if got<>expected then raise exception 'Domain pagination omitted/duplicated entries at limit%',i;end if;
  end loop;
  f=public.nexus_finding(ctx,'create',null,'{"title":"Fake domain prose","authored_markdown":"research-obligations/1"}',null,'serving063-manual',repeat('c',64));
  begin perform public.nexus_obligation_evidence(ctx,'read','SERVE_API',(f->>'id')::uuid,1);raise exception 'Manual note became domain record';exception when others then if sqlerrm<>'NR:NOT_FOUND' then raise;end if;end;

  -- A real ordinary criterion cites2 of50 selected sources. All disclosed source
  -- metadata needs serving rights, not only the final quotation versions.
  select * into strict ordinary_run from public.research_runs where workspace_id=ws and idempotency_key='actual-OBLIGATION_ANALYSIS-start';
  f=public.nexus_finding(author_ctx,'create',null,jsonb_build_object('title','Partially cited scope','research_run_id',ordinary_run.id,'result_index',10),null,'serving063-consulted',repeat('d',64));ordinary_fid=(f->>'id')::uuid;
  perform public.nexus_finding(author_ctx,'share',ordinary_fid,jsonb_build_object('user_id',owner_actor,'permission','contribute'),null,null,null);
  perform public.nexus_finding(ctx,'review',ordinary_fid,'{"decision":"approved","comment":"All50source scope retained"}',1,null,null);
  rights=public.nexus_finding_serving_rights(ctx,'read',ordinary_fid,'SERVE_API');
  select jsonb_agg(jsonb_build_object('version_id',x->'version_id','original_hash',x->'original_hash','expected_review_id',x->'review_id')) into selected from jsonb_array_elements(rights->'items') x
    where x->>'version_id' in(select s->>'version_id' from jsonb_array_elements(ordinary_run.results->10->'sources') s);
  if jsonb_array_length(selected)<>2 then raise exception 'Real2-citation50-source fixture absent';end if;
  perform public.nexus_finding_serving_rights(ctx,'record',ordinary_fid,'SERVE_API',jsonb_build_object('selections',selected,'policy',policy),1,'serving063-cited-only');
  response=public.nexus_obligation_evidence(ctx,'read','SERVE_API',ordinary_fid,1);
  if response->>'state'<>'RIGHTS_BLOCKED' or response->'source_snapshot'<>'null'::jsonb then raise exception 'Unreviewed non-cited metadata served';end if;

  -- Each real source-change falsifier rolls back independently.
  for selected in select * from jsonb_array_elements(jsonb_build_array(
    jsonb_build_object('sql',format('update public.document_versions set index_generation=''changed063'' where id=%L',r.source_snapshot->0->>'version_id')),
    jsonb_build_object('sql',format('update public.document_versions set original_hash=repeat(''e'',64) where id=%L',r.source_snapshot->0->>'version_id')),
    jsonb_build_object('sql',format('update public.document_chunks set original_text=original_text||''changed'' where id=%L',r.results->10->'sources'->0->>'chunk_id')))) loop
    begin execute selected->>'sql';response=public.nexus_obligation_evidence(ctx,'read','SERVE_API',fid,1);
      if response->>'state'<>'SOURCE_UNAVAILABLE' or response->'result'<>'null'::jsonb then raise exception 'Changed source served';end if;
      raise exception using errcode='P0630',message='rollback changed source';exception when sqlstate 'P0630' then null;end;
  end loop;

  -- A later DENY[A,B] must not expose older ALLOW[A] whenB is removed.
  -- Keep that opaque head/id while erasing ALL free-form batch copies. An
  -- independent later ALLOW[C] not involvingB and unrelated sources survive.
  unrelated_count=(select count(*) from public.finding_serving_rights where workspace_id=ws and version_id in(select (s->>'version_id')::uuid from jsonb_array_elements(ordinary_run.source_snapshot) s));
  begin
    rights=public.nexus_finding_serving_rights(ctx,'read',fid,'SERVE_API');a=rights->'items'->0;b=rights->'items'->1;c=rights->'items'->2;
    command=jsonb_build_object('selections',jsonb_build_array(
      jsonb_build_object('version_id',a->'version_id','original_hash',a->'original_hash','expected_review_id',a->'review_id'),
      jsonb_build_object('version_id',b->'version_id','original_hash',b->'original_hash','expected_review_id',b->'review_id')),
      'policy',policy||jsonb_build_object('decision','DENY','rationale','MUST_ERASE_SOURCE_POLICY_063'));
    rights=public.nexus_finding_serving_rights(ctx,'record',fid,'SERVE_API',command,1,'serving063-lifecycle-deny');blocked_id=(rights->'items'->0->>'review_id')::uuid;
    if rights->'items'->0->>'state'<>'DENIED' then raise exception 'Lifecycle falsifier not initially denied';end if;
    command=jsonb_build_object('selections',jsonb_build_array(jsonb_build_object('version_id',c->'version_id','original_hash',c->'original_hash','expected_review_id',c->'review_id')),
      'policy',policy||jsonb_build_object('rationale','Independent active source policy063'));
    rights=public.nexus_finding_serving_rights(ctx,'record',fid,'SERVE_API',command,1,'serving063-independent-allow');unrelated_id=(rights->'items'->2->>'review_id')::uuid;
    select array_agg(distinct intent_hash) into affected_hashes from public.finding_serving_rights where workspace_id=ws and version_id=(b->>'version_id')::uuid;
    perform public.tombstone_document(ws,(b->>'document_id')::uuid,owner_actor);
    if exists(select 1 from public.finding_serving_rights erased where erased.workspace_id=ws and erased.intent_hash=any(affected_hashes) and (erased.policy is not null or erased.policy_erased_at is null))
      or exists(select 1 from public.workbench_mutations mutation where mutation.workspace_id=ws and mutation.operation like 'finding.serving-rights.%' and (mutation.response ? 'command' or mutation.response ? 'policy'))
      then raise exception 'Removed source free-form batch/confirmation text retained';end if;
    select * into head from public.finding_serving_rights where workspace_id=ws and version_id=(a->>'version_id')::uuid and action='SERVE_API' order by created_at desc,id desc limit 1;
    if head.id<>blocked_id or head.policy is not null or head.policy_erased_at is null
      or public.nexus_serving_right_state(true,head.id,head.policy,head.original_hash,a->>'original_hash')<>'REVOKED'
      then raise exception 'Source cleanup resurrected older ALLOW or fabricated human policy';end if;
    select * into head from public.finding_serving_rights where workspace_id=ws and version_id=(c->>'version_id')::uuid and action='SERVE_API' order by created_at desc,id desc limit 1;
    if head.id<>unrelated_id or head.policy_erased_at is not null or head.policy->>'rationale'<>'Independent active source policy063'
      or public.nexus_serving_right_state(true,head.id,head.policy,head.original_hash,c->>'original_hash')<>'ALLOWED' then raise exception 'Unrelated latest decision removed or withheld';end if;
    if (select count(*) from public.finding_serving_rights where workspace_id=ws and version_id in(select (s->>'version_id')::uuid from jsonb_array_elements(ordinary_run.source_snapshot) s))<>unrelated_count
      then raise exception 'Unrelated source decisions removed';end if;
    rights=public.nexus_finding_serving_rights(ctx,'record',fid,'SERVE_API',old_command,1,'serving063-api');
    if rights->'confirmed_review'<>confirmation or rights->>'eligible'<>'false' then raise exception 'Compact replay lost identity/current removal state';end if;
    begin perform public.nexus_finding_serving_rights(ctx,'record',fid,'SERVE_API',old_command||jsonb_build_object('policy',policy||'{"decision":"REVOKED"}'),1,'serving063-after-removal');raise exception 'Removed source policy recreated';
      exception when others then if sqlerrm<>'NR:SOURCE_UNAVAILABLE' then raise;end if;end;
    raise exception using errcode='P0630',message='rollback owned logical lifecycle';exception when sqlstate 'P0630' then null;end;
  -- Physical version removal has the same bounded cleanup and typed new-write
  -- result, not a raw FK failure. Only exact owned fixture rows are removed.
  begin
    update public.documents set active_version_id=null where workspace_id=ws and id=(r.source_snapshot->0->>'document_id')::uuid;
    delete from public.document_chunks where workspace_id=ws and version_id=(r.source_snapshot->0->>'version_id')::uuid;
    delete from public.document_versions where workspace_id=ws and id=(r.source_snapshot->0->>'version_id')::uuid;
    begin perform public.nexus_finding_serving_rights(ctx,'record',fid,'SERVE_API',old_command||jsonb_build_object('policy',policy||'{"decision":"DENY"}'),1,'serving063-missing-version');raise exception 'Missing source policy recreated';
      exception when others then if sqlerrm<>'NR:SOURCE_UNAVAILABLE' then raise;end if;end;
    raise exception using errcode='P0630',message='rollback physical lifecycle';exception when sqlstate 'P0630' then null;end;

  perform public.nexus_finding(author_ctx,'edit',fid,'{"title":"Later063revision","authored_markdown":"Still qualified"}',1,null,null);
  if public.nexus_obligation_evidence(ctx,'read','SERVE_API',fid,2)->>'state'<>'REVIEW_REQUIRED' then raise exception 'Old Finding approval covered laterrevision';end if;
  rights=public.nexus_finding_serving_rights(ctx,'record',fid,'SERVE_API',old_command,1,'serving063-api');
  if rights->'confirmed_review'<>confirmation or rights->>'revision'<>'2' then raise exception 'Replay after edit lost immutable identity';end if;
  begin perform public.nexus_obligation_evidence(ctx,'read','SERVE_API',fid,1);raise exception 'Stale revision read';exception when others then if sqlerrm<>'NR:VERSION_CONFLICT' then raise;end if;end;

  -- Erasure is a NULL policy on an existing immutable head, never an ALLOW.
  -- At capacity it cannot consume an extra safe-withdrawal row. SQL three-valued
  -- comparisons must reject NULL as well as explicit non-ALLOW decisions.
  begin
    b=ordinary_run.source_snapshot->0;
    select * into strict head from public.finding_serving_rights where workspace_id=ws
      and version_id=(r.source_snapshot->0->>'version_id')::uuid and action='SERVE_API' order by created_at desc,id desc limit 1;
    insert into public.finding_serving_rights(workspace_id,version_id,original_hash,action,actor_id,policy,intent_hash)
      select ws,v.id,v.original_hash,'SERVE_API',owner_actor,head.policy,head.intent_hash from public.document_versions v
        where v.workspace_id=ws and v.id=(b->>'version_id')::uuid;
    perform public.tombstone_document(ws,(b->>'document_id')::uuid,owner_actor);
    rights=public.nexus_finding_serving_rights(ctx,'read',fid,'SERVE_API');selected=rights->'items'->0;
    if rights->>'source_state'<>'CURRENT' or selected->>'state'<>'REVOKED' or selected->'policy'<>'null'::jsonb
      then raise exception 'Erased capacity fixture is not an active source with a withdrawn head';end if;
    insert into public.finding_serving_rights(workspace_id,version_id,original_hash,action,actor_id,policy,intent_hash,created_at)
      select ws,(r.source_snapshot->0->>'version_id')::uuid,repeat('a',64),'SERVE_API',owner_actor,policy||'{"decision":"DENY"}',repeat('a',64),'2000-01-01T00:00:00Z'
      from generate_series(1,10000-(select count(*) from public.finding_serving_rights where workspace_id=ws and not capacity_withdrawal));
    command=jsonb_build_object('selections',jsonb_build_array(jsonb_build_object('version_id',selected->'version_id','original_hash',selected->'original_hash','expected_review_id',selected->'review_id')),'policy',policy||'{"decision":"REVOKED"}');
    begin perform public.nexus_finding_serving_rights(ctx,'record',fid,'SERVE_API',command,2,'serving063-erased-at-cap');raise exception 'Erased non-ALLOW consumed extra capacity-withdrawal row';
      exception when others then if sqlerrm<>'NR:RESOURCE_LIMIT_EXCEEDED' then raise;end if;end;
    raise exception using errcode='P0630',message='rollback erased capacity fixture';exception when sqlstate 'P0630' then null;end;

  --10000 ordinary rows retain at most one safe withdrawal per prior ALLOW.
  insert into public.finding_serving_rights(workspace_id,version_id,original_hash,action,actor_id,policy,intent_hash,created_at)
    select ws,(r.source_snapshot->0->>'version_id')::uuid,repeat('a',64),'SERVE_API',owner_actor,policy||'{"decision":"DENY"}',repeat('a',64),'2000-01-01T00:00:00Z'
      from generate_series(1,10000-(select count(*) from public.finding_serving_rights where workspace_id=ws and not capacity_withdrawal));
  rights=public.nexus_finding_serving_rights(ctx,'read',fid,'SERVE_API');selected=rights->'items'->0;
  command=jsonb_build_object('selections',jsonb_build_array(jsonb_build_object('version_id',selected->'version_id','original_hash',selected->'original_hash','expected_review_id',selected->'review_id')),'policy',policy||'{"decision":"REVIEW_REQUIRED"}');
  rights=public.nexus_finding_serving_rights(ctx,'record',fid,'SERVE_API',command,2,'serving063-cap-withdraw');
  if rights->'items'->0->>'state'<>'REVIEW_REQUIRED' or (select count(*) from public.finding_serving_rights where workspace_id=ws and capacity_withdrawal)<>1 then raise exception 'Capacity prevented safe withdrawal';end if;
  command=jsonb_set(command,'{selections,0,expected_review_id}',rights->'items'->0->'review_id');
  begin perform public.nexus_finding_serving_rights(ctx,'record',fid,'SERVE_API',command,2,'serving063-repeat-withdraw');raise exception 'Repeated withdrawals bypassed cap';exception when others then if sqlerrm<>'NR:RESOURCE_LIMIT_EXCEEDED' then raise;end if;end;

  -- Run loss alone keeps active source versions and can still safely revoke.
  delete from public.research_runs where id=r.id;
  response=public.nexus_obligation_evidence(ctx,'read','SERVE_API',fid,2);rights=public.nexus_finding_serving_rights(ctx,'read',fid,'SERVE_API');
  if response->>'run_id'<>r.id::text or response->>'state'<>'SOURCE_UNAVAILABLE' or response->'result'<>'null'::jsonb or jsonb_array_length(rights->'items')<>50
    or rights->'items'->0->>'original_hash' is null then raise exception 'Run loss lost genuine opaque origin or served text';end if;
  selected=rights->'items'->1;command=jsonb_build_object('selections',jsonb_build_array(jsonb_build_object('version_id',selected->'version_id','original_hash',selected->'original_hash','expected_review_id',selected->'review_id')),'policy',policy||'{"decision":"REVOKED"}');
  rights=public.nexus_finding_serving_rights(ctx,'record',fid,'SERVE_API',command,2,'serving063-run-loss-revoke');
  if rights->>'eligible'<>'false' or rights->'confirmed_review'->>'intent_hash'<>public.nexus_serving_intent_hash(fid,2,'SERVE_API',owner_actor,command) then raise exception 'Run loss prevented retained-hash withdrawal';end if;
  if before_usage is distinct from (select jsonb_agg(to_jsonb(x) order by user_id) from public.nexus_account_usage x) then raise exception 'Read workflow changed account usage';end if;
  raise notice 'OBLIGATION_EVIDENCE_LIST_MAX_MS=% POLICY_BYTES=%',max_list_ms,octet_length(large_policy::text);
end;$$;
rollback;
\echo OBLIGATION_EVIDENCE_SQL_PASS
