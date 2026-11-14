-- LOCAL_ONLY_UNAPPROVED063. Genuine saved Obligation Findings, not legal certification.
-- Installation starts no research, provider processing, collection or hosted users.
create table public.obligation_evidence_origins (
  workspace_id uuid not null, finding_id uuid primary key, run_id uuid not null,
  result_index integer not null check(result_index between 0 and 10),
  source_snapshot jsonb not null check(jsonb_typeof(source_snapshot)='array' and jsonb_array_length(source_snapshot) between 1 and 50
    and octet_length(source_snapshot::text)<=65536),
  created_at timestamptz not null default clock_timestamp(),
  foreign key(workspace_id,finding_id) references public.findings(workspace_id,id) on delete cascade
);
create index obligation_evidence_origins_page on public.obligation_evidence_origins(workspace_id,finding_id);
create table public.finding_serving_rights (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  version_id uuid not null, original_hash text not null check(original_hash ~ '^[a-f0-9]{64}$'),
  action text not null check(action in('SERVE_API','SERVE_MCP')), actor_id uuid not null,
  policy jsonb, policy_erased_at timestamptz,
  check((policy is not null and jsonb_typeof(policy)='object' and octet_length(policy::text)<=8192 and policy_erased_at is null)
    or (policy is null and policy_erased_at is not null)),
  intent_hash text not null check(intent_hash ~ '^[a-f0-9]{64}$'),
  capacity_withdrawal boolean not null default false, created_at timestamptz not null default clock_timestamp(),
  foreign key(workspace_id,version_id) references public.document_versions(workspace_id,id) on delete cascade,
  check(not capacity_withdrawal or policy->>'decision' in('DENY','REVIEW_REQUIRED','REVOKED'))
);
create index finding_serving_rights_latest on public.finding_serving_rights(workspace_id,version_id,action,created_at desc,id desc);
create index finding_serving_rights_intent on public.finding_serving_rights(workspace_id,intent_hash);
alter table public.obligation_evidence_origins enable row level security;
alter table public.finding_serving_rights enable row level security;
revoke all on public.obligation_evidence_origins,public.finding_serving_rights from public,anon,authenticated;
grant all on public.obligation_evidence_origins,public.finding_serving_rights to service_role;

-- Keep opaque genuine source/run provenance when the run FK is set NULL. No
-- analysis, original quote, filename or free-form policy is duplicated here.
create function public.nexus_capture_obligation_origin()
returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
declare r public.research_runs%rowtype; prior public.obligation_evidence_origins%rowtype; snapshot jsonb;
begin
  select * into prior from public.obligation_evidence_origins where finding_id=new.id;
  if prior.finding_id is not null then
    if new.workspace_id<>prior.workspace_id or (new.source_research_run_id is not null and
      (new.source_research_run_id<>prior.run_id or new.source_research_position<>prior.result_index)) then raise exception 'NR:VERSION_CONFLICT';end if;
    return new;
  end if;
  if new.source_research_run_id is null then return new;end if;
  select * into r from public.research_runs where workspace_id=new.workspace_id and id=new.source_research_run_id;
  if r.mode is distinct from 'OBLIGATION_ANALYSIS' then return new;end if;
  if new.source_research_position is null or new.source_research_position not between 0 and 10
    or r.results->new.source_research_position->'obligations'->>'schema_version' is distinct from 'research-obligations/1' then raise exception 'NR:INVALID_SCOPE';end if;
  select jsonb_agg(s||jsonb_build_object('original_hash',v.original_hash) order by ordinal) into snapshot
    from jsonb_array_elements(r.source_snapshot) with ordinality x(s,ordinal)
    left join public.document_versions v on v.workspace_id=r.workspace_id and v.id=(s->>'version_id')::uuid and v.document_id=(s->>'document_id')::uuid;
  insert into public.obligation_evidence_origins(workspace_id,finding_id,run_id,result_index,source_snapshot)
    values(new.workspace_id,new.id,r.id,new.source_research_position,snapshot);
  return new;
end;$$;
create trigger capture_obligation_evidence_origin after insert or update of source_research_run_id,source_research_position on public.findings
  for each row execute function public.nexus_capture_obligation_origin();
