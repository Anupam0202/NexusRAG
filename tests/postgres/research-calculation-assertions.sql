\set ON_ERROR_STOP on
set request.jwt.claim.role = 'service_role';
do $$
declare
  ctx jsonb; plan_id uuid; command jsonb; result jsonb; saved jsonb; again jsonb; item jsonb; n integer;
begin
  select jsonb_build_object('workspace_id',w.id,'user_id','22222222-2222-4222-8222-222222222222',
    'membership_revision',w.capability_revision,'policy_id',s.active_policy_id,'policy_version',s.policy_version,
    'deadline',clock_timestamp()+interval '5 minutes') into ctx from public.workspaces w
    join public.workspace_settings s on s.workspace_id=w.id where w.id='11111111-1111-4111-8111-111111111111';
  select id into strict plan_id from public.research_plans where plan->>'plan_id'='mode-CALCULATION';
  command='{"operation":"ADD","precision":2,"left":{"value":"9007199254740993.1","unit":"USD","evidence_ids":["source-a"]},"right":{"value":"0.2","unit":"USD","evidence_ids":["source-a","source-b"]}}';
  saved=public.nexus_research_calculation(ctx,'create',plan_id,command,'synthetic-calculation');
  if saved->'result'->>'value'<>'9007199254740993.30' or saved->>'persistence_state'<>'PERSISTED'
    or saved->>'input_evidence_state'<>'CALLER_ASSERTED_NOT_VERIFIED' or saved->'input'<>command
    or saved->'result'->'evidence_ids'<>'["source-a","source-b"]'::jsonb then raise exception 'Exact result/lineage was lost'; end if;
  again=public.nexus_research_calculation(ctx,'create',plan_id,command,'synthetic-calculation');
  if again->>'id'<>saved->>'id' then raise exception 'Calculation replay duplicated the result'; end if;
  if public.nexus_research_calculation(ctx,'list',plan_id)->'items'->0<>saved then raise exception 'Stored calculation cannot be reloaded'; end if;
  begin
    perform public.nexus_research_calculation(ctx,'create',plan_id,jsonb_set(command,'{precision}','3'),'synthetic-calculation');
    raise exception 'Changed retry overwrote result';
  exception when others then if sqlerrm<>'NR:VERSION_CONFLICT' then raise; end if; end;
  for item in select value from jsonb_array_elements('[
    ["ADD","0.1","0.2",2,"0.30"], ["SUBTRACT","3","1",2,"2.00"],
    ["DIFFERENCE","1","3",2,"-2.00"], ["MULTIPLY","0.2","3",3,"0.600"],
    ["DIVIDE","1","3",18,"0.333333333333333333"], ["RATIO","2","4",2,"0.50"],
    ["PERCENT_CHANGE","100","125",2,"25.00"], ["DIVIDE","1","8",2,"0.12"],
    ["DIVIDE","3","8",2,"0.38"], ["DIVIDE","-1","8",2,"-0.12"],
    ["DIVIDE","-3","8",2,"-0.38"], ["ADD","2.5","0",0,"2"],
    ["ADD","3.5","0",0,"4"]
  ]'::jsonb) loop
    result=public.nexus_calculate_binary(jsonb_build_object('operation',item->>0,'precision',item->3,
      'left',jsonb_build_object('value',item->>1,'unit','USD','evidence_ids','["source"]'::jsonb),
      'right',jsonb_build_object('value',item->>2,'unit','USD','evidence_ids','["source"]'::jsonb)));
    if result->>'value'<>item->>4 then raise exception 'Calculation mismatch for %: %',item,result; end if;
  end loop;
  result=public.nexus_calculate_binary(jsonb_set(jsonb_set(jsonb_set(command,'{operation}','"MULTIPLY"'),'{left,value}','"1e128"'),'{right,value}','"1e128"'));
  if result->>'value'<>'1'||repeat('0',256)||'.00' then raise exception 'Large exact product was truncated'; end if;
  select count(*) into n from public.research_calculations;
  begin
    perform public.nexus_research_calculation(ctx,'create',plan_id,jsonb_set(jsonb_set(command,'{operation}','"DIVIDE"'),'{right,value}','"0"'),'undefined');
    raise exception 'Zero denominator was accepted';
  exception when others then if sqlerrm<>'NR:CALCULATION_INVALID' then raise; end if; end;
  begin
    perform public.nexus_research_calculation(ctx,'create',plan_id,jsonb_set(command,'{right,unit}','"kg"'),'mismatched-unit');
    raise exception 'Incompatible units were accepted';
  exception when others then if sqlerrm<>'NR:CALCULATION_INVALID' then raise; end if; end;
  if (select count(*) from public.research_calculations)<>n then raise exception 'Invalid calculation left a saved row'; end if;
  for item in select value from jsonb_array_elements('["NaN","Infinity","1e129","1e-129","1e999","0x10",null,0.1]'::jsonb) loop
    begin
      perform public.nexus_research_calculation(ctx,'create',plan_id,jsonb_set(command,'{left,value}',item),'invalid-input');
      raise exception 'Unsupported numeric input was accepted: %',item;
    exception when others then if sqlerrm<>'NR:INVALID_SCOPE' then raise; end if; end;
  end loop;
  begin
    insert into public.research_calculations(workspace_id,owner_id,plan_id,input,result,idempotency_key,payload_hash)
      select (saved->>'workspace_id')::uuid,(saved->>'owner_id')::uuid,plan_id,command,saved->'result','capacity-'||i,repeat('a',64) from generate_series(1,100) i;
    perform public.nexus_research_calculation(ctx,'create',plan_id,command,'beyond-capacity');
    raise exception 'Calculation storage capacity was ignored';
  exception when others then if sqlerrm<>'NR:TENANT_QUOTA_EXCEEDED' then raise; end if; end;
  if (select count(*) from public.research_calculations)<>n then raise exception 'Rejected calculation or capacity test left a row'; end if;
end; $$;
select 'RESEARCH_CALCULATION_SQL_PASS: exact decimals/seven operations/half-even/lineage/retry/conflict/reload/undefined rollback';
