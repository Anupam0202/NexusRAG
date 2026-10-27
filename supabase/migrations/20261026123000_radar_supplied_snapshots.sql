-- Workspace-supplied, selected-evidence Radar. No fetching, AI, scheduling or
-- existing-provider policy updates are performed by this migration or its RPCs.
alter table public.monitors drop constraint monitors_retrieval_method_check;
alter table public.monitors add constraint monitors_retrieval_method_check check(retrieval_method in
  ('STATUS_API','CHANGELOG_FEED','RSS_ATOM','GIT_RELEASES','CONDITIONAL_HTTP','STATIC_HTML','BROWSER','SUPPLIED_DOCUMENT'));
alter table public.monitor_runs drop constraint monitor_runs_status_check;
alter table public.monitor_runs add constraint monitor_runs_status_check check(status in
  ('BASELINE','UNCHANGED','CHANGED','FAILED','RIGHTS_BLOCKED','QUOTA_EXHAUSTED','REVIEW_REQUIRED'));
alter table public.monitor_runs drop constraint monitor_runs_materiality_check;
alter table public.monitor_runs add constraint monitor_runs_materiality_check check(materiality is null or materiality in
  ('NONE','EDITORIAL','OPERATIONAL','RIGHTS_REVIEW','SECURITY_REVIEW','REVIEW_REQUIRED'));

create table public.radar_sources(
  id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id) on delete cascade,
  provider_id text not null references public.provider_registry(id),source_url text not null check(length(source_url) between 1 and 2000),
  title text not null check(length(btrim(title)) between 1 and 160),kind text not null check(kind in('TERMS','QUOTA','PRICING','SCHEMA','DEPRECATION','LICENCE','OTHER')),
  monitor_id uuid not null unique,created_by uuid not null,revision bigint not null default 0 check(revision>=0),
  latest_snapshot_id uuid,affected_workflows jsonb not null default '[]' check(jsonb_typeof(affected_workflows)='array'),
  created_at timestamptz not null default clock_timestamp(),unique(workspace_id,id),unique(workspace_id,provider_id,source_url),
  foreign key(workspace_id,monitor_id) references public.monitors(workspace_id,id) on delete cascade
);
create table public.radar_snapshots(
  id uuid primary key default gen_random_uuid(),workspace_id uuid not null,source_id uuid not null,revision bigint not null check(revision>=1),
  document_id uuid not null,version_id uuid not null,document_original_hash text not null check(document_original_hash~'^[a-f0-9]{64}$'),
  document_original_bytes bigint not null,selection_hash text not null check(selection_hash~'^[a-f0-9]{64}$'),
  normalized_hash text not null check(normalized_hash~'^[a-f0-9]{64}$'),chunk_ids jsonb not null,selections jsonb not null,
  comparison_scheme text not null default 'RADAR_SELECTED_CHUNKS_PYTHON_WHITESPACE_UTF8/1',
  selection_scheme text not null default 'RADAR_ORDERED_CHUNK_REFERENCES_JSONB_UTF8/1',
  selected_utf8_bytes integer not null check(selected_utf8_bytes between 1 and 5111808),stored_chunk_count integer not null,
  comparison_complete boolean not null,captured_at timestamptz not null,recorded_at timestamptz not null default clock_timestamp(),
  actor_id uuid not null,rights_rationale text not null,rights_receipts jsonb not null,change_id uuid not null,
  unique(workspace_id,id),unique(workspace_id,source_id,revision),
  foreign key(workspace_id,source_id) references public.radar_sources(workspace_id,id) on delete cascade,
  foreign key(workspace_id,version_id) references public.document_versions(workspace_id,id),
  check(jsonb_typeof(chunk_ids)='array' and jsonb_array_length(chunk_ids) between 1 and 156),
  check(jsonb_typeof(selections)='array' and jsonb_array_length(selections)=jsonb_array_length(chunk_ids))
);
create table public.radar_changes(
  id uuid primary key references public.monitor_runs(id) on delete cascade,workspace_id uuid not null,source_id uuid not null,
  before_snapshot_id uuid,after_snapshot_id uuid not null,previous_hash text,current_hash text not null,
  before_chunk_ids jsonb not null default '[]' check(jsonb_typeof(before_chunk_ids)='array' and jsonb_array_length(before_chunk_ids)<=156),previous_selection_hash text,current_selection_hash text not null,
  status text not null check(status in('BASELINE','UNCHANGED','CHANGED')),materiality text not null check(materiality in
    ('NONE','EDITORIAL','OPERATIONAL','RIGHTS_REVIEW','SECURITY_REVIEW','REVIEW_REQUIRED')),
  matched_signals jsonb not null default '[]',review_revision bigint not null default 0,created_at timestamptz not null default clock_timestamp(),
  unique(workspace_id,id),foreign key(workspace_id,source_id) references public.radar_sources(workspace_id,id) on delete cascade,
  foreign key(workspace_id,before_snapshot_id) references public.radar_snapshots(workspace_id,id),
  foreign key(workspace_id,after_snapshot_id) references public.radar_snapshots(workspace_id,id)
);
alter table public.radar_sources add foreign key(workspace_id,latest_snapshot_id) references public.radar_snapshots(workspace_id,id);
create table public.radar_reviews(
  id uuid primary key default gen_random_uuid(),workspace_id uuid not null,change_id uuid not null,revision bigint not null,
  reviewer_id uuid not null,decision text not null check(decision in('approved','changes_requested')),
  comment text not null check(length(comment)<=4000),affected_workflows jsonb not null default '[]',
  created_at timestamptz not null default clock_timestamp(),unique(workspace_id,change_id,revision),
  foreign key(workspace_id,change_id) references public.radar_changes(workspace_id,id) on delete cascade
);
create table public.radar_findings(
  finding_id uuid primary key references public.findings(id) on delete cascade,workspace_id uuid not null,change_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),source_review_revision bigint not null check(source_review_revision>=1),unique(workspace_id,change_id),
  foreign key(workspace_id,change_id) references public.radar_changes(workspace_id,id) on delete cascade
);
create index radar_sources_page on public.radar_sources(workspace_id,id);
create index radar_snapshots_page on public.radar_snapshots(workspace_id,source_id,id);
create index radar_reviews_change on public.radar_reviews(workspace_id,change_id,revision desc);
create index radar_reviews_reviewer on public.radar_reviews(workspace_id,change_id,reviewer_id,revision desc);
alter table public.radar_sources enable row level security;
alter table public.radar_snapshots enable row level security;
alter table public.radar_changes enable row level security;
alter table public.radar_reviews enable row level security;
alter table public.radar_findings enable row level security;
revoke all on public.radar_sources,public.radar_snapshots,public.radar_changes,public.radar_reviews,public.radar_findings from public,anon,authenticated;
grant all on public.radar_sources,public.radar_snapshots,public.radar_changes,public.radar_reviews,public.radar_findings to service_role;

