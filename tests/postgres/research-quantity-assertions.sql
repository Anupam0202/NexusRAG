\set ON_ERROR_STOP on
set request.jwt.claim.role='service_role';
do $$
declare ctx jsonb;plan_id uuid;command jsonb;receipt jsonb;page jsonb;replay jsonb;source_text text=U&'\+01F4CA mass: 1.005 kg; other mass 9 kg. Factor 1000 g/kg';
  doc uuid='d0280000-0000-4000-8000-000000000001';ver uuid='d0280000-0000-4000-8000-000000000002';
  source_chunk uuid='d0280000-0000-4000-8000-000000000003';base_plan jsonb;n integer;calculation jsonb;calculated jsonb;factor_input jsonb;factor_record jsonb;
begin
  select jsonb_build_object('workspace_id',w.id,'user_id','22222222-2222-4222-8222-222222222222',
    'membership_revision',w.capability_revision,'policy_id',s.active_policy_id,'policy_version',s.policy_version,
    'deadline',clock_timestamp()+interval '5 minutes') into ctx from public.workspaces w join public.workspace_settings s on s.workspace_id=w.id
    where w.id='11111111-1111-4111-8111-111111111111';
  select plan into strict base_plan from public.research_plans where plan->>'plan_id'='mode-CALCULATION';
  plan_id=(public.nexus_research_plan(ctx,'create',p_plan=>base_plan||jsonb_build_object('plan_id','source-quantity','private_source_ids',jsonb_build_array(upper(doc::text))),p_key=>'source-quantity')->>'id')::uuid;
  insert into public.documents(id,workspace_id,uploaded_by,filename,original_filename,status,chunk_count)
    values(doc,'11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','quantity.txt','quantity.txt','ready',1);
  insert into public.document_versions(id,workspace_id,document_id,original_bucket,original_key,original_hash,original_bytes,
    original_verified_at,parser_version,chunker_version,lifecycle_epoch,publication_state,index_generation)
    values(ver,'11111111-1111-4111-8111-111111111111',doc,'documents','synthetic-quantity',repeat('a',64),1,now(),'synthetic','synthetic',1,'ready','quantity-generation');
  update public.documents set active_version_id=ver where id=doc;
  insert into public.document_chunks(id,workspace_id,document_id,version_id,chunk_index,content,original_text,original_content_hash,page_number,location,embedding_space_id)
    values(source_chunk,'11111111-1111-4111-8111-111111111111',doc,ver,0,source_text,source_text,encode(sha256(convert_to(source_text,'UTF8')),'hex'),2,'{"page":2,"section":"mass"}','synthetic-space');
  command=jsonb_build_object('document_id',doc,'version_id',ver,'chunk_index',0,'original_content_hash',encode(sha256(convert_to(source_text,'UTF8')),'hex'),
    'value_span',jsonb_build_object('start',position('1.005' in source_text)-1,'end',position('1.005' in source_text)+4),
    'unit_span',jsonb_build_object('start',position('kg' in source_text)-1,'end',position('kg' in source_text)+1));
  receipt=public.nexus_research_quantity(ctx,'create',plan_id,command,'source-quantity');
  if receipt->'quantity'->>'value'<>'1.005' or receipt->'quantity'->>'unit'<>'kg' or receipt->'source'->>'page_number'<>'2'
    or receipt->>'source_state'<>'SOURCE_SPANS_MATCHED_REVIEW_REQUIRED' or receipt->>'freshness'<>'current'
    or receipt->'input'<>command or receipt->'quantity'->'evidence_ids'<>jsonb_build_array('urn:nexusrag:quantity:'||(receipt->>'id'))
    then raise exception 'Exact source quantity/Unicode locator/receipt mismatch';end if;
  replay=public.nexus_research_quantity(ctx,'create',plan_id,command,'source-quantity');
  if receipt<>replay then raise exception 'Quantity retry duplicated or changed record';end if;
  replay=public.nexus_research_quantity(ctx,'create',plan_id,jsonb_set(command,'{document_id}',to_jsonb(upper(doc::text))),'source-quantity');
  if receipt<>replay then raise exception 'Equivalent source UUID casing changed the stored capture';end if;
  begin
    perform public.nexus_research_quantity(ctx,'create',plan_id,jsonb_set(command,'{value_span,start}',to_jsonb((command->'value_span'->>'start')::integer+1)),'numeric-fragment');
    raise exception 'Numeric fragment was offered as the complete source number';
  exception when others then if sqlerrm<>'NR:CALCULATION_INVALID' then raise;end if;end;
  page=public.nexus_research_quantity(ctx,'list',plan_id);
  if page->'items'->0<>receipt then raise exception 'Quantity reload lost source details';end if;
  calculation=jsonb_build_object('operation','ADD','left',receipt->'quantity','right',receipt->'quantity','precision',3);
  calculated=public.nexus_research_calculation(ctx,'create',plan_id,calculation,'captured-quantity-calculation');
  if calculated->'result'->>'value'<>'2.010' then raise exception 'Captured quantity did not execute exact arithmetic';end if;
  calculated=public.nexus_research_calculation(ctx,'create',plan_id,jsonb_set(calculation,'{left,evidence_ids}',jsonb_build_array(upper(receipt->'quantity'->'evidence_ids'->>0))),'captured-uri-case');
  if calculated->'result'->>'value'<>'2.010' then raise exception 'Equivalent source identifier casing changed arithmetic';end if;
  begin
    perform public.nexus_research_calculation(ctx,'create',plan_id,jsonb_set(calculation,'{left,value}','"2"'),'changed-capture-value');
    raise exception 'Changed numeric input silently retained source binding';
  exception when others then if sqlerrm<>'NR:QUANTITY_MISMATCH' then raise;end if;end;
  begin
    perform public.nexus_research_quantity(ctx,'create',plan_id,jsonb_set(command,'{value_span,end}','12'),'source-quantity');
    raise exception 'Changed span overwrote capture';
  exception when others then if sqlerrm<>'NR:VERSION_CONFLICT' then raise;end if;end;
  for n in 1..3 loop perform public.nexus_research_quantity(ctx,'create',plan_id,command,'quantity-page-'||n);end loop;
  page=public.nexus_research_quantity(ctx,'list',plan_id,null,null,2);
  replay=public.nexus_research_quantity(ctx,'list',plan_id,null,null,2,(page->>'next_after')::uuid);
  if jsonb_array_length(page->'items')<>2 or jsonb_array_length(replay->'items')<>2 or replay->>'next_after' is not null
    or exists(select 1 from jsonb_array_elements(page->'items') a cross join jsonb_array_elements(replay->'items') b where a->>'id'=b->>'id') then raise exception 'Quantity pagination lost/repeated records';end if;
  calculated=public.nexus_research_aggregation(ctx,'create',plan_id,jsonb_build_object('operation','SUM','values',jsonb_build_array(receipt->'quantity'),
    'weights','[]'::jsonb,'grouped',false,'missing_value_treatment','REJECT','precision',3),'captured-series');
  if calculated->'result'->'groups'->0->>'value'<>'1.005' then raise exception 'Captured quantity failed aggregate arithmetic';end if;
  factor_input=command||jsonb_build_object('value_span',jsonb_build_object('start',position('1000' in source_text)-1,'end',position('1000' in source_text)+3),
    'unit_span',jsonb_build_object('start',position('g/kg' in source_text)-1,'end',position('g/kg' in source_text)+3));
  factor_record=public.nexus_research_quantity(ctx,'create',plan_id,factor_input,'captured-factor');
  calculated=public.nexus_research_conversion(ctx,'create',plan_id,jsonb_build_object('quantity',receipt->'quantity','factor','1000','target_unit','g',
    'conversion_evidence_id',factor_record->'quantity'->'evidence_ids'->>0,'factor_effective_on',null,'precision',2),'captured-conversion');
  if calculated->'result'->>'value'<>'1005.00' then raise exception 'Captured quantity and factor failed conversion arithmetic';end if;
  update public.documents set active_version_id=null where id=doc;
  page=public.nexus_research_quantity(ctx,'list',plan_id);
  if page->'items'->0->>'freshness'<>'stale' then raise exception 'Changed active version was not marked stale';end if;
  begin
    perform public.nexus_research_calculation(ctx,'create',plan_id,calculation,'stale-source-calculation');raise exception 'Stale source was used as current capture';
  exception when others then if sqlerrm<>'NR:SOURCE_UNAVAILABLE' then raise;end if;end;
  update public.documents set active_version_id=ver where id=doc;
  update public.document_versions set publication_state='failed' where id=ver;
  page=public.nexus_research_quantity(ctx,'list',plan_id);
  if page->'items'->0->>'source_state'<>'SOURCE_UNAVAILABLE' or page->'items'->0->'quantity'<>'null'::jsonb or page->'items'->0->'source'<>'null'::jsonb then raise exception 'Unavailable source still presented as usable';end if;
  update public.document_versions set publication_state='ready' where id=ver;