insert into public.obligation_evidence_origins(workspace_id,finding_id,run_id,result_index,source_snapshot)
select f.workspace_id,f.id,r.id,f.source_research_position,
  (select jsonb_agg(s||jsonb_build_object('original_hash',v.original_hash) order by ordinal)
    from jsonb_array_elements(r.source_snapshot) with ordinality x(s,ordinal)
    left join public.document_versions v on v.workspace_id=r.workspace_id and v.id=(s->>'version_id')::uuid and v.document_id=(s->>'document_id')::uuid)
from public.findings f join public.research_runs r on r.workspace_id=f.workspace_id and r.id=f.source_research_run_id
where r.mode='OBLIGATION_ANALYSIS' and f.source_research_position between 0 and 10
  and r.results->f.source_research_position->'obligations'->>'schema_version'='research-obligations/1';

-- A policy may cover several versions in one intent. Erase the whole policy
-- batch when any covered source is removed, including copies on other selected
-- versions. Keep the opaque decision head/ordering: deleting a later DENY could
-- resurrect an older ALLOW on another still-active version. No new human review
-- is invented; policy_erased_at identifies this lifecycle withdrawal explicitly.
-- Mutation confirmations contain only opaque hashes/IDs, no policy.
create function public.nexus_removed_document_serving_reviews()
returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
declare hashes text[];
begin
  if tg_op='DELETE' or new.lifecycle_state<>'active' then
    select array_agg(distinct r.intent_hash) into hashes from public.finding_serving_rights r join public.document_versions v
      on v.workspace_id=r.workspace_id and v.id=r.version_id where v.workspace_id=old.workspace_id and v.document_id=old.id;
    update public.finding_serving_rights set policy=null,policy_erased_at=coalesce(policy_erased_at,clock_timestamp())
      where workspace_id=old.workspace_id and intent_hash=any(hashes);
  end if;
  if tg_op='DELETE' then return old;else return new;end if;
end;$$;
create trigger removed_document_serving_reviews before delete or update of lifecycle_state on public.documents
  for each row execute function public.nexus_removed_document_serving_reviews();
create function public.nexus_removed_version_serving_reviews()
returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
declare hashes text[];
begin
  select array_agg(distinct intent_hash) into hashes from public.finding_serving_rights where workspace_id=old.workspace_id and version_id=old.id;
  update public.finding_serving_rights set policy=null,policy_erased_at=coalesce(policy_erased_at,clock_timestamp())
      where workspace_id=old.workspace_id and intent_hash=any(hashes);
  return old;
end;$$;
create trigger removed_version_serving_reviews before delete on public.document_versions
  for each row execute function public.nexus_removed_version_serving_reviews();

create function public.nexus_serving_intent_frame(value text)
returns text language sql immutable security invoker set search_path=public,pg_temp as $$
  select case when value is null then '-1:' else octet_length(convert_to(value,'UTF8'))::text||':'||value end;
