-- One fair lexical read preserves the full source scope within Worker subrequests.
-- Installation changes no existing records and starts no jobs or provider work.
create function public.nexus_research_candidates_contract()
returns jsonb language sql stable security invoker set search_path=public,pg_temp as $$
  select jsonb_build_object('schema_version','research-candidates/1','max_rows',201,'max_candidates',200,'max_sources',50);
$$;

create function public.nexus_research_candidates(p_context jsonb,p_id uuid,p_generation integer,p_position integer,p_document_ids uuid[])
returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare r public.research_runs%rowtype; allowed uuid[]; chosen uuid[]; source_count integer; batch integer; scope_offset integer=0;
  candidates jsonb; rows_read integer; limited boolean;
begin
  perform public.workbench_authorize(p_context,'document.mutate');
  select * into r from public.research_runs where id=p_id and workspace_id=(p_context->>'workspace_id')::uuid and owner_id=(p_context->>'user_id')::uuid;
  if not found then raise exception 'NR:NOT_FOUND'; end if;
  if r.state<>'running' or r.generation<>p_generation or r.position<>p_position or r.deadline<=clock_timestamp() then raise exception 'NR:VERSION_CONFLICT'; end if;
  if not public.nexus_research_sources_current(r.workspace_id,r.source_snapshot) then raise exception 'NR:SOURCE_UNAVAILABLE'; end if;
  source_count=jsonb_array_length(r.source_snapshot);
  if r.mode in('COMPARE','TIMELINE') then
    batch=p_position%((source_count+7)/8);scope_offset=batch*8;
  end if;
  select array_agg((s->>'document_id')::uuid order by ordinal) into allowed
    from jsonb_array_elements(r.source_snapshot) with ordinality snapshot(s,ordinal)
    where ordinal>scope_offset and (r.mode not in('COMPARE','TIMELINE') or ordinal<=scope_offset+8);
  select array_agg(distinct value) into chosen from unnest(p_document_ids) value;
  if coalesce(cardinality(chosen),0) not between 1 and 50 or cardinality(chosen)<>cardinality(p_document_ids)
    or not(chosen<@allowed) or (r.mode in('COMPARE','TIMELINE','CONTRADICTION_ANALYSIS') and not(allowed<@chosen)) then raise exception 'NR:INVALID_SCOPE'; end if;

  -- Allocate the same 201-row budget as the executor, including one canary per
  -- source. Return all sources' fair shares in one bounded SQL request.
  with scope as (
    select s,row_number() over(order by ordinal)::integer rank,count(*) over()::integer total
      from jsonb_array_elements(r.source_snapshot) with ordinality snapshot(s,ordinal)
      where (s->>'document_id')::uuid=any(chosen)
  ), allocations as (
    select s,rank,201/total+case when rank<=201%total then 1 else 0 end allowance from scope
  ), batches as (
    select a.rank,a.allowance,coalesce(jsonb_agg(to_jsonb(c) order by c.id) filter(where c.id is not null),'[]') items
      from allocations a left join lateral (
        select id,workspace_id,document_id,version_id,chunk_index,page_number,content,original_text,original_content_hash,location,metadata
          from public.document_chunks where workspace_id=r.workspace_id and document_id=(a.s->>'document_id')::uuid and version_id=(a.s->>'version_id')::uuid
          order by id limit a.allowance
      ) c on true group by a.rank,a.allowance
  ) select coalesce((select jsonb_agg(item order by rank,ordinal) from batches cross join lateral jsonb_array_elements(items) with ordinality x(item,ordinal)
      where ordinal<case when jsonb_array_length(items)=allowance then allowance else allowance+1 end),'[]'),
      coalesce((select sum(jsonb_array_length(items)) from batches),0)::integer,
      coalesce((select bool_or(jsonb_array_length(items)=allowance) from batches),false)
    into candidates,rows_read,limited;
  return jsonb_build_object('schema_version','research-candidates/1','run_id',r.id,'generation',r.generation,'position',r.position,
    'items',candidates,'lexical_rows_read',rows_read,'lexical_limit_reached',limited);
end; $$;

revoke all on function public.nexus_research_candidates_contract(),public.nexus_research_candidates(jsonb,uuid,integer,integer,uuid[]) from public,anon,authenticated;
grant execute on function public.nexus_research_candidates_contract(),public.nexus_research_candidates(jsonb,uuid,integer,integer,uuid[]) to service_role;

alter function public.nexus_research_finding_view(jsonb,uuid) rename to nexus_research_finding_view_contradiction_v1;
create function public.nexus_research_finding_view(p_context jsonb,p_id uuid)
returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare f jsonb; retrieval jsonb;
begin
  f=public.nexus_research_finding_view_contradiction_v1(p_context,p_id);
  if f->>'source_research_run_id' is null or f->>'source_unavailable'='true' then return f; end if;
  select results->(f->>'source_research_position')::integer->'query_retrieval' into retrieval from public.research_runs
    where id=(f->>'source_research_run_id')::uuid and workspace_id=(p_context->>'workspace_id')::uuid;
  return jsonb_set(f,'{research_origin}',(f->'research_origin')||jsonb_build_object('query_retrieval',retrieval));
end; $$;
revoke all on function public.nexus_research_finding_view(jsonb,uuid) from public,anon,authenticated;
grant execute on function public.nexus_research_finding_view(jsonb,uuid) to service_role;