end; $$;
select 'RESEARCH_QUANTITY_SQL_PASS: exact stored Unicode spans/units/locators/retry/reload/conflict/paging/stale/unavailable';

begin;
delete from public.document_chunks where id='d0280000-0000-4000-8000-000000000003';
do $$begin
  if exists(select 1 from public.research_quantities where chunk_id='d0280000-0000-4000-8000-000000000003') then raise exception 'Removed source left captured numeric copies';end if;
end; $$;
rollback;
select 'RESEARCH_QUANTITY_SOURCE_CASCADE_PASS: owned synthetic source removal cascades captures; transaction rolled back';

begin;
do $$
declare ctx jsonb;capture public.research_quantities%rowtype;n integer;replay jsonb;
begin
  select * into strict capture from public.research_quantities where idempotency_key='source-quantity';
  select jsonb_build_object('workspace_id',w.id,'user_id',capture.owner_id,'membership_revision',w.capability_revision,
    'policy_id',s.active_policy_id,'policy_version',s.policy_version,'deadline',clock_timestamp()+interval '5 minutes') into ctx
    from public.workspaces w join public.workspace_settings s on s.workspace_id=w.id where w.id=capture.workspace_id;
  select count(*) into n from public.research_quantities where plan_id=capture.plan_id;
  while n<100 loop
    perform public.nexus_research_quantity(ctx,'create',capture.plan_id,capture.input,'quantity-cap-'||n);n=n+1;
  end loop;
  replay=public.nexus_research_quantity(ctx,'create',capture.plan_id,capture.input,capture.idempotency_key);
  if (replay->>'id')::uuid<>capture.id then raise exception 'Retry at capacity lost the committed capture';end if;
  begin
    perform public.nexus_research_quantity(ctx,'create',capture.plan_id,capture.input,'quantity-over-cap');
    raise exception 'Capture exceeded the bounded plan capacity';
  exception when others then if sqlerrm<>'NR:TENANT_QUOTA_EXCEEDED' then raise;end if;end;
end; $$;
rollback;
select 'RESEARCH_QUANTITY_CAPACITY_PASS: replay at100 and new capture rejection; synthetic transaction rolled back';
