-- Remove the Product Passport and Procurement Research run modes (NX-15, the owner's decision D11 of 2026-11-20).
--
-- The gateway and the app no longer offer either mode; the database now refuses them too.
--   * Research runs accept only the ten remaining modes, and plan limits refuse the two removed ones.
--   * Each research function that was wrapped for them goes back to the layer it wrapped: the layer above keeps
--     calling the same name, which now names the layer beneath Product Passport.
--   * Plan limits lose the declared Product Passport subject.
--   * The two mode contracts are dropped.
-- Nothing is deleted: the migration stops, changing nothing, while any plan or run of either mode exists.

begin;

do $$
begin
  if exists(select 1 from public.research_runs where mode in('PRODUCT_PASSPORT','PROCUREMENT_RESEARCH'))
    or exists(select 1 from public.research_plans where plan->>'mode' in('PRODUCT_PASSPORT','PROCUREMENT_RESEARCH')) then
    raise exception 'Product Passport or Procurement Research plans or runs still exist; this migration deletes none.';
  end if;
end $$;

alter table public.research_runs drop constraint research_runs_mode_check,
  drop constraint research_runs_questions_check,drop constraint research_runs_source_snapshot_check,
  drop constraint research_runs_results_check,drop constraint research_runs_position_check;
alter table public.research_runs
  add constraint research_runs_mode_check check(mode in('QUICK_LOOKUP','EVIDENCE_ANSWER','COMPARE','TIMELINE','CONTRADICTION_ANALYSIS','DEEP_RESEARCH','OBLIGATION_ANALYSIS','ENTITY_INVESTIGATION','DUE_DILIGENCE','CALCULATION')),
  add constraint research_runs_questions_check check(jsonb_typeof(questions)='array' and jsonb_array_length(questions) between 1 and
    case when mode in('DEEP_RESEARCH','DUE_DILIGENCE') then 13 when mode in('CONTRADICTION_ANALYSIS','OBLIGATION_ANALYSIS','ENTITY_INVESTIGATION') then 11 when mode in('COMPARE','TIMELINE') then 9 when mode='CALCULATION' then 7 else 5 end),
  add constraint research_runs_source_snapshot_check check(jsonb_typeof(source_snapshot)='array' and jsonb_array_length(source_snapshot) between
    case when mode='COMPARE' then 2 else 1 end and case when mode in('DEEP_RESEARCH','DUE_DILIGENCE') then 60 when mode in('CONTRADICTION_ANALYSIS','OBLIGATION_ANALYSIS','ENTITY_INVESTIGATION') then 50 when mode in('COMPARE','TIMELINE') then 40 when mode='CALCULATION' then 30 else 20 end),
  add constraint research_runs_results_check check(jsonb_typeof(results)='array' and octet_length(results::text)<=
    case when mode='DUE_DILIGENCE' then 13001000 when mode in('OBLIGATION_ANALYSIS','ENTITY_INVESTIGATION') then 11000000 when mode='CALCULATION' then 7000000 when mode in('COMPARE','TIMELINE','CONTRADICTION_ANALYSIS','DEEP_RESEARCH') then 3500000 else 400000 end),
  add constraint research_runs_position_check check(position between 0 and case when mode in('DEEP_RESEARCH','DUE_DILIGENCE') then 13 when mode in('CONTRADICTION_ANALYSIS','OBLIGATION_ANALYSIS','ENTITY_INVESTIGATION') then 11 when mode in('COMPARE','TIMELINE') then 45 when mode='CALCULATION' then 7 else 5 end
    and position=jsonb_array_length(results));

-- Layers, outermost first, before this migration (each calls the next by name; _passport_v1 is Due Diligence's layer):
--   nexus_research_run_view: calculation -> _calculation_v1 (Product Passport) -> _passport_v1
--   nexus_research_run, nexus_research_step, nexus_finding:
--     calculation -> _calculation_v1 (Procurement) -> _procurement_v1 (Product Passport) -> _passport_v1
--   nexus_research_finding_view: calculation -> _calculation_v1 (Radar) -> _before_radar (Procurement)
--     -> _procurement_v1 (Product Passport) -> _passport_v1
--   nexus_research_candidates: the public name (Procurement) -> _procurement_v1 (Product Passport) -> _passport_v1
drop function public.nexus_research_run_view_calculation_v1(public.research_runs);
alter function public.nexus_research_run_view_passport_v1(public.research_runs) rename to nexus_research_run_view_calculation_v1;

drop function public.nexus_research_run_calculation_v1(jsonb,text,uuid,uuid,text,jsonb,integer,uuid);
drop function public.nexus_research_run_procurement_v1(jsonb,text,uuid,uuid,text,jsonb,integer,uuid);
alter function public.nexus_research_run_passport_v1(jsonb,text,uuid,uuid,text,jsonb,integer,uuid) rename to nexus_research_run_calculation_v1;

drop function public.nexus_research_step_calculation_v1(jsonb,text,uuid,integer,integer,uuid,jsonb,text);
drop function public.nexus_research_step_procurement_v1(jsonb,text,uuid,integer,integer,uuid,jsonb,text);
alter function public.nexus_research_step_passport_v1(jsonb,text,uuid,integer,integer,uuid,jsonb,text) rename to nexus_research_step_calculation_v1;

drop function public.nexus_research_finding_view_before_radar(jsonb,uuid);
drop function public.nexus_research_finding_view_procurement_v1(jsonb,uuid);
alter function public.nexus_research_finding_view_passport_v1(jsonb,uuid) rename to nexus_research_finding_view_before_radar;

drop function public.nexus_finding_calculation_v1(jsonb,text,uuid,jsonb,bigint,text,text);
drop function public.nexus_finding_procurement_v1(jsonb,text,uuid,jsonb,bigint,text,text);
alter function public.nexus_finding_passport_v1(jsonb,text,uuid,jsonb,bigint,text,text) rename to nexus_finding_calculation_v1;

drop function public.nexus_research_candidates(jsonb,uuid,integer,integer,uuid[]);
drop function public.nexus_research_candidates_procurement_v1(jsonb,uuid,integer,integer,uuid[]);
alter function public.nexus_research_candidates_passport_v1(jsonb,uuid,integer,integer,uuid[]) rename to nexus_research_candidates;

drop function public.nexus_research_passport_contract();
drop function public.nexus_research_procurement_contract();

-- The limits of 20261014194036_research_plan_persistence.sql without the two modes, in place of the Product
-- Passport subject layer that wrapped them.
create or replace function public.nexus_research_plan_limits(p_plan jsonb)
returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  caps integer[]; field text; value jsonb; from_date date; to_date date;
begin
  if jsonb_typeof(p_plan) is distinct from 'object' or octet_length(p_plan::text)>100000 then raise exception 'NR:INVALID_SCOPE'; end if;
  caps = case p_plan->>'mode'
    when 'QUICK_LOOKUP' then array[1,8,2,30,0]
    when 'EVIDENCE_ANSWER' then array[4,20,4,90,0]
    when 'DEEP_RESEARCH' then array[12,60,8,600,1]
    when 'COMPARE' then array[8,40,6,300,1]
    when 'TIMELINE' then array[8,40,6,300,1]
    when 'CONTRADICTION_ANALYSIS' then array[10,50,8,420,1]
    when 'CALCULATION' then array[6,30,4,180,1]
    when 'OBLIGATION_ANALYSIS' then array[10,50,8,420,1]
    when 'ENTITY_INVESTIGATION' then array[10,50,8,420,1]
    when 'DUE_DILIGENCE' then array[12,60,8,600,1] else null end;
  if caps is null or jsonb_typeof(p_plan->'plan_id') is distinct from 'string' or length(btrim(p_plan->>'plan_id')) not between 1 and 128
    or jsonb_typeof(p_plan->'question') is distinct from 'string' or length(btrim(p_plan->>'question')) not between 1 and 10000 then raise exception 'NR:INVALID_SCOPE'; end if;
  foreach field in array array['subquestions','private_source_ids','public_provider_ids','entity_scope','rights_constraints','expected_calculations','completion_criteria'] loop
    if jsonb_typeof(p_plan->field) is distinct from 'array' then raise exception 'NR:INVALID_SCOPE'; end if;
    for value in select entry from jsonb_array_elements(p_plan->field) as items(entry) loop
      if jsonb_typeof(value) is distinct from 'string' or length(btrim(value#>>'{}')) < 1
        or length(value#>>'{}') > (case when field='subquestions' then 10000 when field in('private_source_ids','public_provider_ids','entity_scope') then 128 else 1000 end) then raise exception 'NR:INVALID_SCOPE'; end if;
    end loop;
  end loop;
  if jsonb_array_length(p_plan->'subquestions')>caps[1]
    or jsonb_array_length(p_plan->'private_source_ids')+jsonb_array_length(p_plan->'public_provider_ids')>caps[2]
    or jsonb_array_length(p_plan->'entity_scope')>100 or jsonb_array_length(p_plan->'rights_constraints')>100
    or jsonb_array_length(p_plan->'expected_calculations')>50 or jsonb_array_length(p_plan->'completion_criteria') not between 1 and 50
    or (jsonb_array_length(p_plan->'public_provider_ids')>0 and jsonb_array_length(p_plan->'rights_constraints')=0) then raise exception 'NR:INVALID_SCOPE'; end if;
  foreach field in array array['date_from','date_to'] loop
    if p_plan->field is distinct from 'null'::jsonb and (jsonb_typeof(p_plan->field) is distinct from 'string' or (p_plan->>field)!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$') then raise exception 'NR:INVALID_SCOPE'; end if;
  end loop;
  begin
    from_date=(p_plan->>'date_from')::date; to_date=(p_plan->>'date_to')::date;
  exception when datetime_field_overflow or invalid_datetime_format then raise exception 'NR:INVALID_SCOPE'; end;
  if to_date<from_date or (p_plan->'jurisdiction' is distinct from 'null'::jsonb and (jsonb_typeof(p_plan->'jurisdiction') is distinct from 'string' or length(btrim(p_plan->>'jurisdiction')) not between 1 and 128)) then raise exception 'NR:INVALID_SCOPE'; end if;
  return jsonb_build_object('max_subquestions',caps[1],'max_sources',caps[2],'max_query_variants',caps[3],'max_runtime_seconds',caps[4],'requires_review',caps[5]=1);
end; $$;
drop function public.nexus_research_plan_limits_before_passport_subject(jsonb);

-- Renaming keeps each function's privileges; restating them keeps the intent visible.
revoke all on function public.nexus_research_plan_limits(jsonb),
  public.nexus_research_run_view_calculation_v1(public.research_runs),
  public.nexus_research_run_calculation_v1(jsonb,text,uuid,uuid,text,jsonb,integer,uuid),
  public.nexus_research_step_calculation_v1(jsonb,text,uuid,integer,integer,uuid,jsonb,text),
  public.nexus_research_finding_view_before_radar(jsonb,uuid),
  public.nexus_finding_calculation_v1(jsonb,text,uuid,jsonb,bigint,text,text),
  public.nexus_research_candidates(jsonb,uuid,integer,integer,uuid[]) from public,anon,authenticated;
grant execute on function public.nexus_research_plan_limits(jsonb),
  public.nexus_research_run_view_calculation_v1(public.research_runs),
  public.nexus_research_run_calculation_v1(jsonb,text,uuid,uuid,text,jsonb,integer,uuid),
  public.nexus_research_step_calculation_v1(jsonb,text,uuid,integer,integer,uuid,jsonb,text),
  public.nexus_research_finding_view_before_radar(jsonb,uuid),
  public.nexus_finding_calculation_v1(jsonb,text,uuid,jsonb,bigint,text,text),
  public.nexus_research_candidates(jsonb,uuid,integer,integer,uuid[]) to service_role;

commit;
