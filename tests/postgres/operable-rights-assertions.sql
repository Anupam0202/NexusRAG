\set ON_ERROR_STOP on
-- Provider approval and budgets must work on a database that holds only what the migrations create, with
-- every call made the way the gateway makes it: as the service role.
begin;
set local request.jwt.claims = '{"role":"service_role"}';
set local request.jwt.claim.role = 'service_role';
-- Start from what a migrated database contains: no review, no approval and no budget rows for Qdrant.
delete from public.budget_reservations where provider_id = 'qdrant';
delete from public.resource_budgets where provider_id = 'qdrant';
delete from public.workspace_provider_policies where provider_id = 'qdrant';
update auth.users set email_confirmed_at = now() where id = '22222222-2222-4222-8222-222222222222';
set local role service_role;
do $$
declare
  w constant uuid := '11111111-1111-4111-8111-111111111111';
  a constant uuid := '22222222-2222-4222-8222-222222222222';
  r jsonb; first jsonb; second jsonb; n bigint; boundary timestamptz;
begin
  -- 1. Nothing is approved by migration: an unreviewed provider is blocked with a reason.
  if public.nexus_provider_rights_current('qdrant') then raise exception 'qdrant was approved without a review'; end if;
  r := public.v6_reserve_many(w, 'qdrant', '{"requests":1}', 'operable-unreviewed', 'interactive', 'provider_operation', 'unknown');
  if r->>'state' <> 'RIGHTS_BLOCKED' or r->>'reason' <> 'PROVIDER_REVIEW_REQUIRED' then raise exception 'unreviewed provider admitted: %', r; end if;

  -- 2. Only a confirmed account can be recorded as the reviewer, and the review makes the provider usable.
  begin
    perform public.nexus_record_provider_review('qdrant', 'nobody@example.invalid', 'https://qdrant.tech/legal/terms_and_conditions/', repeat('e', 64), '{}');
    raise exception 'unknown reviewer accepted';
  exception when raise_exception then if sqlerrm <> 'NR:INVALID_SCOPE' then raise; end if; end;
  begin
    perform public.nexus_record_provider_review('qdrant', 'a@example.invalid', 'http://insecure.example/terms', repeat('e', 64), '{}');
    raise exception 'insecure terms address accepted';
  exception when raise_exception then if sqlerrm <> 'NR:INVALID_SCOPE' then raise; end if; end;
  r := public.nexus_record_provider_review('qdrant', 'a@example.invalid', 'https://qdrant.tech/legal/terms_and_conditions/', repeat('e', 64), '{"source":"fixture"}');
  if r->>'terms_changed' <> 'true' or (r->>'revision')::int <> 1 then raise exception 'review not recorded: %', r; end if;
  if not public.nexus_provider_rights_current('qdrant') then raise exception 'recorded review is not current'; end if;

  -- 3. Infrastructure providers need no workspace approval, and budget rows appear from the defaults.
  first := public.v6_reserve_many(w, 'qdrant', '{"requests":2,"vectors":3}', 'operable-first', 'interactive', 'provider_operation', 'unknown');
  if first->>'state' <> 'READY' then raise exception 'reviewed infrastructure provider denied: %', first; end if;
  boundary := (date_trunc('day', now() at time zone 'utc') + interval '1 day') at time zone 'utc';
  select count(*) into n from public.resource_budgets
   where provider_id = 'qdrant' and window_kind = 'daily' and reset_at = boundary
     and ((scope_key = 'global' and hard_limit in (50000)) or (scope_key = 'workspace:' || w and hard_limit in (5000)));
  if n <> 4 then raise exception 'budget rows were not created from the defaults: %', n; end if;
  if (select reserved from public.resource_budgets where scope_key = 'global' and provider_id = 'qdrant' and dimension = 'vectors') <> 3 then
    raise exception 'reservation not counted'; end if;
  r := public.v6_reserve_many(w, 'qdrant', '{"mystery_units":1}', 'operable-unknown-dimension', 'interactive', 'provider_operation', 'unknown');
  if r->>'state' <> 'REVIEW_REQUIRED' or r->>'reason' <> 'BUDGET_NOT_CONFIGURED' then raise exception 'unknown dimension admitted: %', r; end if;

  -- 4. A finished daily window opens again by itself; what was left open in it is closed, not carried over.
  update public.resource_budgets set used = hard_limit, reset_at = now() - interval '1 minute' where provider_id = 'qdrant';
  update public.budget_reservations set reset_at = now() - interval '1 minute', global_reset_at = now() - interval '1 minute'
   where idempotency_key like 'operable-first:%';
  second := public.v6_reserve_many(w, 'qdrant', '{"requests":1}', 'operable-second', 'interactive', 'provider_operation', 'unknown');
  if second->>'state' <> 'READY' then raise exception 'finished window did not reopen: %', second; end if;
  if (select count(*) from public.resource_budgets where provider_id = 'qdrant' and dimension = 'requests'
       and used = 0 and reserved = 1 and reset_at = boundary) <> 2 then raise exception 'window counters not reset'; end if;
  if (select state from public.budget_reservations where idempotency_key = 'operable-first:requests') <> 'EXPIRED' then
    raise exception 'reservation from the finished window stayed open'; end if;
  -- A late settlement of that reservation succeeds and leaves the new window alone.
  if public.v6_settle_many(jsonb_build_array(first->'reservations'->0), true)->>'state' <> 'SETTLED' then
    raise exception 'late settlement failed'; end if;
  if (select count(*) from public.resource_budgets where provider_id = 'qdrant' and dimension = 'requests' and used = 0 and reserved = 1) <> 2 then
    raise exception 'late settlement changed the new window'; end if;
  -- A dimension nobody has reserved since the window ended is still closed lazily on its next use.
  if (select reset_at from public.resource_budgets where scope_key = 'global' and provider_id = 'qdrant' and dimension = 'vectors') > now() then
    raise exception 'unused dimension was reopened early'; end if;
  if public.v6_settle_many(second->'reservations', true)->>'state' <> 'SETTLED' then raise exception 'settlement failed'; end if;
  if (select count(*) from public.resource_budgets where provider_id = 'qdrant' and dimension = 'requests' and used = 1 and reserved = 0) <> 2 then
    raise exception 'usage not recorded after settlement'; end if;

  -- 5. Gemini still needs the owner's approval of the reviewed terms; a new review asks the owner again.
  r := public.v6_reserve_many(w, 'gemini', '{"requests":1}', 'operable-gemini-ok', 'interactive', 'gemini_non_sensitive', 'non_sensitive');
  if r->>'state' <> 'READY' then raise exception 'approved Gemini processing denied: %', r; end if;
  perform public.v6_settle_many(r->'reservations', false);
  r := public.nexus_record_provider_review('gemini', 'a@example.invalid', 'https://ai.google.dev/gemini-api/terms', repeat('f', 64), '{"source":"fixture"}');
  if r->>'terms_changed' <> 'true' then raise exception 'terms change not reported: %', r; end if;
  r := public.v6_reserve_many(w, 'gemini', '{"requests":1}', 'operable-gemini-new-terms', 'interactive', 'gemini_non_sensitive', 'non_sensitive');
  if r->>'state' <> 'RIGHTS_BLOCKED' or r->>'reason' <> 'WORKSPACE_APPROVAL_REQUIRED' then raise exception 'old approval survived new terms: %', r; end if;
  r := public.nexus_workspace_processing_policy(w, a);
  if r->>'state' <> 'RIGHTS_BLOCKED' or r->>'operator_rights_current' <> 'true' or r->>'terms_hash' <> repeat('f', 64) then
    raise exception 'policy does not ask the owner again: %', r; end if;
  r := public.nexus_workspace_processing_policy(w, a, 'approve', repeat('f', 64), (r->>'policy_version')::bigint);
  if r->>'state' <> 'APPROVED' or (r->>'approval_expires_at') is null then raise exception 'owner approval of new terms failed: %', r; end if;
  -- Recording the same terms again keeps existing approvals.
  r := public.nexus_record_provider_review('gemini', 'a@example.invalid', 'https://ai.google.dev/gemini-api/terms', repeat('f', 64), '{"source":"fixture"}');
  if r->>'terms_changed' <> 'false' then raise exception 'unchanged terms reported as changed'; end if;
  if public.nexus_workspace_processing_policy(w, a)->>'state' <> 'APPROVED' then raise exception 'unchanged terms revoked approval'; end if;

  -- The gate the gateway reads before it accepts an upload or a question names the missing step.
  if public.nexus_processing_gate(w)->>'state' <> 'READY' then raise exception 'ready workspace was gated'; end if;
  update public.workspace_provider_policies set status = 'DISABLED' where workspace_id = w and provider_id = 'gemini';
  if public.nexus_processing_gate(w)->>'reason' <> 'WORKSPACE_APPROVAL_REQUIRED' then raise exception 'missing owner approval not named'; end if;
  update public.workspace_provider_policies set status = 'APPROVED' where workspace_id = w and provider_id = 'gemini';
  update public.provider_registry set status = 'DISABLED' where id = 'qdrant';
  if public.nexus_processing_gate(w)->>'reason' <> 'PROVIDER_REVIEW_REQUIRED' then raise exception 'missing operator review not named'; end if;
  update public.provider_registry set status = 'APPROVED' where id = 'qdrant';

  -- 6. The operator sees what is usable and when each review lapses.
  r := public.nexus_provider_rights_status();
  if jsonb_array_length(r) <> 3
     or (select count(*) from jsonb_array_elements(r) x where x->>'provider' in ('gemini', 'qdrant') and x->>'current' = 'true' and x->>'renew_soon' = 'false') <> 2
     or (select x->>'current' from jsonb_array_elements(r) x where x->>'provider' = 'supabase_storage') <> 'false' then
    raise exception 'operator status is wrong: %', r; end if;
end $$;
reset role;
-- Browser roles can use none of it.
do $$
declare name text;
begin
  for name in select unnest(array[
    'public.nexus_provider_rights_current(text)', 'public.nexus_workspace_approval_current(uuid,text,text)',
    'public.nexus_record_provider_review(text,text,text,text,jsonb)', 'public.nexus_provider_rights_status()',
    'public.nexus_open_budget_window(text,uuid,text,text)', 'public.nexus_processing_gate(uuid)']) loop
    if has_function_privilege('anon', name, 'execute') or has_function_privilege('authenticated', name, 'execute') then
      raise exception 'browser role can execute %', name; end if;
  end loop;
  if has_table_privilege('anon', 'public.provider_budget_defaults', 'select')
     or has_table_privilege('authenticated', 'public.provider_budget_defaults', 'select') then
    raise exception 'browser role can read budget defaults'; end if;
end $$;
rollback;
select 'OPERABLE_RIGHTS_AND_BUDGETS_SQL_PASS';
