-- Private-upload rights are version-specific workspace decisions, not provider enablement.
create table public.finding_export_rights (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  version_id uuid not null,
  original_hash text not null check(original_hash ~ '^[a-f0-9]{64}$'),
  actor_id uuid not null,
  policy jsonb not null check(jsonb_typeof(policy)='object' and octet_length(policy::text)<=8192),
  created_at timestamptz not null default clock_timestamp(),
  foreign key(workspace_id,version_id) references public.document_versions(workspace_id,id) on delete cascade
);
create index finding_export_rights_version on public.finding_export_rights(workspace_id,version_id,created_at desc,id desc);
create table public.finding_packages (
  id uuid primary key references public.evidence_exports(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  finding_id uuid not null references public.findings(id) on delete cascade,
  finding_revision bigint not null check(finding_revision>=1),
  serialization text not null default 'POSTGRES_JSONB_TEXT_UTF8/1' check(serialization='POSTGRES_JSONB_TEXT_UTF8/1'),
  manifest_bytes integer not null check(manifest_bytes between 1 and 33554432),
  component_version text,
  component_digest text,
  check((component_version is null and component_digest is null) or
    (component_version is not null and length(component_version) between 1 and 64
      and component_digest is not null and component_digest ~ '^[a-f0-9]{64}$'))
);
create index finding_packages_page on public.finding_packages(workspace_id,finding_id,id);
alter table public.finding_export_rights enable row level security;
alter table public.finding_packages enable row level security;
revoke all on public.finding_export_rights,public.finding_packages from public,anon,authenticated;
grant all on public.finding_export_rights,public.finding_packages to service_role;

create function public.nexus_finding_export_sources(p_context jsonb,p_finding uuid)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare f jsonb; sources jsonb; ws uuid=(p_context->>'workspace_id')::uuid; count_versions integer;
begin
  f=public.nexus_research_finding_view(p_context,p_finding);
  if f->>'source_unavailable'='true' then raise exception 'NR:SOURCE_UNAVAILABLE';end if;
  if coalesce(jsonb_array_length(f->'evidence'),0)=0 then raise exception 'NR:RIGHTS_BLOCKED';end if;
  if exists(select 1 from jsonb_array_elements(f->'evidence') e where e->>'available' is distinct from 'true'
    or e->>'version_id' is null) then raise exception 'NR:SOURCE_UNAVAILABLE';end if;
  select count(distinct e->>'version_id') into count_versions from jsonb_array_elements(f->'evidence') e;
  if count_versions>60 then raise exception 'NR:RESOURCE_LIMIT_EXCEEDED';end if;
  select coalesce(jsonb_agg(jsonb_build_object('version_id',v.id,'document_id',d.id,'filename',d.filename,
    'original_hash',v.original_hash,'lifecycle_epoch',v.lifecycle_epoch,'index_generation',v.index_generation) order by v.id),'[]') into sources
  from public.document_versions v join public.documents d on d.workspace_id=v.workspace_id and d.id=v.document_id
  where v.workspace_id=ws and exists(select 1 from jsonb_array_elements(f->'evidence') e where e->>'version_id'=v.id::text
    and e->>'document_id'=d.id::text) and v.publication_state='ready' and d.lifecycle_state='active'
    and d.active_version_id=v.id and d.lifecycle_epoch=v.lifecycle_epoch and v.original_verified_at is not null;
  if jsonb_array_length(sources)<>count_versions then raise exception 'NR:SOURCE_UNAVAILABLE';end if;
  return sources;
end;$$;

create function public.nexus_finding_export_rights(
  p_context jsonb,p_operation text,p_finding uuid,p_command jsonb default '{}',p_revision bigint default null,p_key text default null
) returns jsonb language plpgsql security invoker set search_path=public,pg_temp set timezone='UTC' as $$
declare ws uuid=(p_context->>'workspace_id')::uuid; actor uuid=(p_context->>'user_id')::uuid;
  f jsonb; sources jsonb; items jsonb; selected jsonb; policy jsonb; role_name text; prior uuid; digest text;
  mutation public.workbench_mutations%rowtype; decision public.finding_export_rights%rowtype; ids jsonb='[]';
begin
  perform 1 from public.workspaces where id=ws for update;
  perform public.workbench_authorize(p_context,'read');
  f=public.nexus_research_finding_view(p_context,p_finding);
  sources=public.nexus_finding_export_sources(p_context,p_finding);
  select role into role_name from public.workspace_members where workspace_id=ws and user_id=actor;
  if p_operation='record' then
    if role_name is null or role_name not in('owner','admin') then raise exception 'NR:FORBIDDEN';end if;
    if p_revision is null or p_revision<>(f->>'revision')::bigint then raise exception 'NR:VERSION_CONFLICT';end if;
    if p_key is null or length(p_key) not between 1 and 128 or jsonb_typeof(p_command->'selections') is distinct from 'array'
      or jsonb_array_length(p_command->'selections') not between 1 and 60 then raise exception 'NR:INVALID_SCOPE';end if;
    policy=p_command->'policy';
    if jsonb_typeof(policy) is distinct from 'object' or octet_length(policy::text)>8192
      or coalesce(policy->>'decision','') not in('ALLOW','DENY','REVIEW_REQUIRED','REVOKED')
      or coalesce(policy->>'basis','') not in('OWNED_CONTENT','LICENSE','PERMISSION','PUBLIC_DOMAIN','UNKNOWN')
      or coalesce(length(btrim(policy->>'rationale')),0) not between 1 and 2000
      or jsonb_typeof(policy->'evidence_reference') is distinct from 'string' or length(policy->>'evidence_reference')>2000
      or jsonb_typeof(policy->'attribution') is distinct from 'string' or length(policy->>'attribution')>4000
      or jsonb_typeof(policy->'duties') is distinct from 'array' or jsonb_array_length(policy->'duties')>10
      or exists(select 1 from jsonb_array_elements(policy->'duties') d where jsonb_typeof(d)<>'string' or length(btrim(d#>>'{}')) not between 1 and 500)
      then raise exception 'NR:INVALID_SCOPE';end if;
    if policy->>'decision'='ALLOW' and (policy->>'basis'='UNKNOWN' or length(btrim(policy->>'evidence_reference'))=0
      or length(btrim(policy->>'attribution'))=0 or policy->>'review_by' is null
      or (policy->>'review_by')::timestamptz<=clock_timestamp()) then raise exception 'NR:INVALID_SCOPE';end if;
    if policy->>'review_by' is not null then perform (policy->>'review_by')::timestamptz;end if;
    digest=encode(sha256(convert_to(jsonb_build_object('finding',p_finding,'revision',p_revision,'command',p_command)::text,'UTF8')),'hex');
    select * into mutation from public.workbench_mutations where workspace_id=ws and actor_id=actor and operation='finding.export-rights' and idempotency_key=p_key;
    if found then
      if mutation.payload_hash<>digest then raise exception 'NR:VERSION_CONFLICT';end if;
      ids=mutation.response->'review_ids';
      if exists(select 1 from jsonb_array_elements_text(ids) saved(id) where not exists(
        select 1 from public.finding_export_rights r where r.id=saved.id::uuid and r.workspace_id=ws
        and r.id=(select latest.id from public.finding_export_rights latest where latest.workspace_id=ws and latest.version_id=r.version_id order by latest.created_at desc,latest.id desc limit 1)))
        then raise exception 'NR:VERSION_CONFLICT';end if;
    else
      if (select count(distinct s->>'version_id') from jsonb_array_elements(p_command->'selections') s)<>jsonb_array_length(p_command->'selections') then raise exception 'NR:INVALID_SCOPE';end if;
      for selected in select value from jsonb_array_elements(p_command->'selections') loop
        if not exists(select 1 from jsonb_array_elements(sources) s where s->>'version_id'=selected->>'version_id') then raise exception 'NR:VERSION_CONFLICT';end if;
        select id into prior from public.finding_export_rights where workspace_id=ws and version_id=(selected->>'version_id')::uuid order by created_at desc,id desc limit 1;
        if prior is distinct from (selected->>'expected_review_id')::uuid then raise exception 'NR:VERSION_CONFLICT';end if;
        insert into public.finding_export_rights(workspace_id,version_id,original_hash,actor_id,policy)
          select ws,(s->>'version_id')::uuid,s->>'original_hash',actor,policy from jsonb_array_elements(sources) s where s->>'version_id'=selected->>'version_id'
          returning * into decision;
        ids=ids||jsonb_build_array(decision.id);
      end loop;
      insert into public.workbench_mutations(workspace_id,actor_id,operation,idempotency_key,payload_hash,response)
        values(ws,actor,'finding.export-rights',p_key,digest,jsonb_build_object('review_ids',ids));
      insert into public.audit_events(workspace_id,user_id,action,resource_type,resource_id,metadata)
        values(ws,actor,'finding.export-rights','finding',p_finding::text,jsonb_build_object('revision',p_revision,'review_ids',ids));
    end if;
  elsif p_operation<>'read' then raise exception 'NR:INVALID_SCOPE';end if;
  select coalesce(jsonb_agg(s||jsonb_build_object('review_id',r.id,'actor_id',r.actor_id,'created_at',r.created_at,'policy',r.policy,
    'allowed',coalesce(r.policy->>'decision'='ALLOW' and r.policy->>'basis'<>'UNKNOWN' and r.original_hash=s->>'original_hash'
      and (r.policy->>'review_by')::timestamptz>clock_timestamp(),false)) order by s->>'version_id'),'[]') into items
    from jsonb_array_elements(sources) s left join lateral(select * from public.finding_export_rights x where x.workspace_id=ws
      and x.version_id=(s->>'version_id')::uuid order by x.created_at desc,x.id desc limit 1) r on true;
  return jsonb_build_object('schema_version','finding-export-rights/1','finding_id',p_finding,'revision',f->'revision',
    'can_review',role_name in('owner','admin'),'items',items,'eligible',not exists(select 1 from jsonb_array_elements(items) i where i->>'allowed'<>'true'),
    'reason',case when exists(select 1 from jsonb_array_elements(items) i where i->>'allowed'<>'true') then 'RIGHTS_REVIEW_REQUIRED' else 'ALLOW' end);
end;$$;

create function public.nexus_finding_package_common(p_context jsonb,p_finding uuid)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp set timezone='UTC' as $$
declare f jsonb; rights jsonb; sources jsonb; source_graph jsonb;
  answer jsonb; manifest jsonb; ws uuid=(p_context->>'workspace_id')::uuid; run_activity jsonb;
begin
  f=public.nexus_research_finding_view(p_context,p_finding);
  rights=public.nexus_finding_export_rights(p_context,'read',p_finding);
  if rights->>'eligible'<>'true' then raise exception 'NR:RIGHTS_BLOCKED';end if;
  select coalesce(jsonb_agg(jsonb_build_object('@id','urn:nexusrag:version:'||(i->>'version_id'),'@type','prov:Entity',
    'version_id',i->'version_id','document_id',i->'document_id','original_hash',i->'original_hash','filename',i->'filename',
    'rights',i->'policy','rights_review_id',i->'review_id','rights_reviewer_id',i->'actor_id','rights_reviewed_at',i->'created_at') order by i->>'version_id'),'[]')
    into source_graph from jsonb_array_elements(rights->'items') i;
  select coalesce(jsonb_agg(jsonb_build_object('@id','urn:nexusrag:version:'||(i->>'version_id')) order by i->>'version_id'),'[]')
    into sources from jsonb_array_elements(rights->'items') i;
  if f->>'source_research_run_id' is not null then
    select results->(f->>'source_research_position')::integer into answer from public.research_runs where workspace_id=ws and id=(f->>'source_research_run_id')::uuid;
    run_activity=jsonb_build_object('@id','urn:nexusrag:research-run:'||(f->>'source_research_run_id'),'@type','prov:Activity',
      'result_index',f->'source_research_position','prov:used',sources);
    source_graph=source_graph||jsonb_build_array(run_activity);
  end if;
  manifest=jsonb_build_object('@context',jsonb_build_object('@version',1.1,'@vocab','https://nexusrag.app/ns/',
      'prov','http://www.w3.org/ns/prov#','analysis',jsonb_build_object('@id','https://nexusrag.app/ns/analysis','@type','@json'),
      'evidence',jsonb_build_object('@id','https://nexusrag.app/ns/evidence','@type','@json'),
      'reviews',jsonb_build_object('@id','https://nexusrag.app/ns/reviews','@type','@json'),
      'rights',jsonb_build_object('@id','https://nexusrag.app/ns/rights','@type','@json')),
    '@type','prov:Entity','format','nexusrag-finding-package/1','workspace_id',ws,'finding_id',p_finding,
    'analysis',coalesce(answer,'null'::jsonb),'evidence',f->'evidence',
    'claim_state','HUMAN_REVIEWED_NOT_CERTIFICATION','prov:wasDerivedFrom',sources,'@included',source_graph);
  if run_activity is not null then manifest=manifest||jsonb_build_object('prov:wasGeneratedBy',jsonb_build_object('@id',run_activity->>'@id'));end if;
  return manifest;
end;$$;

create function public.nexus_finding_package_revision(p_context jsonb,p_finding uuid,p_revision bigint)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp set timezone='UTC' as $$
declare v public.finding_versions%rowtype; reviews jsonb; ws uuid=(p_context->>'workspace_id')::uuid;
begin
  -- Retain the existing record read authority, including current context/deadline.
  perform public.workbench_finding(p_context,'read',p_finding,'{}',null,null,null);
  select * into v from public.finding_versions where workspace_id=ws and finding_id=p_finding and revision=p_revision and redacted_at is null;
  if not found then raise exception 'NR:SOURCE_UNAVAILABLE';end if;
  if not exists(select 1 from public.finding_reviews r where r.workspace_id=ws and r.finding_id=p_finding and r.revision=p_revision
    and r.reviewer_id<>v.author_id and r.decision='approved')
    or exists(select 1 from public.finding_reviews r where r.workspace_id=ws and r.finding_id=p_finding and r.revision=p_revision and r.decision='changes_requested')
    then raise exception 'NR:REVIEW_REQUIRED';end if;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.reviewer_id),'[]') into reviews from public.finding_reviews r
    where r.workspace_id=ws and r.finding_id=p_finding and r.revision=p_revision;
  return jsonb_build_object('@id','urn:nexusrag:finding:'||p_finding::text||':'||p_revision::text,
    'revision',p_revision,'title',v.title,'authored_markdown',v.authored_markdown,'generated_markdown',v.generated_markdown,
    'author_id',v.author_id,'created_at',v.created_at,'reviews',reviews);
end;$$;

-- Reference compaction retains every actual field/order except the large raw
-- quotation. It binds that exact UTF8 content through its digest and byte count;
-- no reference manifest or duplicate quote is stored in a package row.
create function public.nexus_finding_package_reference(p_manifest jsonb)
returns jsonb language sql immutable strict security invoker set search_path=public,pg_temp as $$
  select jsonb_set(p_manifest,'{evidence}',coalesce((select jsonb_agg(
    case when jsonb_typeof(item->'original_text')='string' then (item-'original_text')||jsonb_build_object(
      'original_text_sha256',encode(sha256(convert_to(item->>'original_text','UTF8')),'hex'),
      'original_text_bytes',octet_length(item->>'original_text')) else item end order by ordinal)
    from jsonb_array_elements(p_manifest->'evidence') with ordinality quoted(item,ordinal)),'[]'::jsonb));
$$;

create function public.nexus_finding_package_component_digest(
  p_reference_hash text,p_manifest_hash text,p_manifest_bytes integer,p_serialization text,p_revision bigint
) returns text language sql immutable strict security invoker set search_path=public,pg_temp as $$
  select encode(sha256(convert_to(jsonb_build_object('format','FINDING_COMPONENTS_UTF8/1',
    'reference',p_reference_hash,'manifest_hash',p_manifest_hash,
    'manifest_bytes',p_manifest_bytes,'serialization',p_serialization,'finding_revision',p_revision)::text,'UTF8')),'hex');
$$;

create function public.nexus_finding_package_manifest(p_context jsonb,p_finding uuid,p_revision bigint)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp set timezone='UTC' as $$
declare manifest jsonb;
begin
  manifest=public.nexus_finding_package_common(p_context,p_finding)||public.nexus_finding_package_revision(p_context,p_finding,p_revision);
  if octet_length(manifest::text)>33554432 then raise exception 'NR:RESOURCE_LIMIT_EXCEEDED';end if;
  return manifest;
end;$$;

create function public.nexus_finding_package_view(p_context jsonb,p_id uuid)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp set timezone='UTC' as $$
declare p public.finding_packages%rowtype;e public.evidence_exports%rowtype; manifest_text text; reason text=null; answer jsonb;
begin
  select * into p from public.finding_packages where workspace_id=(p_context->>'workspace_id')::uuid and id=p_id;
  if not found then raise exception 'NR:NOT_FOUND';end if;
  perform public.nexus_research_finding_view(p_context,p.finding_id);
  select * into strict e from public.evidence_exports where workspace_id=p.workspace_id and id=p.id;
  if e.state<>'ready' or e.expires_at<=clock_timestamp() then reason='EXPIRED';
  else
    begin
      manifest_text=public.nexus_finding_package_manifest(p_context,p.finding_id,p.finding_revision)::text;
      if encode(sha256(convert_to(manifest_text,'UTF8')),'hex')<>e.manifest_hash or octet_length(manifest_text)<>p.manifest_bytes then reason='COMPONENT_CHANGED';end if;
    exception when others then
      if sqlerrm in('NR:RIGHTS_BLOCKED','NR:SOURCE_UNAVAILABLE','NR:REVIEW_REQUIRED') then reason=substring(sqlerrm,4);else raise;end if;
    end;
  end if;
  answer=jsonb_build_object('schema_version','finding-package/1','id',p.id,'workspace_id',p.workspace_id,'finding_id',p.finding_id,
    'finding_revision',p.finding_revision,'serialization',p.serialization,'manifest_hash',e.manifest_hash,'manifest_bytes',p.manifest_bytes,
    'created_at',e.created_at,'requested_by',e.requested_by,'state',case when reason is null then 'ready' else 'expired' end,
    'reason',reason,'manifest_text',case when reason is null then manifest_text end);
  return answer;
end;$$;

create function public.nexus_finding_package(
  p_context jsonb,p_operation text,p_finding uuid,p_id uuid default null,p_revision bigint default null,
  p_key text default null,p_limit integer default 20,p_after uuid default null
) returns jsonb language plpgsql security invoker set search_path=public,pg_temp set timezone='UTC' as $$
declare ws uuid=(p_context->>'workspace_id')::uuid; actor uuid=(p_context->>'user_id')::uuid; role_name text;
  f jsonb; manifest_text text; digest text; intent text; mutation public.workbench_mutations%rowtype; saved public.evidence_exports%rowtype;
  ids uuid[]; items jsonb='[]'; pid uuid; receipt_only boolean=p_operation='create_receipt'; result jsonb;
  package_row public.finding_packages%rowtype; components jsonb='{}'; component jsonb; component_key text;
  source_manifest jsonb; rights_expire_at timestamptz; reason text; reference_hash text;
  common_loaded boolean=false; common_reference jsonb; common_reason text; revision_reference jsonb;
begin
  perform 1 from public.workspaces where id=ws for update;
  perform public.workbench_authorize(p_context,'read');
  f=public.nexus_research_finding_view(p_context,p_finding);
  if p_operation in('create','create_receipt') then
    select role into role_name from public.workspace_members where workspace_id=ws and user_id=actor;
    if role_name is null or role_name not in('owner','admin','editor') then raise exception 'NR:FORBIDDEN';end if;
    if p_revision is null or p_revision<>(f->>'revision')::bigint then raise exception 'NR:VERSION_CONFLICT';end if;
    if p_key is null or length(p_key) not between 1 and 128 then raise exception 'NR:INVALID_SCOPE';end if;
    intent=encode(sha256(convert_to(jsonb_build_object('finding',p_finding,'revision',p_revision)::text,'UTF8')),'hex');
    select * into mutation from public.workbench_mutations where workspace_id=ws and actor_id=actor and operation='finding.package' and idempotency_key=p_key;
    if found then
      if mutation.payload_hash<>intent then raise exception 'NR:VERSION_CONFLICT';end if;
      result=public.nexus_finding_package_view(p_context,(mutation.response->>'id')::uuid);
      if receipt_only then return (result-'manifest_text')||jsonb_build_object('schema_version','finding-package-receipt/1');end if;
      return result;
    end if;
    source_manifest=public.nexus_finding_package_manifest(p_context,p_finding,p_revision);
    manifest_text=source_manifest::text;
    digest=encode(sha256(convert_to(manifest_text,'UTF8')),'hex');
    reference_hash=encode(sha256(convert_to(public.nexus_finding_package_reference(source_manifest)::text,'UTF8')),'hex');
    select e.* into saved from public.finding_packages p join public.evidence_exports e on e.workspace_id=p.workspace_id and e.id=p.id
      where p.workspace_id=ws and p.finding_id=p_finding and p.finding_revision=p_revision and e.requested_by=actor
        and e.manifest_hash=digest and e.state='ready' and (e.expires_at is null or e.expires_at>clock_timestamp()) order by e.id limit 1;
    if not found then
      -- Capacity does not disable reuse/read/download of already durable packages.
      if (select count(*) from public.finding_packages where workspace_id=ws)>=1000 then raise exception 'NR:RESOURCE_LIMIT_EXCEEDED';end if;
      insert into public.evidence_exports(workspace_id,requested_by,format,state,manifest_hash)
        values(ws,actor,'JSON_LD','ready',digest) returning * into saved;
      insert into public.finding_packages(id,workspace_id,finding_id,finding_revision,manifest_bytes,component_version,component_digest)
        values(saved.id,ws,p_finding,p_revision,octet_length(manifest_text),'FINDING_COMPONENTS_UTF8/1',
          public.nexus_finding_package_component_digest(reference_hash,digest,octet_length(manifest_text),'POSTGRES_JSONB_TEXT_UTF8/1',p_revision));
      insert into public.audit_events(workspace_id,user_id,action,resource_type,resource_id,metadata)
        values(ws,actor,'finding.package','finding',p_finding::text,jsonb_build_object('revision',p_revision,'manifest_hash',digest,'export_id',saved.id));
    end if;
    insert into public.workbench_mutations(workspace_id,actor_id,operation,idempotency_key,payload_hash,response)
      values(ws,actor,'finding.package',p_key,intent,jsonb_build_object('id',saved.id));
    result=public.nexus_finding_package_view(p_context,saved.id);
    if receipt_only then return (result-'manifest_text')||jsonb_build_object('schema_version','finding-package-receipt/1');end if;
    return result;
  elsif p_operation='read' then
    if not exists(select 1 from public.finding_packages where workspace_id=ws and finding_id=p_finding and id=p_id) then raise exception 'NR:NOT_FOUND';end if;
    return public.nexus_finding_package_view(p_context,p_id);
  elsif p_operation='list' then
    if p_limit is null or p_limit not between 1 and 50 then raise exception 'NR:INVALID_SCOPE';end if;
    select array_agg(id order by id) into ids from(select id from public.finding_packages where workspace_id=ws and finding_id=p_finding
      and (p_after is null or id>p_after) order by id limit p_limit+1) selected;
    foreach pid in array coalesce(ids[1:p_limit],'{}'::uuid[]) loop
      perform public.workbench_authorize(p_context,'read');
      select * into strict package_row from public.finding_packages where workspace_id=ws and id=pid;
      select * into strict saved from public.evidence_exports where workspace_id=ws and id=pid;
      reason=null;
      if saved.state<>'ready' or saved.expires_at<=clock_timestamp() then reason='EXPIRED';
      else
        -- New receipts bind the actual full manifest through a compact reference:
        -- every field/order is retained, with raw originals bound by SHA256 and
        -- UTF8 byte count. Build and hash common originals once for the page;
        -- never serialize a full 32MiB artifact for each historical revision.
        -- Unknown/legacy receipts retain authoritative full verification.
        component_key=(case when package_row.component_version='FINDING_COMPONENTS_UTF8/1'
          then 'reference:' else 'full:' end)||package_row.finding_revision::text;
        if not (components ? component_key) then
          begin
            if package_row.component_version='FINDING_COMPONENTS_UTF8/1' then
              if not common_loaded then
                begin
                  source_manifest=public.nexus_finding_package_common(p_context,p_finding);
                  select min((entry->'rights'->>'review_by')::timestamptz) into rights_expire_at
                    from jsonb_array_elements(source_manifest->'@included') entry where entry ? 'rights';
                  common_reference=public.nexus_finding_package_reference(source_manifest);
                exception when others then
                  if sqlerrm in('NR:RIGHTS_BLOCKED','NR:SOURCE_UNAVAILABLE','NR:REVIEW_REQUIRED')
                    then common_reason=substring(sqlerrm,4);else raise;end if;
                end;
                common_loaded=true;
                source_manifest=null;
              end if;
              if common_reason is not null then component=jsonb_build_object('reason',common_reason);
              else
                revision_reference=public.nexus_finding_package_revision(p_context,p_finding,package_row.finding_revision);
                reference_hash=encode(sha256(convert_to((common_reference||revision_reference)::text,'UTF8')),'hex');
                component=jsonb_build_object('reference_hash',reference_hash,'rights_expire_at',rights_expire_at);
              end if;
            else
              source_manifest=public.nexus_finding_package_manifest(p_context,p_finding,package_row.finding_revision);
              manifest_text=source_manifest::text;
              select min((entry->'rights'->>'review_by')::timestamptz) into rights_expire_at
                from jsonb_array_elements(source_manifest->'@included') entry where entry ? 'rights';
              component=jsonb_build_object('hash',encode(sha256(convert_to(manifest_text,'UTF8')),'hex'),
                'bytes',octet_length(manifest_text),'rights_expire_at',rights_expire_at);
            end if;
          exception when others then
            if sqlerrm in('NR:RIGHTS_BLOCKED','NR:SOURCE_UNAVAILABLE','NR:REVIEW_REQUIRED')
              then component=jsonb_build_object('reason',substring(sqlerrm,4));else raise;end if;
          end;
          components=components||jsonb_build_object(component_key,component);
          source_manifest=null;manifest_text=null;
        end if;
        component=components->component_key;
        reason=component->>'reason';
        if reason is null then
          if (component->>'rights_expire_at')::timestamptz<=clock_timestamp() then reason='RIGHTS_BLOCKED';
          elsif package_row.component_version='FINDING_COMPONENTS_UTF8/1' then
            if public.nexus_finding_package_component_digest(component->>'reference_hash',saved.manifest_hash,
              package_row.manifest_bytes,package_row.serialization,package_row.finding_revision) is distinct from package_row.component_digest
              then reason='COMPONENT_CHANGED';end if;
          elsif component->>'hash'<>saved.manifest_hash or (component->>'bytes')::integer<>package_row.manifest_bytes
            then reason='COMPONENT_CHANGED';end if;
        end if;
      end if;
      items=items||jsonb_build_array(jsonb_build_object('schema_version','finding-package/1','id',pid,'workspace_id',ws,
        'finding_id',p_finding,'finding_revision',package_row.finding_revision,'serialization',package_row.serialization,
        'manifest_hash',saved.manifest_hash,'manifest_bytes',package_row.manifest_bytes,'created_at',saved.created_at,
        'requested_by',saved.requested_by,'state',case when reason is null then 'ready' else 'expired' end,'reason',reason));
    end loop;
    return jsonb_build_object('schema_version','finding-package-list/1','items',items,'next_after',case when cardinality(ids)>p_limit then ids[p_limit] end);
  else raise exception 'NR:INVALID_SCOPE';end if;
end;$$;

create function public.nexus_removed_document_export_reviews()
returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
begin
  if tg_op='DELETE' or new.lifecycle_state<>'active' then
    delete from public.finding_export_rights r using public.document_versions v
      where r.workspace_id=old.workspace_id and r.version_id=v.id and v.workspace_id=old.workspace_id and v.document_id=old.id;
  end if;
  if tg_op='DELETE' then return old;else return new;end if;
end;$$;
create trigger removed_document_export_reviews before delete or update of lifecycle_state on public.documents
  for each row execute function public.nexus_removed_document_export_reviews();

revoke all on function public.nexus_finding_export_sources(jsonb,uuid),public.nexus_finding_export_rights(jsonb,text,uuid,jsonb,bigint,text),
  public.nexus_finding_package_common(jsonb,uuid),public.nexus_finding_package_revision(jsonb,uuid,bigint),
  public.nexus_finding_package_reference(jsonb),public.nexus_finding_package_component_digest(text,text,integer,text,bigint),
  public.nexus_finding_package_manifest(jsonb,uuid,bigint),public.nexus_finding_package_view(jsonb,uuid),
  public.nexus_finding_package(jsonb,text,uuid,uuid,bigint,text,integer,uuid),public.nexus_removed_document_export_reviews() from public,anon,authenticated;
grant execute on function public.nexus_finding_export_sources(jsonb,uuid),public.nexus_finding_export_rights(jsonb,text,uuid,jsonb,bigint,text),
  public.nexus_finding_package_common(jsonb,uuid),public.nexus_finding_package_revision(jsonb,uuid,bigint),
  public.nexus_finding_package_reference(jsonb),public.nexus_finding_package_component_digest(text,text,integer,text,bigint),
  public.nexus_finding_package_manifest(jsonb,uuid,bigint),public.nexus_finding_package_view(jsonb,uuid),
  public.nexus_finding_package(jsonb,text,uuid,uuid,bigint,text,integer,uuid),public.nexus_removed_document_export_reviews() to service_role;
