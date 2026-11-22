\set ON_ERROR_STOP on
-- NX-15 (decision D11): after 20261122090000_remove_passport_and_procurement.sql the database refuses Product Passport
-- and Procurement Research, keeps no code that served them, and every research function still reaches the layer
-- beneath them. The integration tests of the remaining modes that follow exercise those chains. Nothing here is kept.
begin;
do $$
declare
  removed text; found text;
  plan jsonb=jsonb_build_object('plan_id','removed-mode','question','Which supplied claims need review?',
    'subquestions','[]'::jsonb,'private_source_ids','["source-one"]'::jsonb,'public_provider_ids','[]'::jsonb,
    'date_from',null,'date_to',null,'jurisdiction',null,'entity_scope','[]'::jsonb,'rights_constraints','[]'::jsonb,
    'expected_calculations','[]'::jsonb,'completion_criteria','["Inspect the source."]'::jsonb);
begin
  foreach removed in array array['PRODUCT_PASSPORT','PROCUREMENT_RESEARCH'] loop
    begin
      perform public.nexus_research_plan_limits(plan||jsonb_build_object('mode',removed));
      raise exception 'Plan limits accepted the removed mode %',removed;
    exception when others then if sqlerrm<>'NR:INVALID_SCOPE' then raise; end if; end;
  end loop;
  -- A declared Product Passport subject is now an unknown field: ignored, never a reason to accept a mode.
  if public.nexus_research_plan_limits(plan||'{"mode":"DUE_DILIGENCE","passport_subject":{}}')
      <>'{"max_sources":60,"requires_review":true,"max_subquestions":12,"max_query_variants":8,"max_runtime_seconds":600}'::jsonb
    or public.nexus_research_plan_limits(plan||'{"mode":"QUICK_LOOKUP"}')->>'max_sources'<>'8'
    or public.nexus_research_plan_limits(plan||'{"mode":"CALCULATION"}')->>'max_sources'<>'30' then
    raise exception 'The remaining modes lost their limits';
  end if;

  select string_agg(conname,', ') into found from pg_constraint
    where conrelid='public.research_runs'::regclass and pg_get_constraintdef(oid) ~ 'PRODUCT_PASSPORT|PROCUREMENT_RESEARCH';
  if found is not null then raise exception 'Research run constraints still admit a removed mode: %',found; end if;
  if pg_get_constraintdef((select oid from pg_constraint where conrelid='public.research_runs'::regclass and conname='research_runs_mode_check'))
    !~ 'DUE_DILIGENCE' then raise exception 'The mode check lost a remaining mode'; end if;

  foreach removed in array array['public.nexus_research_passport_contract()','public.nexus_research_procurement_contract()',
    'public.nexus_research_plan_limits_before_passport_subject(jsonb)',
    'public.nexus_research_run_procurement_v1(jsonb,text,uuid,uuid,text,jsonb,integer,uuid)',
    'public.nexus_research_run_passport_v1(jsonb,text,uuid,uuid,text,jsonb,integer,uuid)',
    'public.nexus_research_step_procurement_v1(jsonb,text,uuid,integer,integer,uuid,jsonb,text)',
    'public.nexus_research_step_passport_v1(jsonb,text,uuid,integer,integer,uuid,jsonb,text)',
    'public.nexus_research_finding_view_procurement_v1(jsonb,uuid)','public.nexus_research_finding_view_passport_v1(jsonb,uuid)',
    'public.nexus_finding_procurement_v1(jsonb,text,uuid,jsonb,bigint,text,text)',
    'public.nexus_finding_passport_v1(jsonb,text,uuid,jsonb,bigint,text,text)',
    'public.nexus_research_candidates_procurement_v1(jsonb,uuid,integer,integer,uuid[])',
    'public.nexus_research_candidates_passport_v1(jsonb,uuid,integer,integer,uuid[])',
    'public.nexus_research_run_view_passport_v1(public.research_runs)'] loop
    if to_regprocedure(removed) is not null then raise exception 'Removed function % still exists',removed; end if;
  end loop;
  select string_agg(n.nspname||'.'||p.proname,', ' order by p.proname) into found from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in('public','nexusrag_private') and p.prosrc ~* 'passport|procurement';
  if found is not null then raise exception 'Functions still serve the removed modes: %',found; end if;

  -- Each layer the removed ones wrapped is now called directly by the layer above, under the name it called.
  foreach removed in array array[
      'nexus_research_run_calculation_v1>public.nexus_research_run_diligence_v1(',
      'nexus_research_step_calculation_v1>public.nexus_research_step_diligence_v1(',
      'nexus_finding_calculation_v1>public.nexus_finding_diligence_v1(',
      'nexus_research_finding_view_before_radar>public.nexus_research_finding_view_diligence_v1(',
      'nexus_research_run_view_calculation_v1>public.nexus_research_run_view_diligence_v1(',
      'nexus_research_candidates>public.nexus_research_candidates_diligence_v1('] loop
    if not exists(select 1 from pg_proc where pronamespace='public'::regnamespace and proname=split_part(removed,'>',1)
        and strpos(prosrc,split_part(removed,'>',2))>0) then
      raise exception 'The chain of % does not reach the Due Diligence layer',split_part(removed,'>',1);
    end if;
  end loop;
  if not exists(select 1 from pg_proc where pronamespace='public'::regnamespace and proname='nexus_research_finding_view_calculation_v1'
      and strpos(prosrc,'public.nexus_research_finding_view_before_radar(')>0) then
    raise exception 'The Radar layer of the finding view is gone';
  end if;
  -- Renaming kept the privileges: only the service role may call the layers that moved.
  foreach removed in array array['public.nexus_research_run_calculation_v1(jsonb,text,uuid,uuid,text,jsonb,integer,uuid)',
    'public.nexus_research_step_calculation_v1(jsonb,text,uuid,integer,integer,uuid,jsonb,text)',
    'public.nexus_finding_calculation_v1(jsonb,text,uuid,jsonb,bigint,text,text)',
    'public.nexus_research_finding_view_before_radar(jsonb,uuid)','public.nexus_research_run_view_calculation_v1(public.research_runs)',
    'public.nexus_research_candidates(jsonb,uuid,integer,integer,uuid[])','public.nexus_research_plan_limits(jsonb)'] loop
    if not has_function_privilege('service_role',removed,'execute') or has_function_privilege('anon',removed,'execute')
      or has_function_privilege('authenticated',removed,'execute') then
      raise exception 'Privileges changed on %',removed;
    end if;
  end loop;
end $$;
rollback;
\echo RESEARCH_MODE_REMOVAL_SQL_PASS
