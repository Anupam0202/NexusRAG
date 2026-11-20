\set ON_ERROR_STOP on
set request.jwt.claim.role = 'service_role';
do $$
declare ctx jsonb; plan jsonb; subject jsonb; receipt jsonb; replay jsonb; invalid jsonb; before_count bigint;
begin
  select jsonb_build_object('workspace_id',w.id,'user_id','22222222-2222-4222-8222-222222222222',
    'membership_revision',w.capability_revision,'policy_id',s.active_policy_id,'policy_version',s.policy_version,
    'deadline',clock_timestamp()+interval '5 minutes') into ctx
    from public.workspaces w join public.workspace_settings s on s.workspace_id=w.id where w.id='11111111-1111-4111-8111-111111111111';
  select r.plan||'{"plan_id":"passport-subject-055","mode":"PRODUCT_PASSPORT"}'::jsonb into plan
    from public.research_plans r where r.plan_id='real-synthetic-plan';
  subject=jsonb_build_object('product_id','synthetic-sensor-42','product_name',repeat(chr(128202),256),'product_version','2.1','supplier','Synthetic supplier');
  plan=plan||jsonb_build_object('passport_subject',subject);
  receipt=public.nexus_research_plan(ctx,'create',p_plan=>plan,p_key=>'passport-subject-055');
  if receipt->'plan'<>plan then raise exception 'Declared identity was dropped or changed'; end if;
  replay=public.nexus_research_plan(ctx,'create',p_plan=>plan,p_key=>'passport-subject-055');
  if replay->>'id'<>receipt->>'id' then raise exception 'Retry created another product draft'; end if;
  if public.nexus_research_plan(ctx,'read',(receipt->>'id')::uuid)->'plan'<>plan then raise exception 'Declared identity did not reload'; end if;
  begin
    perform public.nexus_research_plan(ctx,'create',p_plan=>jsonb_set(plan,'{passport_subject,product_version}','"3.0"'),p_key=>'passport-subject-055');
    raise exception 'Changed product version overwrote the retry';
  exception when others then if sqlerrm<>'NR:VERSION_CONFLICT' then raise; end if; end;
  before_count=(select count(*) from public.research_plans);
  for invalid in select value from jsonb_array_elements(jsonb_build_array('null'::jsonb,'[]'::jsonb,'{}'::jsonb,
    subject-'supplier',subject||'{"verified":true}',subject||'{"product_version":" "}',subject||jsonb_build_object('supplier',repeat('x',257)),
    subject||jsonb_build_object('product_name',repeat(chr(128202),257)),subject||jsonb_build_object('supplier',chr(160)))) loop
    begin
      perform public.nexus_research_plan(ctx,'create',p_plan=>plan||jsonb_build_object('passport_subject',invalid),p_key=>'invalid-passport-055');
      raise exception 'Invalid subject persisted';
    exception when others then if sqlerrm<>'NR:INVALID_SCOPE' then raise; end if; end;
  end loop;
  begin
    perform public.nexus_research_plan(ctx,'create',p_plan=>plan||'{"mode":"QUICK_LOOKUP"}',p_key=>'wrong-mode-passport-055');
    raise exception 'Passport identity attached to unrelated mode';
  exception when others then if sqlerrm<>'NR:INVALID_SCOPE' then raise; end if; end;
  if (select count(*) from public.research_plans)<>before_count then raise exception 'Invalid draft left a record'; end if;
  perform public.nexus_research_plan_limits(plan-'passport_subject');
end; $$;
select 'RESEARCH_PASSPORT_SUBJECT_SQL_PASS: declared identity/persistence/read/replay/version-conflict/Unicode/bounds/legacy; no execution';