create function public.nexus_radar_contract() returns jsonb language sql stable security invoker set search_path=public,pg_temp as $$
  select jsonb_build_object('schema_version','radar/1','source_mode','SUPPLIED_DOCUMENT','max_selected_originals',156,
    'materiality_projection_characters',65536,'coverage','SELECTED_CHUNKS_NOT_FULL_DOCUMENT','recurring',false,'fetch',false,'ai',false);
$$;
-- Match Python str.split/isspace; preserve the separately retained raw originals.
create function public.nexus_radar_normalize(p_text text) returns text language sql immutable strict security invoker set search_path=public,pg_temp as $$
  select btrim(regexp_replace(translate(p_text,
    chr(9)||chr(10)||chr(11)||chr(12)||chr(13)||chr(28)||chr(29)||chr(30)||chr(31)||chr(32)||chr(133)||chr(160)||chr(5760)||
    chr(8192)||chr(8193)||chr(8194)||chr(8195)||chr(8196)||chr(8197)||chr(8198)||chr(8199)||chr(8200)||chr(8201)||chr(8202)||
    chr(8232)||chr(8233)||chr(8239)||chr(8287)||chr(12288),repeat(' ',29)),' +',' ','g'));
$$;
create function public.nexus_radar_selection(p_context jsonb,p_document uuid,p_version uuid,p_chunks jsonb)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare ws uuid=(p_context->>'workspace_id')::uuid;v public.document_versions%rowtype;items jsonb;normal text;bytes bigint;stored integer;
begin
  perform public.workbench_authorize(p_context,'read');
  if jsonb_typeof(p_chunks) is distinct from 'array' or jsonb_array_length(p_chunks) not between 1 and 156
    or (select count(distinct value) from jsonb_array_elements_text(p_chunks))<>jsonb_array_length(p_chunks) then raise exception 'NR:INVALID_SCOPE';end if;
  select dv.* into v from public.document_versions dv join public.documents d on d.workspace_id=dv.workspace_id and d.id=dv.document_id
    where dv.workspace_id=ws and dv.id=p_version and dv.document_id=p_document and d.active_version_id=dv.id
      and d.lifecycle_state='active' and dv.publication_state='ready' and d.lifecycle_epoch=dv.lifecycle_epoch and dv.original_verified_at is not null;
  if not found then raise exception 'NR:SOURCE_UNAVAILABLE';end if;
  if v.original_bytes>524288000 then raise exception 'NR:RESOURCE_LIMIT_EXCEEDED';end if;
  if exists(select 1 from public.document_chunks c where c.workspace_id=ws and c.version_id=p_version
    and p_chunks ? c.id::text and (c.original_text is null or c.original_content_hash is null
      or encode(sha256(convert_to(c.original_text,'UTF8')),'hex')<>c.original_content_hash or octet_length(c.original_text)>32768))
    then raise exception 'NR:SOURCE_UNAVAILABLE';end if;
  select jsonb_agg(jsonb_build_object('id',c.id,'document_id',c.document_id,'version_id',c.version_id,'chunk_index',c.chunk_index,
      'original_content_hash',c.original_content_hash,'original_bytes',octet_length(c.original_text),'location',c.location) order by c.chunk_index,c.id),
    public.nexus_radar_normalize(string_agg(c.original_text,E'\n' order by c.chunk_index,c.id)),sum(octet_length(c.original_text)) into items,normal,bytes
    from public.document_chunks c where c.workspace_id=ws and c.document_id=p_document and c.version_id=p_version and p_chunks ? c.id::text;
  if coalesce(jsonb_array_length(items),0)<>jsonb_array_length(p_chunks) then raise exception 'NR:SOURCE_UNAVAILABLE';end if;
  if bytes not between 1 and 5111808 then raise exception 'NR:RESOURCE_LIMIT_EXCEEDED';end if;
  select count(*) into stored from public.document_chunks where workspace_id=ws and version_id=p_version;
  return jsonb_build_object('document_id',p_document,'version_id',p_version,'document_original_hash',v.original_hash,
    'document_original_bytes',v.original_bytes,'selections',items,'chunk_ids',(select jsonb_agg(i->'id' order by ordinal) from jsonb_array_elements(items) with ordinality x(i,ordinal)),
    'selection_hash',encode(sha256(convert_to(items::text,'UTF8')),'hex'),'normalized_hash',encode(sha256(convert_to(normal,'UTF8')),'hex'),
    'normalized_text',left(normal,65536),'comparison_complete',length(normal)<=65536,'selected_utf8_bytes',bytes,'stored_chunk_count',stored);
end;$$;
create function public.nexus_radar_chunks(p_context jsonb,p_document uuid,p_version uuid,p_limit integer,p_after uuid)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare ws uuid=(p_context->>'workspace_id')::uuid;v public.document_versions%rowtype;items jsonb;ids uuid[];stored integer;
begin
  perform public.workbench_authorize(p_context,'read');
  if p_limit is null or p_limit not between 1 and 50 then raise exception 'NR:INVALID_SCOPE';end if;
  select dv.* into v from public.document_versions dv join public.documents d on d.workspace_id=dv.workspace_id and d.id=dv.document_id
    where dv.workspace_id=ws and d.id=p_document and dv.id=d.active_version_id and(p_version is null or dv.id=p_version)
      and d.lifecycle_state='active' and dv.publication_state='ready' and dv.original_verified_at is not null and d.lifecycle_epoch=dv.lifecycle_epoch;
  if not found then raise exception 'NR:SOURCE_UNAVAILABLE';end if;
  select array_agg(id order by id) into ids from(select id from public.document_chunks where workspace_id=ws and version_id=v.id
    and(p_after is null or id>p_after) order by id limit p_limit+1) rows;
  if exists(select 1 from public.document_chunks where workspace_id=ws and id=any(coalesce(ids[1:p_limit],'{}')) and
    (original_text is null or original_content_hash is null or encode(sha256(convert_to(original_text,'UTF8')),'hex')<>original_content_hash)) then raise exception 'NR:SOURCE_UNAVAILABLE';end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'document_id',document_id,'version_id',version_id,'chunk_index',chunk_index,
    'original_content_hash',original_content_hash,'original_bytes',octet_length(original_text),'location',location,'preview',left(original_text,200),
    'preview_truncated',length(original_text)>200) order by id),'[]') into items from public.document_chunks where workspace_id=ws and id=any(coalesce(ids[1:p_limit],'{}'));
  select count(*) into stored from public.document_chunks where workspace_id=ws and version_id=v.id;
  return jsonb_build_object('schema_version','radar-chunks/1','document_id',p_document,'version_id',v.id,'document_original_hash',v.original_hash,
    'document_original_bytes',v.original_bytes,'stored_chunk_count',stored,'items',items,'next_after',case when cardinality(ids)>p_limit then ids[p_limit] end);