$$;
create function public.nexus_serving_intent_hash(p_finding uuid,p_revision bigint,p_action text,p_actor uuid,p_command jsonb)
returns text language plpgsql immutable security invoker set search_path=public,pg_temp as $$
declare data text=E'OBLIGATION_SERVING_INTENT_UTF8/1\n'; selected jsonb; policy jsonb=p_command->'policy'; duty jsonb;
begin
  data=data||public.nexus_serving_intent_frame(p_finding::text)||public.nexus_serving_intent_frame(p_revision::text)
    ||public.nexus_serving_intent_frame(p_action)||public.nexus_serving_intent_frame(p_actor::text)
    ||public.nexus_serving_intent_frame(jsonb_array_length(p_command->'selections')::text);
  for selected in select value from jsonb_array_elements(p_command->'selections') loop
    data=data||public.nexus_serving_intent_frame(lower(selected->>'version_id'))||public.nexus_serving_intent_frame(selected->>'original_hash')
      ||public.nexus_serving_intent_frame(lower(selected->>'expected_review_id'));
  end loop;
  data=data||public.nexus_serving_intent_frame(policy->>'decision')||public.nexus_serving_intent_frame(policy->>'basis')
    ||public.nexus_serving_intent_frame(policy->>'rationale')||public.nexus_serving_intent_frame(policy->>'evidence_reference')
    ||public.nexus_serving_intent_frame(policy->>'attribution')||public.nexus_serving_intent_frame(jsonb_array_length(policy->'duties')::text);
  for duty in select value from jsonb_array_elements(policy->'duties') loop data=data||public.nexus_serving_intent_frame(duty#>>'{}');end loop;
  data=data||public.nexus_serving_intent_frame(policy->>'review_by');
  return encode(sha256(convert_to(data,'UTF8')),'hex');
end;$$;

create function public.nexus_obligation_evidence_contract()
returns jsonb language sql stable security invoker set search_path=public,pg_temp as $$
  select jsonb_build_object('schema_version','obligation-evidence/1','list_schema','obligation-evidence-list/1','detail_schema','obligation-evidence-detail/1',
    'rights_schema','finding-serving-rights/1','actions',jsonb_build_array('SERVE_API','SERVE_MCP'),'default_limit',20,'max_limit',50,'max_sources',50,
    'max_candidates',12,'max_criteria',11,'max_result_bytes',1000000);
$$;
create function public.nexus_obligation_access(p_context jsonb,p_finding uuid)
returns public.findings language plpgsql security invoker set search_path=public,pg_temp as $$
declare f public.findings%rowtype; ws uuid=(p_context->>'workspace_id')::uuid; actor uuid=(p_context->>'user_id')::uuid;
begin
  perform public.workbench_authorize(p_context,'read');
  select * into f from public.findings where workspace_id=ws and id=p_finding and deleted_at is null;
  if not found then raise exception 'NR:NOT_FOUND';end if;
  if f.owner_id<>actor and not exists(select 1 from public.finding_participants where workspace_id=ws and finding_id=p_finding and user_id=actor)
    then raise exception 'NR:FORBIDDEN';end if;
  if not exists(select 1 from public.obligation_evidence_origins where workspace_id=ws and finding_id=p_finding) then raise exception 'NR:NOT_FOUND';end if;
  return f;
end;$$;
create function public.nexus_obligation_source_metadata(p_context jsonb,p_finding uuid)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare f public.findings%rowtype; o public.obligation_evidence_origins%rowtype; r public.research_runs%rowtype;
  items jsonb; available boolean; ws uuid=(p_context->>'workspace_id')::uuid;
begin
  f=public.nexus_obligation_access(p_context,p_finding);
  select * into o from public.obligation_evidence_origins where workspace_id=ws and finding_id=p_finding;
  -- List checks do not decompress/materialize all11MB of stored run results.
  select id,mode,source_snapshot into r.id,r.mode,r.source_snapshot from public.research_runs where workspace_id=ws and id=o.run_id;
  select jsonb_agg(jsonb_build_object('document_id',s->'document_id','version_id',s->'version_id','original_hash',s->'original_hash',
    'filename',case when d.lifecycle_state='active' then d.filename end,'lifecycle_available',coalesce(v.id is not null and d.lifecycle_state='active',false),
    'available',coalesce(d.lifecycle_state='active' and d.active_version_id=v.id and v.publication_state='ready' and v.data_classification='non_sensitive'
      and v.original_verified_at is not null and v.original_hash=s->>'original_hash' and v.index_generation=s->>'index_generation'
      and v.lifecycle_epoch::text=s->>'lifecycle_epoch' and d.lifecycle_epoch=v.lifecycle_epoch,false)) order by ordinal) into items
    from jsonb_array_elements(o.source_snapshot) with ordinality x(s,ordinal)
    left join public.document_versions v on v.workspace_id=ws and v.id=(s->>'version_id')::uuid and v.document_id=(s->>'document_id')::uuid
    left join public.documents d on d.workspace_id=ws and d.id=v.document_id;
  available=coalesce(r.id is not null and r.mode='OBLIGATION_ANALYSIS' and f.source_research_run_id=o.run_id and f.source_research_position=o.result_index
    and r.source_snapshot=(select jsonb_agg(s-'original_hash' order by ordinal) from jsonb_array_elements(o.source_snapshot) with ordinality x(s,ordinal))
    and not exists(select 1 from jsonb_array_elements(items) s where s->>'available' is distinct from 'true'),false);
  return jsonb_build_object('source_state',case when available then 'CURRENT' else 'UNAVAILABLE_OR_CHANGED' end,'items',items);
end;$$;
create function public.nexus_obligation_review_state(p_workspace uuid,p_finding uuid,p_revision bigint)
returns text language sql stable security invoker set search_path=public,pg_temp as $$
  select case when exists(select 1 from public.finding_reviews where workspace_id=p_workspace and finding_id=p_finding and revision=p_revision and decision='changes_requested')
    then 'CHANGES_REQUESTED' when exists(select 1 from public.finding_reviews r join public.finding_versions v
      on v.workspace_id=r.workspace_id and v.finding_id=r.finding_id and v.revision=r.revision where r.workspace_id=p_workspace and r.finding_id=p_finding
      and r.revision=p_revision and r.decision='approved' and r.reviewer_id<>v.author_id and v.redacted_at is null) then 'APPROVED' else 'REVIEW_REQUIRED' end;
$$;
create function public.nexus_serving_right_state(p_current boolean,p_review uuid,p_policy jsonb,p_hash text,p_original text)
returns text language sql volatile security invoker set search_path=public,pg_temp set timezone='UTC' as $$
  select case when not p_current then 'SOURCE_UNAVAILABLE' when p_review is null then 'UNKNOWN' when p_policy is null then 'REVOKED' when p_hash is distinct from p_original then 'HASH_MISMATCH'
    when p_policy->>'decision'='REVOKED' then 'REVOKED' when p_policy->>'decision'='DENY' then 'DENIED'
    when p_policy->>'decision' is distinct from 'ALLOW' or p_policy->>'basis'='UNKNOWN' then 'REVIEW_REQUIRED'
    when p_policy->>'review_by' is null or (p_policy->>'review_by')::timestamptz<=clock_timestamp() then 'EXPIRED' else 'ALLOWED' end;
$$;
-- Aggregate list availability without constructing50 complete8kB policies per
-- Finding. Detail/right-review reads retain those actual fields when needed.
create function public.nexus_obligation_rights_summary(p_context jsonb,p_finding uuid,p_action text)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare sources jsonb; eligible boolean; ws uuid=(p_context->>'workspace_id')::uuid;
begin
  if p_action is null or p_action not in('SERVE_API','SERVE_MCP') then raise exception 'NR:INVALID_SCOPE';end if;
  sources=public.nexus_obligation_source_metadata(p_context,p_finding);
  select coalesce(bool_and(public.nexus_serving_right_state(sources->>'source_state'='CURRENT' and s->>'available'='true',r.id,r.policy,r.original_hash,s->>'original_hash')='ALLOWED'),false)
    into eligible from jsonb_array_elements(sources->'items') x(s)
    left join lateral(select id,policy,original_hash from public.finding_serving_rights where workspace_id=ws and version_id=(s->>'version_id')::uuid
      and action=p_action order by created_at desc,id desc limit 1) r on true;
  return jsonb_build_object('source_state',sources->'source_state','eligible',eligible);
end;$$;
create function public.nexus_finding_serving_rights_view(p_context jsonb,p_finding uuid,p_action text)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare f public.findings%rowtype; sources jsonb; items jsonb; role_name text; ws uuid=(p_context->>'workspace_id')::uuid;
begin
  if p_action is null or p_action not in('SERVE_API','SERVE_MCP') then raise exception 'NR:INVALID_SCOPE';end if;
  f=public.nexus_obligation_access(p_context,p_finding);sources=public.nexus_obligation_source_metadata(p_context,p_finding);
  select role into role_name from public.workspace_members where workspace_id=ws and user_id=(p_context->>'user_id')::uuid;
  select jsonb_agg((s-'available'-'lifecycle_available')||jsonb_build_object('review_id',review_id,'actor_id',rights_actor,'created_at',reviewed_at,'policy',policy,'policy_erased_at',erased_at,
    'allowed',state='ALLOWED','state',state) order by ordinal) into items from (
    select s,ordinal,r.id review_id,r.actor_id rights_actor,r.created_at reviewed_at,r.policy policy,r.policy_erased_at erased_at,
      public.nexus_serving_right_state(sources->>'source_state'='CURRENT' and s->>'available'='true',r.id,r.policy,r.original_hash,s->>'original_hash') state
    from jsonb_array_elements(sources->'items') with ordinality x(s,ordinal)
    left join lateral(select * from public.finding_serving_rights where workspace_id=ws and version_id=(s->>'version_id')::uuid
      and action=p_action order by created_at desc,id desc limit 1) r on true) current_rights;
  return jsonb_build_object('schema_version','finding-serving-rights/1','workspace_id',ws,'finding_id',p_finding,'revision',f.revision,'action',p_action,
    'source_state',sources->'source_state','eligible',sources->>'source_state'='CURRENT' and not exists(select 1 from jsonb_array_elements(items) s where s->>'allowed' is distinct from 'true'),
    'can_review',coalesce(role_name in('owner','admin'),false),'items',coalesce(items,'[]'),'confirmed_review',null);
end;$$;

create function public.nexus_finding_serving_rights(p_context jsonb,p_operation text,p_finding uuid,p_action text,
  p_command jsonb default '{}',p_revision bigint default null,p_key text default null)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp set timezone='UTC' as $$
declare ws uuid=(p_context->>'workspace_id')::uuid; actor uuid=(p_context->>'user_id')::uuid; f public.findings%rowtype;
  sources jsonb; policy jsonb; selected jsonb; prior public.finding_serving_rights%rowtype; role_name text; digest text;
  mutation public.workbench_mutations%rowtype; ids jsonb='[]'; confirmation jsonb; inserted_id uuid; ordinary_count integer; withdrawal boolean=false;
begin
  if p_action is null or p_action not in('SERVE_API','SERVE_MCP') or p_operation is null or p_operation not in('read','record') then raise exception 'NR:INVALID_SCOPE';end if;
  perform 1 from public.workspaces where id=ws for update;f=public.nexus_obligation_access(p_context,p_finding);
  if p_operation='record' then
    select role into role_name from public.workspace_members where workspace_id=ws and user_id=actor;
    if role_name is null or role_name not in('owner','admin') then raise exception 'NR:FORBIDDEN';end if;
    if jsonb_typeof(p_command) is distinct from 'object' then raise exception 'NR:INVALID_SCOPE';end if;
    if p_key is null or length(p_key) not between 1 and 128 or p_revision is null or p_revision not between 1 and 9007199254740991
      or jsonb_typeof(p_command) is distinct from 'object' or octet_length(p_command::text)>100000
      or (select array_agg(k order by k) from jsonb_object_keys(p_command) k) is distinct from array['policy','selections']
      or jsonb_typeof(p_command->'selections') is distinct from 'array' or jsonb_array_length(p_command->'selections') not between 1 and 50 then raise exception 'NR:INVALID_SCOPE';end if;
    policy=p_command->'policy';
    if jsonb_typeof(policy) is distinct from 'object' then raise exception 'NR:INVALID_SCOPE';end if;
    if jsonb_typeof(policy) is distinct from 'object' or octet_length(policy::text)>8192
      or (select array_agg(k order by k) from jsonb_object_keys(policy) k) is distinct from array['attribution','basis','decision','duties','evidence_reference','rationale','review_by']
      or coalesce(policy->>'decision','') not in('ALLOW','DENY','REVIEW_REQUIRED','REVOKED')
      or coalesce(policy->>'basis','') not in('OWNED_CONTENT','LICENSE','PERMISSION','PUBLIC_DOMAIN','UNKNOWN')
      or jsonb_typeof(policy->'rationale') is distinct from 'string' or length(policy->>'rationale') not between 1 and 2000 or length(btrim(policy->>'rationale'))=0
      or jsonb_typeof(policy->'evidence_reference') is distinct from 'string' or length(policy->>'evidence_reference')>2000
      or jsonb_typeof(policy->'attribution') is distinct from 'string' or length(policy->>'attribution')>4000
      or jsonb_typeof(policy->'duties') is distinct from 'array' or jsonb_array_length(policy->'duties')>10
      or exists(select 1 from jsonb_array_elements(policy->'duties') d where jsonb_typeof(d)<>'string' or length(d#>>'{}') not between 1 and 500 or length(btrim(d#>>'{}'))=0)
      or (policy->'review_by' is distinct from 'null'::jsonb and jsonb_typeof(policy->'review_by') is distinct from 'string') then raise exception 'NR:INVALID_SCOPE';end if;
    if policy->>'review_by' is not null then
      begin perform (policy->>'review_by')::timestamptz;exception when invalid_datetime_format or datetime_field_overflow then raise exception 'NR:INVALID_SCOPE';end;
    end if;
    if policy->>'decision'='ALLOW' and (policy->>'basis'='UNKNOWN' or length(btrim(policy->>'evidence_reference'))=0 or length(btrim(policy->>'attribution'))=0
      or policy->>'review_by' is null) then raise exception 'NR:INVALID_SCOPE';end if;
    if exists(select 1 from jsonb_array_elements(p_command->'selections') s where jsonb_typeof(s) is distinct from 'object') then raise exception 'NR:INVALID_SCOPE';end if;
    if (select count(distinct s->>'version_id') from jsonb_array_elements(p_command->'selections') s)<>jsonb_array_length(p_command->'selections')
      or exists(select 1 from jsonb_array_elements(p_command->'selections') s where jsonb_typeof(s) is distinct from 'object'
        or (select array_agg(k order by k) from jsonb_object_keys(s) k) is distinct from array['expected_review_id','original_hash','version_id']
        or coalesce(s->>'version_id','')!~*'^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$' or coalesce(s->>'original_hash','')!~'^[a-f0-9]{64}$'
        or (s->'expected_review_id' is distinct from 'null'::jsonb and coalesce(s->>'expected_review_id','')!~*'^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$')) then raise exception 'NR:INVALID_SCOPE';end if;
    digest=public.nexus_serving_intent_hash(p_finding,p_revision,p_action,actor,p_command);
    select * into mutation from public.workbench_mutations where workspace_id=ws and actor_id=actor and operation='finding.serving-rights.'||p_action and idempotency_key=p_key;
    if found then
      if mutation.payload_hash<>digest then raise exception 'NR:VERSION_CONFLICT';end if;confirmation=mutation.response;
    else
      if f.revision<>p_revision then raise exception 'NR:VERSION_CONFLICT';end if;
      -- Serialize a new policy with actual source lifecycle/physical removal.
      -- Cleanup that wins first is observed; cleanup that waits sees these rows.
      perform 1 from public.documents d where d.workspace_id=ws and d.id in(select (s->>'document_id')::uuid
        from public.obligation_evidence_origins o cross join lateral jsonb_array_elements(o.source_snapshot) s
        where o.workspace_id=ws and o.finding_id=p_finding) order by d.id for share;
      perform 1 from public.document_versions v where v.workspace_id=ws and v.id in(select (s->>'version_id')::uuid
        from public.obligation_evidence_origins o cross join lateral jsonb_array_elements(o.source_snapshot) s
        where o.workspace_id=ws and o.finding_id=p_finding) order by v.id for share;
      sources=public.nexus_obligation_source_metadata(p_context,p_finding);
      -- Run loss may still revoke active retained versions. Removed source
      -- lifecycle must never accept/recreate free-form policy text or hit rawFK.
      if exists(select 1 from jsonb_array_elements(sources->'items') s where s->>'lifecycle_available' is distinct from 'true') then raise exception 'NR:SOURCE_UNAVAILABLE';end if;
      if policy->>'decision'='ALLOW' and (policy->>'review_by')::timestamptz<=clock_timestamp() then raise exception 'NR:INVALID_SCOPE';end if;
      if policy->>'decision'='ALLOW' and sources->>'source_state'<>'CURRENT' then raise exception 'NR:SOURCE_UNAVAILABLE';end if;
      select count(*) into ordinary_count from public.finding_serving_rights where workspace_id=ws and not capacity_withdrawal;
      withdrawal=ordinary_count+jsonb_array_length(p_command->'selections')>10000;
      if withdrawal and policy->>'decision' not in('DENY','REVIEW_REQUIRED','REVOKED') then raise exception 'NR:RESOURCE_LIMIT_EXCEEDED';end if;
      for selected in select value from jsonb_array_elements(p_command->'selections') loop
        if not exists(select 1 from jsonb_array_elements(sources->'items') s where s->>'version_id'=lower(selected->>'version_id') and s->>'original_hash'=selected->>'original_hash') then raise exception 'NR:VERSION_CONFLICT';end if;
        select * into prior from public.finding_serving_rights where workspace_id=ws and version_id=(selected->>'version_id')::uuid and action=p_action order by created_at desc,id desc limit 1;
        if prior.id is distinct from (selected->>'expected_review_id')::uuid then raise exception 'NR:VERSION_CONFLICT';end if;
        -- <=10000 ordinary decisions. At capacity each existing ALLOW can still
        -- be withdrawn once: <=10000 extra rows, <=20000 total, no repeatgrowth.
        if withdrawal and (prior.id is null or prior.policy->>'decision' is distinct from 'ALLOW') then raise exception 'NR:RESOURCE_LIMIT_EXCEEDED';end if;
        insert into public.finding_serving_rights(workspace_id,version_id,original_hash,action,actor_id,policy,intent_hash,capacity_withdrawal)
          values(ws,(selected->>'version_id')::uuid,selected->>'original_hash',p_action,actor,policy,digest,withdrawal) returning id into inserted_id;
        ids=ids||jsonb_build_array(inserted_id);
      end loop;
      confirmation=jsonb_build_object('schema_version','finding-serving-rights-confirmation/1','finding_id',p_finding,'finding_revision',p_revision,
        'action',p_action,'actor_id',actor,'review_ids',ids,'serialization','OBLIGATION_SERVING_INTENT_UTF8/1','intent_hash',digest);
      insert into public.workbench_mutations(workspace_id,actor_id,operation,idempotency_key,payload_hash,response)
        values(ws,actor,'finding.serving-rights.'||p_action,p_key,digest,confirmation);
      insert into public.audit_events(workspace_id,user_id,action,resource_type,resource_id,metadata)
        values(ws,actor,'finding.serving-rights','finding',p_finding::text,jsonb_build_object('revision',p_revision,'action',p_action,'review_ids',ids));
    end if;
  end if;
  return public.nexus_finding_serving_rights_view(p_context,p_finding,p_action)||jsonb_build_object('confirmed_review',confirmation);
end;$$;

create function public.nexus_obligation_evidence(p_context jsonb,p_operation text,p_action text,p_finding uuid default null,
  p_revision bigint default null,p_limit integer default 20,p_after uuid default null)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare ws uuid=(p_context->>'workspace_id')::uuid; actor uuid=(p_context->>'user_id')::uuid; f public.findings%rowtype;
  o public.obligation_evidence_origins%rowtype; r public.research_runs%rowtype; item record; rights jsonb; source_state text;
  review_state text; rights_state text; state text; items jsonb='[]'; result jsonb; projected jsonb; tail uuid;
begin
  if p_action is null or p_action not in('SERVE_API','SERVE_MCP') or p_operation is null or p_operation not in('list','read')
    or p_limit is null or p_limit not between 1 and 50 then raise exception 'NR:INVALID_SCOPE';end if;perform public.workbench_authorize(p_context,'read');
  if p_operation='list' then
    if p_finding is not null or p_revision is not null then raise exception 'NR:INVALID_SCOPE';end if;
    if p_after is not null then perform public.nexus_obligation_access(p_context,p_after);end if;
    for item in select f0.* from public.findings f0 join public.obligation_evidence_origins origin on origin.workspace_id=f0.workspace_id and origin.finding_id=f0.id
      where f0.workspace_id=ws and f0.deleted_at is null and (f0.owner_id=actor or exists(select 1 from public.finding_participants
        where workspace_id=ws and finding_id=f0.id and user_id=actor)) and (p_after is null or f0.id>p_after) order by f0.id limit p_limit+1 loop
      if jsonb_array_length(items)=p_limit then tail=(items->(p_limit-1)->>'finding_id')::uuid;exit;end if;
      rights=public.nexus_obligation_rights_summary(p_context,item.id,p_action);source_state=rights->>'source_state';
      review_state=public.nexus_obligation_review_state(ws,item.id,item.revision);rights_state=case when rights->>'eligible'='true' then 'ALLOWED' else 'RIGHTS_BLOCKED' end;
      state=case when source_state<>'CURRENT' then 'SOURCE_UNAVAILABLE' when review_state<>'APPROVED' then 'REVIEW_REQUIRED' when rights_state<>'ALLOWED' then 'RIGHTS_BLOCKED' else 'READY' end;
      select * into o from public.obligation_evidence_origins where finding_id=item.id and workspace_id=ws;
      items=items||jsonb_build_array(jsonb_build_object('finding_id',item.id,'revision',item.revision,'run_id',o.run_id,'result_index',o.result_index,
        'created_at',item.created_at,'updated_at',item.updated_at,'state',state,'source_state',source_state,'review_state',review_state,'rights_state',rights_state));
    end loop;
    return jsonb_build_object('schema_version','obligation-evidence-list/1','workspace_id',ws,'action',p_action,'items',items,'next_after',tail);
  end if;
  if p_finding is null or p_revision is null or p_revision not between 1 and 9007199254740991 or p_after is not null then raise exception 'NR:INVALID_SCOPE';end if;
  perform 1 from public.workspaces where id=ws for update;f=public.nexus_obligation_access(p_context,p_finding);
  if f.revision<>p_revision then raise exception 'NR:VERSION_CONFLICT';end if;
  select * into o from public.obligation_evidence_origins where finding_id=p_finding and workspace_id=ws;
  rights=public.nexus_obligation_rights_summary(p_context,p_finding,p_action);source_state=rights->>'source_state';
  review_state=public.nexus_obligation_review_state(ws,p_finding,p_revision);rights_state=case when rights->>'eligible'='true' then 'ALLOWED' else 'RIGHTS_BLOCKED' end;
  if source_state='CURRENT' and review_state='APPROVED' and rights_state='ALLOWED' then
    select results into r.results from public.research_runs where workspace_id=ws and id=o.run_id;
    if r.results->o.result_index->'obligations'->>'schema_version' is distinct from 'research-obligations/1' or octet_length((r.results->o.result_index)::text)>1000000
      then source_state='UNAVAILABLE_OR_CHANGED';else projected=public.nexus_research_finding_view(p_context,p_finding);end if;
    if projected->>'source_unavailable' is distinct from 'false' then source_state='UNAVAILABLE_OR_CHANGED';end if;
    if source_state='CURRENT' then
      -- Source lifecycle can erase a shared policy batch without locking this
      -- workspace. Derive the final state AND published rights from one final
      -- current view after projection; never publish READY with an erased head.
      rights=public.nexus_finding_serving_rights_view(p_context,p_finding,p_action);
      if rights->>'source_state'<>'CURRENT' then source_state='UNAVAILABLE_OR_CHANGED';end if;
      rights_state=case when rights->>'eligible'='true' then 'ALLOWED' else 'RIGHTS_BLOCKED' end;
    end if;
  end if;
  state=case when source_state<>'CURRENT' then 'SOURCE_UNAVAILABLE' when review_state<>'APPROVED' then 'REVIEW_REQUIRED' when rights_state<>'ALLOWED' then 'RIGHTS_BLOCKED' else 'READY' end;
  result=jsonb_build_object('schema_version','obligation-evidence-detail/1','workspace_id',ws,'action',p_action,'finding_id',p_finding,'revision',f.revision,
    'run_id',o.run_id,'result_index',o.result_index,'created_at',f.created_at,'updated_at',f.updated_at,'state',state,'source_state',source_state,'review_state',review_state,
    'rights_state',rights_state,'title',null,'result',null,'source_snapshot',null,'evidence','[]'::jsonb,'reviews','[]'::jsonb,'rights','[]'::jsonb,'interpretation','REVIEW_REQUIRED_NO_LEGAL_CERTIFICATION');
  if state='READY' then
    select source_snapshot into r.source_snapshot from public.research_runs where workspace_id=ws and id=o.run_id;
    result=result||jsonb_build_object('title',f.title,'result',r.results->o.result_index,'source_snapshot',r.source_snapshot,
      'evidence',projected->'evidence','reviews',projected->'reviews','rights',rights->'items');
  end if;
  return result;
end;$$;

revoke all on function public.nexus_capture_obligation_origin(),public.nexus_removed_document_serving_reviews(),public.nexus_removed_version_serving_reviews(),
  public.nexus_serving_intent_frame(text),public.nexus_serving_intent_hash(uuid,bigint,text,uuid,jsonb),public.nexus_obligation_evidence_contract(),
  public.nexus_obligation_access(jsonb,uuid),public.nexus_obligation_source_metadata(jsonb,uuid),public.nexus_obligation_review_state(uuid,uuid,bigint),
  public.nexus_serving_right_state(boolean,uuid,jsonb,text,text),public.nexus_obligation_rights_summary(jsonb,uuid,text),public.nexus_finding_serving_rights_view(jsonb,uuid,text),
  public.nexus_finding_serving_rights(jsonb,text,uuid,text,jsonb,bigint,text),public.nexus_obligation_evidence(jsonb,text,text,uuid,bigint,integer,uuid) from public,anon,authenticated;
grant execute on function public.nexus_capture_obligation_origin(),public.nexus_removed_document_serving_reviews(),public.nexus_removed_version_serving_reviews(),
  public.nexus_serving_intent_frame(text),public.nexus_serving_intent_hash(uuid,bigint,text,uuid,jsonb),public.nexus_obligation_evidence_contract(),
  public.nexus_obligation_access(jsonb,uuid),public.nexus_obligation_source_metadata(jsonb,uuid),public.nexus_obligation_review_state(uuid,uuid,bigint),
  public.nexus_serving_right_state(boolean,uuid,jsonb,text,text),public.nexus_obligation_rights_summary(jsonb,uuid,text),public.nexus_finding_serving_rights_view(jsonb,uuid,text),
  public.nexus_finding_serving_rights(jsonb,text,uuid,text,jsonb,bigint,text),public.nexus_obligation_evidence(jsonb,text,text,uuid,bigint,integer,uuid) to service_role;