end;$$;
create function public.nexus_radar_snapshot_view(p_context jsonb,p_id uuid) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare s public.radar_snapshots%rowtype;
begin
  perform public.workbench_authorize(p_context,'read');
  select * into s from public.radar_snapshots where workspace_id=(p_context->>'workspace_id')::uuid and id=p_id;
  if not found then raise exception 'NR:NOT_FOUND';end if;
  return (to_jsonb(s)-'selections'-'rights_rationale')||jsonb_build_object('schema_version','radar-snapshot/1','coverage','SELECTED_CHUNKS_NOT_FULL_DOCUMENT','selected_originals',s.selections);
end;$$;
create function public.nexus_radar_current_selection(p_context jsonb,p_id uuid) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare s public.radar_snapshots%rowtype;selection jsonb;
begin
  select * into s from public.radar_snapshots where workspace_id=(p_context->>'workspace_id')::uuid and id=p_id;
  if not found then raise exception 'NR:NOT_FOUND';end if;
  selection=public.nexus_radar_selection(p_context,s.document_id,s.version_id,s.chunk_ids);
  if selection->>'selection_hash'<>s.selection_hash or selection->>'normalized_hash'<>s.normalized_hash
    or selection->>'document_original_hash'<>s.document_original_hash then raise exception 'NR:SOURCE_UNAVAILABLE';end if;
  return selection;
end;$$;
create function public.nexus_radar_comparison_selection(p_context jsonb,p_id uuid,p_chunks jsonb)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare s public.radar_snapshots%rowtype;selected jsonb;saved jsonb;
begin
  select * into s from public.radar_snapshots where workspace_id=(p_context->>'workspace_id')::uuid and id=p_id;
  if not found then raise exception 'NR:NOT_FOUND';end if;
  p_chunks=coalesce(p_chunks,s.chunk_ids);
  if jsonb_typeof(p_chunks) is distinct from 'array' or jsonb_array_length(p_chunks) not between 1 and 156
    or exists(select 1 from jsonb_array_elements_text(p_chunks) chunk_id where not(s.chunk_ids ? chunk_id)) then raise exception 'NR:INVALID_SCOPE';end if;
  selected=public.nexus_radar_selection(p_context,s.document_id,s.version_id,p_chunks);
  select jsonb_agg(item order by ordinal) into saved from jsonb_array_elements(s.selections) with ordinality refs(item,ordinal) where p_chunks ? (item->>'id');
  if selected->>'selection_hash'<>encode(sha256(convert_to(saved::text,'UTF8')),'hex') or selected->>'document_original_hash'<>s.document_original_hash then raise exception 'NR:SOURCE_UNAVAILABLE';end if;
  return selected;
end;$$;
create function public.nexus_radar_source_view(p_context jsonb,p_source uuid) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare s public.radar_sources%rowtype;m public.monitors%rowtype;latest jsonb;
begin
  perform public.workbench_authorize(p_context,'read');
  select * into s from public.radar_sources where workspace_id=(p_context->>'workspace_id')::uuid and id=p_source;
  if not found then raise exception 'NR:NOT_FOUND';end if;
  select * into strict m from public.monitors where workspace_id=s.workspace_id and id=s.monitor_id;
  select jsonb_build_object('id',id,'status',status,'materiality',materiality,'created_at',started_at,'reason_code',metadata->'reason_code') into latest
    from public.monitor_runs where workspace_id=s.workspace_id and monitor_id=m.id order by started_at desc,id desc limit 1;
  return to_jsonb(s)||jsonb_build_object('schema_version','radar-source/1','source_mode','SUPPLIED_DOCUMENT',
    'rights',public.evaluate_provider_rights(s.workspace_id,s.provider_id,'DISPLAY'),
    'monitor',jsonb_build_object('id',m.id,'tier',m.tier,'retrieval_method',m.retrieval_method,'enabled',m.enabled,'next_run_at',m.next_run_at,'latest_run',latest));
end;$$;
create function public.nexus_radar_change_summary(p_context jsonb,p_id uuid) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare c public.radar_changes%rowtype;review_state text;finding uuid;
begin
  perform public.workbench_authorize(p_context,'read');
  select * into c from public.radar_changes where workspace_id=(p_context->>'workspace_id')::uuid and id=p_id;
  if not found then raise exception 'NR:NOT_FOUND';end if;
  if c.status<>'CHANGED' then review_state='NOT_REQUIRED';
  elsif exists(select 1 from(select distinct on(reviewer_id) decision from public.radar_reviews where workspace_id=c.workspace_id and change_id=c.id order by reviewer_id,revision desc) r where decision='changes_requested')
    then review_state='CHANGES_REQUESTED';
  elsif exists(select 1 from(select distinct on(reviewer_id) decision from public.radar_reviews where workspace_id=c.workspace_id and change_id=c.id order by reviewer_id,revision desc) r where decision='approved')
    then review_state='APPROVED';else review_state='PENDING';end if;
  select finding_id into finding from public.radar_findings where workspace_id=c.workspace_id and change_id=c.id;
  return to_jsonb(c)||jsonb_build_object('schema_version','radar-change/1','review_state',review_state,'finding_id',finding);
end;$$;
create function public.nexus_radar_change_view(p_context jsonb,p_id uuid) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare c public.radar_changes%rowtype;s public.radar_sources%rowtype;before_selection jsonb;after_selection jsonb;
  reviews jsonb;rights jsonb;available boolean=true;review_state text;finding uuid;review_count integer;review_hash text;
begin
  perform public.workbench_authorize(p_context,'read');
  select * into c from public.radar_changes where workspace_id=(p_context->>'workspace_id')::uuid and id=p_id;
  if not found then raise exception 'NR:NOT_FOUND';end if;
  select * into strict s from public.radar_sources where workspace_id=c.workspace_id and id=c.source_id;
  rights=public.evaluate_provider_rights(c.workspace_id,s.provider_id,'DISPLAY');
  begin
    after_selection=public.nexus_radar_current_selection(p_context,c.after_snapshot_id);
    if c.before_snapshot_id is not null then before_selection=public.nexus_radar_comparison_selection(p_context,c.before_snapshot_id,c.before_chunk_ids);end if;
    if after_selection->>'selection_hash'<>c.current_selection_hash or after_selection->>'normalized_hash'<>c.current_hash
      or before_selection->>'selection_hash' is distinct from c.previous_selection_hash or before_selection->>'normalized_hash' is distinct from c.previous_hash
      then raise exception 'NR:SOURCE_UNAVAILABLE';end if;
  exception when others then if sqlerrm='NR:SOURCE_UNAVAILABLE' then available=false;else raise;end if;end;
  if rights->>'decision' not in('ALLOW','ALLOW_WITH_DUTIES') then available=false;end if;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.revision),'[]') into reviews from(select * from public.radar_reviews where workspace_id=c.workspace_id and change_id=c.id order by revision limit 20) r;
  select count(*),encode(sha256(convert_to(coalesce(jsonb_agg(encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') order by revision),'[]')::text,'UTF8')),'hex')
    into review_count,review_hash from public.radar_reviews r where workspace_id=c.workspace_id and change_id=c.id;
  if c.status<>'CHANGED' then review_state='NOT_REQUIRED';
  elsif exists(select 1 from(select distinct on(reviewer_id) decision from public.radar_reviews where workspace_id=c.workspace_id and change_id=c.id order by reviewer_id,revision desc) r where decision='changes_requested')
    then review_state='CHANGES_REQUESTED';
  elsif exists(select 1 from(select distinct on(reviewer_id) decision from public.radar_reviews where workspace_id=c.workspace_id and change_id=c.id order by reviewer_id,revision desc) r where decision='approved')
    then review_state='APPROVED';else review_state='PENDING';end if;
  select finding_id into finding from public.radar_findings where workspace_id=c.workspace_id and change_id=c.id;
  return to_jsonb(c)||jsonb_build_object('schema_version','radar-change/1','provider_id',s.provider_id,'source_url',s.source_url,'kind',s.kind,
    'review_state',review_state,'finding_id',finding,'reviews',reviews,'review_count',review_count,'review_history_hash',review_hash,
    'reviews_next_after',case when review_count>20 then (reviews->-1->>'revision')::bigint end,
    'before',case when c.before_snapshot_id is not null then public.nexus_radar_snapshot_view(p_context,c.before_snapshot_id) end,
    'after',public.nexus_radar_snapshot_view(p_context,c.after_snapshot_id),'source_available',available,'rights',rights,
    'affected_workflows',coalesce((select affected_workflows from public.radar_reviews where workspace_id=c.workspace_id and change_id=c.id order by revision desc limit 1),s.affected_workflows),
    'coverage','SELECTED_CHUNKS_NOT_FULL_DOCUMENT','before_text_preview',case when available then left(before_selection->>'normalized_text',4096) end,
    'after_text_preview',case when available then left(after_selection->>'normalized_text',4096) end,
    'preview_truncated',coalesce(not (after_selection->>'comparison_complete')::boolean or length(after_selection->>'normalized_text')>4096,false)
      or coalesce(not (before_selection->>'comparison_complete')::boolean or length(before_selection->>'normalized_text')>4096,false),
    'selections',jsonb_build_object('before',coalesce((select jsonb_agg(item order by ordinal) from public.radar_snapshots snap,
      lateral jsonb_array_elements(snap.selections) with ordinality refs(item,ordinal) where snap.id=c.before_snapshot_id and c.before_chunk_ids ? (item->>'id')),'[]'),
      'after',(select selections from public.radar_snapshots where id=c.after_snapshot_id)));
end;$$;

create function public.nexus_radar_capture_view(p_context jsonb,p_snapshot uuid) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare s public.radar_snapshots%rowtype;
begin
  select * into s from public.radar_snapshots where workspace_id=(p_context->>'workspace_id')::uuid and id=p_snapshot;
  if not found then raise exception 'NR:NOT_FOUND';end if;
  return jsonb_build_object('schema_version','radar-capture/1','source',public.nexus_radar_source_view(p_context,s.source_id),
    'snapshot',public.nexus_radar_snapshot_view(p_context,s.id),'change',public.nexus_radar_change_view(p_context,s.change_id));
end;$$;
-- Original creation confirmation is derived from the retained first Finding
-- version and immutable source-pair linkage. A later Finding edit never changes
-- the intent receipt, while replay still projects current source/rights state.
create function public.nexus_radar_finding_creation(p_context jsonb,p_finding uuid)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare receipt jsonb;
begin
  perform public.workbench_finding(p_context,'read',p_finding,'{}',null,null,null);
  select jsonb_build_object('schema_version','radar-finding-creation/1','workspace_id',r.workspace_id,'finding_id',r.finding_id,
    'change_id',r.change_id,'created_by',v.author_id,'revision',1,'expected_review_revision',r.source_review_revision,'title',v.title,
    'authored_markdown_hash',encode(sha256(convert_to(v.authored_markdown,'UTF8')),'hex'),'authored_markdown_bytes',octet_length(v.authored_markdown))
    into receipt from public.radar_findings r join public.finding_versions v on v.workspace_id=r.workspace_id and v.finding_id=r.finding_id and v.revision=1
    where r.workspace_id=(p_context->>'workspace_id')::uuid and r.finding_id=p_finding;
  if receipt is null then raise exception 'NR:NOT_FOUND';end if;
  return receipt;
end;$$;
create function public.nexus_radar(
  p_context jsonb,p_operation text,p_source uuid default null,p_id uuid default null,p_command jsonb default '{}',
  p_key text default null,p_limit integer default 20,p_after uuid default null
) returns jsonb language plpgsql security invoker set search_path=public,pg_temp set timezone='UTC' as $$
declare ws uuid=(p_context->>'workspace_id')::uuid;actor uuid=(p_context->>'user_id')::uuid;role_name text;
  s public.radar_sources%rowtype;snapshot public.radar_snapshots%rowtype;c public.radar_changes%rowtype;mutation public.workbench_mutations%rowtype;
  intent text;mutation_operation text;items jsonb;ids uuid[];selected jsonb;prior jsonb;rights jsonb;receipts jsonb='{}';result jsonb;classification jsonb;mutation_receipt jsonb;
  sid uuid;run_id uuid;fid uuid;monitor uuid;review_id uuid;review_state text;status text;materiality text;kind text;source_url text;title text;workflows jsonb;
begin
  perform 1 from public.workspaces where id=ws for update;
  perform public.workbench_authorize(p_context,'read');
  select role into role_name from public.workspace_members where workspace_id=ws and user_id=actor;
  if p_limit is null or p_limit not between 1 and 50 then raise exception 'NR:INVALID_SCOPE';end if;
  if p_operation='chunks' then return public.nexus_radar_chunks(p_context,p_id,(p_command->>'version_id')::uuid,p_limit,p_after);
  elsif p_operation='providers' then
    select coalesce(jsonb_agg(item order by id),'[]') into items from(select pr.id,jsonb_build_object('id',pr.id,'display_name',pr.display_name,'status',pr.status,'revision',pr.revision,
      'rights',public.evaluate_provider_rights(ws,pr.id,'DISPLAY'),'capture_rights',public.evaluate_provider_rights(ws,pr.id,'STORE')) item
      from public.provider_registry pr join public.workspace_provider_policies wp on wp.provider_id=pr.id and wp.workspace_id=ws
      where coalesce(p_command->>'after','')<pr.id order by pr.id limit p_limit+1) rows;
    return jsonb_build_object('schema_version','radar-providers/1','items',case when jsonb_array_length(items)>p_limit then items-p_limit else items end,
      'next_after',case when jsonb_array_length(items)>p_limit then items->(p_limit-1)->>'id' end);
  elsif p_operation='sources_list' then
    select array_agg(id order by id) into ids from(select id from public.radar_sources where workspace_id=ws and(p_after is null or id>p_after) order by id limit p_limit+1) rows;
    select coalesce(jsonb_agg(public.nexus_radar_source_view(p_context,id) order by id),'[]') into items from unnest(coalesce(ids[1:p_limit],'{}')) id;
    return jsonb_build_object('schema_version','radar-source-list/1','items',items,'next_after',case when cardinality(ids)>p_limit then ids[p_limit] end);
  elsif p_operation='change_read' then return public.nexus_radar_change_view(p_context,p_id);
  elsif p_operation='reviews_read' then
    if not exists(select 1 from public.radar_changes where workspace_id=ws and id=p_id) then raise exception 'NR:NOT_FOUND';end if;
    if coalesce(p_command->>'after','0')!~'^(0|[1-9][0-9]*)$' then raise exception 'NR:INVALID_SCOPE';end if;
    select coalesce(jsonb_agg(to_jsonb(r) order by revision),'[]') into items from(select * from public.radar_reviews
      where workspace_id=ws and change_id=p_id and revision>coalesce((p_command->>'after')::bigint,0) order by revision limit p_limit+1) r;
    return jsonb_build_object('schema_version','radar-review-list/1','items',case when jsonb_array_length(items)>p_limit then items-p_limit else items end,
      'next_after',case when jsonb_array_length(items)>p_limit then (items->(p_limit-1)->>'revision')::bigint end,
      'review_count',(select count(*) from public.radar_reviews where workspace_id=ws and change_id=p_id));
  end if;
  if p_operation<>'source_create' then
    select * into s from public.radar_sources where workspace_id=ws and id=coalesce(p_source,(select source_id from public.radar_changes where workspace_id=ws and id=p_id));
    if not found then raise exception 'NR:NOT_FOUND';end if;
  end if;
  if p_operation='runs_read' then
    select array_agg(id order by id) into ids from(select id from public.monitor_runs where workspace_id=ws and monitor_id=s.monitor_id
      and(p_after is null or id>p_after) order by id limit p_limit+1) rows;
    select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]') into items from public.monitor_runs r where r.workspace_id=ws and r.id=any(coalesce(ids[1:p_limit],'{}'));
    return jsonb_build_object('schema_version','radar-run-list/1','items',items,'next_after',case when cardinality(ids)>p_limit then ids[p_limit] end);
  elsif p_operation='source_read' then
    select array_agg(id order by id) into ids from(select id from public.radar_snapshots where workspace_id=ws and source_id=s.id and(p_after is null or id>p_after) order by id limit p_limit+1) rows;
    select coalesce(jsonb_agg(public.nexus_radar_snapshot_view(p_context,id) order by id),'[]') into items from unnest(coalesce(ids[1:p_limit],'{}')) id;
    return jsonb_build_object('schema_version','radar-source-detail/1','source',public.nexus_radar_source_view(p_context,s.id),
      'latest_snapshot',case when s.latest_snapshot_id is not null then public.nexus_radar_snapshot_view(p_context,s.latest_snapshot_id) end,
      'runs',public.nexus_radar(p_context,'runs_read',s.id,p_limit=>p_limit),
      'snapshots',jsonb_build_object('items',items,'next_after',case when cardinality(ids)>p_limit then ids[p_limit] end),
      'changes',jsonb_build_object('items',(select coalesce(jsonb_agg(public.nexus_radar_change_summary(p_context,change_id) order by id),'[]')
        from public.radar_snapshots where workspace_id=ws and id=any(coalesce(ids[1:p_limit],'{}'))),'next_after',case when cardinality(ids)>p_limit then ids[p_limit] end));
  end if;
  if role_name is null or role_name not in('owner','admin','editor') then raise exception 'NR:FORBIDDEN';end if;
  if p_key is null or length(p_key) not between 1 and 128 then raise exception 'NR:INVALID_SCOPE';end if;
  mutation_operation=case when p_operation in('prepare_snapshot','capture') then 'radar.capture' else 'radar.'||p_operation end;
  intent=encode(sha256(convert_to(jsonb_build_object('source',p_source,'id',p_id,'command',p_command-'classification')::text,'UTF8')),'hex');
  select * into mutation from public.workbench_mutations m where m.workspace_id=ws and m.actor_id=actor and m.operation=mutation_operation and m.idempotency_key=p_key;
  if found then
    if mutation.payload_hash<>intent then raise exception 'NR:VERSION_CONFLICT';end if;
    if p_operation='source_create' then result=public.nexus_radar_source_view(p_context,(mutation.response->>'source_id')::uuid);
    elsif p_operation in('prepare_snapshot','capture') then
      result=public.nexus_radar_capture_view(p_context,(mutation.response->>'snapshot_id')::uuid);
      if p_operation='prepare_snapshot' then return jsonb_build_object('schema_version','radar-prepare/1','replayed',true,'result',result);end if;
    elsif p_operation='review' then
      result=public.nexus_radar_change_view(p_context,(mutation.response->>'change_id')::uuid)||jsonb_build_object('confirmed_review',
        (select to_jsonb(r) from public.radar_reviews r where workspace_id=ws and id=(mutation.response->>'review_id')::uuid));
    elsif p_operation='finding' then result=public.nexus_research_finding_view(p_context,(mutation.response->>'finding_id')::uuid)||
      jsonb_build_object('confirmed_creation',public.nexus_radar_finding_creation(p_context,(mutation.response->>'finding_id')::uuid));
    else result=mutation.response;end if;
    return result;
  end if;
  if p_operation='source_create' then
    kind=p_command->>'kind';source_url=btrim(p_command->>'source_url');title=btrim(p_command->>'title');workflows=coalesce(p_command->'affected_workflows','[]');
    if coalesce(kind,'') not in('TERMS','QUOTA','PRICING','SCHEMA','DEPRECATION','LICENCE','OTHER') or coalesce(length(title),0) not between 1 and 160
      or coalesce(source_url,'')!~'^https://[^/[:space:]]+(/[^[:space:]]*)?$' or length(source_url)>2000
      or jsonb_typeof(workflows) is distinct from 'array' or jsonb_array_length(workflows)>50 or exists(select 1 from jsonb_array_elements(workflows) x where jsonb_typeof(x)<>'string' or length(x#>>'{}') not between 1 and 128)
      then raise exception 'NR:INVALID_SCOPE';end if;
    rights=public.evaluate_provider_rights(ws,p_command->>'provider_id','STORE');
    if rights->>'decision' not in('ALLOW','ALLOW_WITH_DUTIES') then raise exception 'NR:RIGHTS_BLOCKED';end if;
    if (select count(*) from public.radar_sources where workspace_id=ws)>=1000 then raise exception 'NR:RESOURCE_LIMIT_EXCEEDED';end if;
    insert into public.monitors(workspace_id,provider_id,owner_id,tier,retrieval_method,target_uri,enabled,next_run_at)
      values(ws,p_command->>'provider_id',actor,'MANUAL_REVIEW','SUPPLIED_DOCUMENT',source_url,false,null) returning id into monitor;
    insert into public.radar_sources(workspace_id,provider_id,source_url,title,kind,monitor_id,created_by,affected_workflows)
      values(ws,p_command->>'provider_id',source_url,title,kind,monitor,actor,workflows) returning * into s;
    result=public.nexus_radar_source_view(p_context,s.id);
    mutation_receipt=jsonb_build_object('source_id',s.id);
  elsif p_operation in('prepare_snapshot','capture') then
    if coalesce(p_command->>'expected_revision','')!~'^(0|[1-9][0-9]*)$' or (p_command->>'expected_revision')::bigint<>s.revision then raise exception 'NR:VERSION_CONFLICT';end if;
    if coalesce(length(btrim(p_command->>'rights_rationale')),0) not between 1 and 2000 or p_command->>'captured_at' is null then raise exception 'NR:INVALID_SCOPE';end if;
    if (p_command->>'captured_at')::timestamptz>clock_timestamp()+interval '5 minutes' then raise exception 'NR:INVALID_SCOPE';end if;
    foreach kind in array array['STORE','DISPLAY','MONITOR'] loop
      rights=public.evaluate_provider_rights(ws,s.provider_id,kind);if rights->>'decision' not in('ALLOW','ALLOW_WITH_DUTIES') then raise exception 'NR:RIGHTS_BLOCKED';end if;
      receipts=receipts||jsonb_build_object(kind,rights);
    end loop;
    selected=public.nexus_radar_selection(p_context,(p_command->>'document_id')::uuid,(p_command->>'version_id')::uuid,p_command->'chunk_ids');
    if s.latest_snapshot_id is not null then prior=public.nexus_radar_comparison_selection(p_context,s.latest_snapshot_id,p_command->'before_chunk_ids');
    elsif p_command ? 'before_chunk_ids' then raise exception 'NR:INVALID_SCOPE';end if;
    if (select count(distinct item->>'id') from jsonb_array_elements(coalesce(prior->'selections','[]')||(selected->'selections')) item)>156 then raise exception 'NR:RESOURCE_LIMIT_EXCEEDED';end if;
    if p_operation='prepare_snapshot' then
      return jsonb_build_object('schema_version','radar-prepare/1','replayed',false,'source',public.nexus_radar_source_view(p_context,s.id),
        'previous',prior,'current',selected,'rights_receipts',receipts);
    end if;
    classification=p_command->'classification';materiality=classification->>'materiality';
    if classification->>'previous_hash' is distinct from prior->>'normalized_hash' or classification->>'current_hash' is distinct from selected->>'normalized_hash'
      or classification->>'previous_selection_hash' is distinct from prior->>'selection_hash' or classification->>'current_selection_hash' is distinct from selected->>'selection_hash'
      or coalesce(materiality,'') not in('NONE','EDITORIAL','OPERATIONAL','RIGHTS_REVIEW','SECURITY_REVIEW','REVIEW_REQUIRED')
      or jsonb_typeof(classification->'matched_signals') is distinct from 'array' or jsonb_array_length(classification->'matched_signals')>50
      or exists(select 1 from jsonb_array_elements(classification->'matched_signals') signal where jsonb_typeof(signal)<>'string' or length(signal#>>'{}') not between 1 and 128)
      then raise exception 'NR:VERSION_CONFLICT';end if;
    status=case when prior is null then 'BASELINE' when prior->>'normalized_hash'=selected->>'normalized_hash' then 'UNCHANGED' else 'CHANGED' end;
    if status<>'CHANGED' and materiality<>'NONE' or status='CHANGED' and materiality='NONE'
      or status='CHANGED' and (not (prior->>'comparison_complete')::boolean or not (selected->>'comparison_complete')::boolean) and materiality<>'REVIEW_REQUIRED'
      then raise exception 'NR:INVALID_SCOPE';end if;
    if (select count(*) from public.radar_snapshots where workspace_id=ws)>=1000 then raise exception 'NR:RESOURCE_LIMIT_EXCEEDED';end if;
    sid=gen_random_uuid();run_id=gen_random_uuid();
    insert into public.monitor_runs(id,workspace_id,monitor_id,status,previous_hash,current_hash,materiality,completed_at,metadata)
      values(run_id,ws,s.monitor_id,status,prior->>'normalized_hash',selected->>'normalized_hash',materiality,clock_timestamp(),
        jsonb_build_object('source_mode','SUPPLIED_DOCUMENT','coverage','SELECTED_CHUNKS_NOT_FULL_DOCUMENT','before_snapshot_id',s.latest_snapshot_id,'after_snapshot_id',sid));
    insert into public.radar_snapshots(id,workspace_id,source_id,revision,document_id,version_id,document_original_hash,document_original_bytes,
      selection_hash,normalized_hash,chunk_ids,selections,selected_utf8_bytes,stored_chunk_count,comparison_complete,captured_at,actor_id,rights_rationale,rights_receipts,change_id)
      values(sid,ws,s.id,s.revision+1,(selected->>'document_id')::uuid,(selected->>'version_id')::uuid,selected->>'document_original_hash',(selected->>'document_original_bytes')::bigint,
        selected->>'selection_hash',selected->>'normalized_hash',selected->'chunk_ids',selected->'selections',(selected->>'selected_utf8_bytes')::integer,
        (selected->>'stored_chunk_count')::integer,(selected->>'comparison_complete')::boolean,(p_command->>'captured_at')::timestamptz,actor,p_command->>'rights_rationale',receipts,run_id);
    insert into public.radar_changes(id,workspace_id,source_id,before_snapshot_id,after_snapshot_id,before_chunk_ids,previous_hash,current_hash,previous_selection_hash,current_selection_hash,status,materiality,matched_signals)
      values(run_id,ws,s.id,s.latest_snapshot_id,sid,coalesce(prior->'chunk_ids','[]'),prior->>'normalized_hash',selected->>'normalized_hash',prior->>'selection_hash',selected->>'selection_hash',status,materiality,classification->'matched_signals');
    update public.radar_sources set revision=revision+1,latest_snapshot_id=sid where id=s.id;
    update public.monitors set last_content_hash=selected->>'normalized_hash',state=case when status='CHANGED' then 'REVIEW_REQUIRED' else 'READY' end where id=s.monitor_id;
    result=public.nexus_radar_capture_view(p_context,sid);
    mutation_receipt=jsonb_build_object('snapshot_id',sid);
  elsif p_operation='record_failure' then
    if p_command->>'reason_code' not in('RIGHTS_BLOCKED','SOURCE_UNAVAILABLE','RESOURCE_LIMIT_EXCEEDED','VERSION_CONFLICT','PERSISTENCE_UNCONFIRMED') then raise exception 'NR:INVALID_SCOPE';end if;
    if (select count(*) from public.monitor_runs where workspace_id=ws)>=10000 then raise exception 'NR:RESOURCE_LIMIT_EXCEEDED';end if;
    insert into public.monitor_runs(workspace_id,monitor_id,status,current_hash,completed_at,metadata)
      values(ws,s.monitor_id,case when p_command->>'reason_code'='RIGHTS_BLOCKED' then 'RIGHTS_BLOCKED' else 'FAILED' end,
        (select normalized_hash from public.radar_snapshots where id=s.latest_snapshot_id),clock_timestamp(),
        jsonb_build_object('source_mode','SUPPLIED_DOCUMENT','reason_code',p_command->>'reason_code','last_confirmed_snapshot_id',s.latest_snapshot_id)) returning id into run_id;
    update public.monitors set state=case when p_command->>'reason_code'='RIGHTS_BLOCKED' then 'RIGHTS_BLOCKED' else 'FAILED' end where id=s.monitor_id;
    result=jsonb_build_object('schema_version','radar-failed-run/1','id',run_id,'source_id',s.id,'reason_code',p_command->>'reason_code','latest_snapshot_id',s.latest_snapshot_id);
    mutation_receipt=result;
  elsif p_operation='review' then
    select * into strict c from public.radar_changes where workspace_id=ws and id=p_id;
    if c.status<>'CHANGED' or (p_command->>'expected_review_revision')::bigint is distinct from c.review_revision then raise exception 'NR:VERSION_CONFLICT';end if;
    if exists(select 1 from public.radar_snapshots where id in(c.before_snapshot_id,c.after_snapshot_id) and actor_id=actor) then raise exception 'NR:FORBIDDEN';end if;
    result=public.nexus_radar_change_view(p_context,c.id);
    if result->>'source_available'<>'true' then raise exception 'NR:SOURCE_UNAVAILABLE';end if;
    if coalesce(p_command->>'decision','') not in('approved','changes_requested') or length(coalesce(p_command->>'comment',''))>4000 then raise exception 'NR:INVALID_SCOPE';end if;
    if (select count(*) from public.radar_reviews where workspace_id=ws)>=10000 then raise exception 'NR:RESOURCE_LIMIT_EXCEEDED';end if;
    workflows=coalesce(p_command->'affected_workflows',s.affected_workflows);
    if jsonb_typeof(workflows) is distinct from 'array' or jsonb_array_length(workflows)>50 or exists(select 1 from jsonb_array_elements(workflows) x where jsonb_typeof(x)<>'string' or length(x#>>'{}') not between 1 and 128)
      then raise exception 'NR:INVALID_SCOPE';end if;
    insert into public.radar_reviews(workspace_id,change_id,revision,reviewer_id,decision,comment,affected_workflows)
      values(ws,c.id,c.review_revision+1,actor,p_command->>'decision',coalesce(p_command->>'comment',''),workflows) returning id into review_id;
    update public.radar_changes set review_revision=review_revision+1 where id=c.id;
    result=public.nexus_radar_change_view(p_context,c.id)||jsonb_build_object('confirmed_review',(select to_jsonb(r) from public.radar_reviews r where id=review_id));
    mutation_receipt=jsonb_build_object('change_id',c.id,'review_id',review_id);
  elsif p_operation='finding' then
    select * into strict c from public.radar_changes where workspace_id=ws and id=p_id;
    result=public.nexus_radar_change_view(p_context,c.id);
    if c.review_revision is distinct from (p_command->>'expected_review_revision')::bigint then raise exception 'NR:VERSION_CONFLICT';end if;
    if result->>'review_state'<>'APPROVED' then raise exception 'NR:REVIEW_REQUIRED';end if;
    if result->>'source_available'<>'true' then raise exception 'NR:SOURCE_UNAVAILABLE';end if;
    title=btrim(p_command->>'title');if coalesce(length(title),0) not between 1 and 160 or length(coalesce(p_command->>'authored_markdown',''))>50000 then raise exception 'NR:INVALID_SCOPE';end if;
    select finding_id into fid from public.radar_findings where workspace_id=ws and change_id=c.id;
    if fid is null then
      result=public.workbench_finding(p_context,'create',null,jsonb_build_object('title',title,'authored_markdown',coalesce(p_command->>'authored_markdown','')),null,'radar:'||c.id,intent);
      fid=(result->>'id')::uuid;
      insert into public.radar_findings(finding_id,workspace_id,change_id,source_review_revision) values(fid,ws,c.id,c.review_revision);
      update public.finding_versions set generated_markdown='Supplied snapshot change: '||c.materiality||E'.\nSelected evidence only; not a complete provider-page comparison or certification.\nBefore SHA256: '||c.previous_hash||E'\nAfter SHA256: '||c.current_hash
        where workspace_id=ws and finding_id=fid and revision=1;
      insert into public.audit_events(workspace_id,user_id,action,resource_type,resource_id,metadata) values(ws,actor,'finding.create','finding',fid::text,jsonb_build_object('radar_change_id',c.id,'revision',1));
    end if;
    result=public.nexus_radar_finding_creation(p_context,fid);
    if result->>'created_by' is distinct from actor::text or result->>'title' is distinct from title
      or (result->>'expected_review_revision')::bigint is distinct from c.review_revision
      or result->>'authored_markdown_hash' is distinct from encode(sha256(convert_to(coalesce(p_command->>'authored_markdown',''),'UTF8')),'hex')
      or (result->>'authored_markdown_bytes')::integer is distinct from octet_length(coalesce(p_command->>'authored_markdown',''))
      then raise exception 'NR:VERSION_CONFLICT';end if;
    result=public.nexus_research_finding_view(p_context,fid)||jsonb_build_object('confirmed_creation',result);
    mutation_receipt=jsonb_build_object('finding_id',fid);
  else raise exception 'NR:INVALID_SCOPE';end if;
  insert into public.workbench_mutations(workspace_id,actor_id,operation,idempotency_key,payload_hash,response) values(ws,actor,mutation_operation,p_key,intent,mutation_receipt);
  insert into public.audit_events(workspace_id,user_id,action,resource_type,resource_id,metadata)
    values(ws,actor,mutation_operation,'radar',coalesce(s.id,p_source)::text,jsonb_build_object('source_mode','SUPPLIED_DOCUMENT','coverage','SELECTED_CHUNKS_NOT_FULL_DOCUMENT'));
  return result;
exception when unique_violation then raise exception 'NR:VERSION_CONFLICT';
end;$$;

-- Extend the actual Finding projection. Never fabricate a research/query run.
alter function public.nexus_research_finding_view(jsonb,uuid) rename to nexus_research_finding_view_before_radar;
create function public.nexus_research_finding_view(p_context jsonb,p_id uuid)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare f jsonb;change uuid;detail jsonb;quotes jsonb;ws uuid=(p_context->>'workspace_id')::uuid;
begin
  f=public.nexus_research_finding_view_before_radar(p_context,p_id);
  select change_id into change from public.radar_findings where workspace_id=ws and finding_id=p_id;
  if change is null then return f;end if;
  detail=public.nexus_radar_change_view(p_context,change);
  if detail->>'source_available'='true' then
    with selected as(select distinct on(item->>'id') (item->>'id')::uuid id,ordinal,item
      from jsonb_array_elements((detail->'selections'->'before')||(detail->'selections'->'after')) with ordinality refs(item,ordinal)
      order by item->>'id',ordinal),ranked as(select id,ordinal,item,row_number() over(order by ordinal) citation_index from selected)
    select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'document_id',c.document_id,'version_id',c.version_id,'filename',d.filename,
      'citation_id','S'||r.citation_index,'original_text',c.original_text,'original_content_hash',c.original_content_hash,'location',c.location,'available',true,'freshness','current') order by r.ordinal),'[]') into quotes
      from ranked r join public.document_chunks c on c.workspace_id=ws and c.id=r.id
        and c.document_id=(r.item->>'document_id')::uuid and c.version_id=(r.item->>'version_id')::uuid
        and c.original_content_hash=r.item->>'original_content_hash'
        and encode(sha256(convert_to(c.original_text,'UTF8')),'hex')=r.item->>'original_content_hash'
        and octet_length(c.original_text)=(r.item->>'original_bytes')::integer
      join public.documents d on d.workspace_id=c.workspace_id and d.id=c.document_id and d.active_version_id=c.version_id and d.lifecycle_state='active'
      join public.document_versions v on v.workspace_id=c.workspace_id and v.id=c.version_id and v.document_id=c.document_id
        and v.publication_state='ready' and v.original_verified_at is not null and d.lifecycle_epoch=v.lifecycle_epoch;
    if jsonb_array_length(quotes)<>(select count(distinct item->>'id') from jsonb_array_elements((detail->'selections'->'before')||(detail->'selections'->'after')) item) then
      detail=detail||jsonb_build_object('source_available',false,'before_text_preview',null,'after_text_preview',null);quotes='[]';
    end if;
  end if;
  return f||jsonb_build_object('source_radar_change_id',change,'author_id',(select author_id from public.finding_versions where workspace_id=ws and finding_id=p_id and revision=(f->>'revision')::bigint),
    'radar_origin',detail-'reviews'-'before_text_preview'-'after_text_preview'-'selections',
    'source_unavailable',detail->>'source_available'<>'true','generated_markdown',case when detail->>'source_available'='true' then f->'generated_markdown' end,
    'evidence',coalesce(quotes,'[]'),'export_state','RIGHTS_REVIEW_REQUIRED');
end;$$;
alter function public.nexus_finding_export_sources(jsonb,uuid) rename to nexus_finding_export_sources_before_radar;
create function public.nexus_finding_export_sources(p_context jsonb,p_finding uuid)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare provider text;rights jsonb;change uuid;
begin
  select s.provider_id,c.id into provider,change from public.radar_findings f join public.radar_changes c on c.workspace_id=f.workspace_id and c.id=f.change_id
    join public.radar_sources s on s.workspace_id=c.workspace_id and s.id=c.source_id where f.workspace_id=(p_context->>'workspace_id')::uuid and f.finding_id=p_finding;
  if provider is not null then rights=public.evaluate_provider_rights((p_context->>'workspace_id')::uuid,provider,'EXPORT');
    if rights->>'decision' not in('ALLOW','ALLOW_WITH_DUTIES') then raise exception 'NR:RIGHTS_BLOCKED';end if;
    if public.nexus_radar_change_view(p_context,change)->>'review_state'<>'APPROVED' then raise exception 'NR:REVIEW_REQUIRED';end if;
  end if;
  return public.nexus_finding_export_sources_before_radar(p_context,p_finding);
end;$$;
alter function public.nexus_finding_package_common(jsonb,uuid) rename to nexus_finding_package_common_before_radar;
create function public.nexus_finding_package_common(p_context jsonb,p_finding uuid)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp set timezone='UTC' as $$
declare manifest jsonb;change uuid;detail jsonb;activity jsonb;
begin
  manifest=public.nexus_finding_package_common_before_radar(p_context,p_finding);
  select change_id into change from public.radar_findings where workspace_id=(p_context->>'workspace_id')::uuid and finding_id=p_finding;
  if change is null then return manifest;end if;
  detail=public.nexus_radar_change_view(p_context,change);
  activity=jsonb_build_object('@id','urn:nexusrag:radar-change:'||change,'@type','prov:Activity','prov:used',manifest->'prov:wasDerivedFrom',
    'coverage','SELECTED_CHUNKS_NOT_FULL_DOCUMENT');
  return manifest||jsonb_build_object('analysis',detail-'before_text_preview'-'after_text_preview'-'selections',
    '@included',(manifest->'@included')||jsonb_build_array(activity),'prov:wasGeneratedBy',jsonb_build_object('@id',activity->>'@id'));
end;$$;
alter function public.nexus_record_finding_export(jsonb,uuid,bigint,text,text) rename to nexus_record_finding_export_before_radar;
create function public.nexus_record_finding_export(p_context jsonb,p_finding uuid,p_revision bigint,p_manifest_text text,p_hash text)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
begin
  if exists(select 1 from public.radar_findings where workspace_id=(p_context->>'workspace_id')::uuid and finding_id=p_finding) then raise exception 'NR:RIGHTS_BLOCKED';end if;
  return public.nexus_record_finding_export_before_radar(p_context,p_finding,p_revision,p_manifest_text,p_hash);
end;$$;

revoke all on function public.nexus_radar_contract(),public.nexus_radar_normalize(text),public.nexus_radar_selection(jsonb,uuid,uuid,jsonb),
  public.nexus_radar_finding_creation(jsonb,uuid),public.nexus_radar_capture_view(jsonb,uuid),public.nexus_radar_comparison_selection(jsonb,uuid,jsonb),public.nexus_radar_chunks(jsonb,uuid,uuid,integer,uuid),public.nexus_radar_snapshot_view(jsonb,uuid),public.nexus_radar_current_selection(jsonb,uuid),public.nexus_radar_source_view(jsonb,uuid),public.nexus_radar_change_summary(jsonb,uuid),public.nexus_radar_change_view(jsonb,uuid),
  public.nexus_radar(jsonb,text,uuid,uuid,jsonb,text,integer,uuid),public.nexus_research_finding_view(jsonb,uuid),public.nexus_finding_export_sources(jsonb,uuid),
  public.nexus_finding_package_common(jsonb,uuid),public.nexus_record_finding_export(jsonb,uuid,bigint,text,text) from public,anon,authenticated;
grant execute on function public.nexus_radar_contract(),public.nexus_radar_normalize(text),public.nexus_radar_selection(jsonb,uuid,uuid,jsonb),
  public.nexus_radar_finding_creation(jsonb,uuid),public.nexus_radar_capture_view(jsonb,uuid),public.nexus_radar_comparison_selection(jsonb,uuid,jsonb),public.nexus_radar_chunks(jsonb,uuid,uuid,integer,uuid),public.nexus_radar_snapshot_view(jsonb,uuid),public.nexus_radar_current_selection(jsonb,uuid),public.nexus_radar_source_view(jsonb,uuid),public.nexus_radar_change_summary(jsonb,uuid),public.nexus_radar_change_view(jsonb,uuid),
  public.nexus_radar(jsonb,text,uuid,uuid,jsonb,text,integer,uuid),public.nexus_research_finding_view(jsonb,uuid),public.nexus_finding_export_sources(jsonb,uuid),
  public.nexus_finding_package_common(jsonb,uuid),public.nexus_record_finding_export(jsonb,uuid,bigint,text,text) to service_role;
