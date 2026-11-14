\set ON_ERROR_STOP on
BEGIN;
-- Research/package rehearsals legitimately consume the shared workspace actors'
-- trials. Give the zero-usage account checks their own transactional principals.
INSERT INTO auth.users(id,email) VALUES
 ('a0320000-0000-4000-8000-000000000001','account-trial-a@example.invalid'),
 ('a0320000-0000-4000-8000-000000000002','account-trial-b@example.invalid');
SET ROLE service_role;
SET request.jwt.claim.role='service_role';
DO $$
DECLARE
  first_user uuid := 'a0320000-0000-4000-8000-000000000001';
  second_user uuid := 'a0320000-0000-4000-8000-000000000002';
  shared_usage jsonb;
  shared_operations jsonb;
  shared_keys jsonb;
  r jsonb;
  i integer;
BEGIN
  SELECT coalesce(jsonb_agg(to_jsonb(u) ORDER BY user_id),'[]'::jsonb)
    INTO shared_usage FROM public.nexus_account_usage u
    WHERE user_id IN ('22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333');
  SELECT coalesce(jsonb_agg(to_jsonb(o) ORDER BY user_id,operation,idempotency_key),'[]'::jsonb)
    INTO shared_operations FROM public.nexus_account_operations o
    WHERE user_id IN ('22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333');
  SELECT coalesce(jsonb_agg(to_jsonb(k) ORDER BY user_id,provider),'[]'::jsonb)
    INTO shared_keys FROM public.nexus_user_provider_keys k
    WHERE user_id IN ('22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333');
  r := public.nexus_account_entitlement_status(first_user);
  IF (r->>'free_chat_queries_used')::integer<>0
     OR (r->>'lifetime_documents_used')::integer<>0
     OR (r->>'gemini_key_configured')::boolean THEN
    RAISE EXCEPTION 'fresh trial principal is not unused: %',r;
  END IF;
  FOR i IN 1..5 LOOP
    r := public.nexus_admit_account_operation(
      first_user,'chat',('00000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid
    );
    IF r->>'state'<>'READY' OR r->>'credential_mode'<>'platform_trial'
       OR (r->>'used')::integer<>i THEN
      RAISE EXCEPTION 'unexpected chat trial admission %: %',i,r;
    END IF;
    r := public.nexus_admit_account_operation(
      first_user,'chat',('00000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid
    );
    IF coalesce((r->>'replayed')::boolean,false) IS NOT TRUE
       OR r->>'state'<>'READY' OR r->>'credential_mode'<>'platform_trial'
       OR (r->>'used')::integer<>i THEN
      RAISE EXCEPTION 'duplicate chat admission was not idempotent %: %',i,r;
    END IF;
  END LOOP;
  r := public.nexus_admit_account_operation(
    first_user,'chat','00000000-0000-4000-8000-000000000006'
  );
  IF r->>'state'<>'BYOK_REQUIRED' OR (r->>'used')::integer<>5 THEN
    RAISE EXCEPTION 'sixth chat request was not blocked: %',r;
  END IF;

  INSERT INTO public.nexus_user_provider_keys(user_id,provider,ciphertext,nonce,key_fingerprint)
    VALUES (first_user,'gemini','fixture-ciphertext','fixture-nonce','…1234');
  r := public.nexus_admit_account_operation(
    first_user,'chat','00000000-0000-4000-8000-000000000007'
  );
  IF r->>'state'<>'BYOK_REQUIRED' THEN
    RAISE EXCEPTION 'BYOK without explicit cost consent was admitted: %',r;
  END IF;
  UPDATE public.nexus_user_provider_keys
    SET cost_consent_at=clock_timestamp()
    WHERE user_id=first_user AND provider='gemini';
  r := public.nexus_admit_account_operation(
    first_user,'chat','00000000-0000-4000-8000-000000000008'
  );
  IF r->>'state'<>'READY' OR r->>'credential_mode'<>'user_byok'
     OR (r->>'used')::integer<>5 THEN
    RAISE EXCEPTION 'BYOK chat admission changed free usage incorrectly: %',r;
  END IF;
  r := public.nexus_admit_account_operation(
    first_user,'document','10000000-0000-4000-8000-000000000001'
  );
  IF r->>'state'<>'READY' OR r->>'credential_mode'<>'platform_trial'
     OR (r->>'used')::integer<>1 THEN
    RAISE EXCEPTION 'initial document trial was not admitted: %',r;
  END IF;
  r := public.nexus_admit_account_operation(
    first_user,'document','10000000-0000-4000-8000-000000000002'
  );
  IF r->>'state'<>'READY' OR r->>'credential_mode'<>'user_byok'
     OR (r->>'used')::integer<>2 THEN
    RAISE EXCEPTION 'additional document BYOK admission failed: %',r;
  END IF;
  r := public.nexus_admit_account_operation(
    first_user,'document','10000000-0000-4000-8000-000000000002'
  );
  IF coalesce((r->>'replayed')::boolean,false) IS NOT TRUE
     OR (r->>'used')::integer<>2 THEN
    RAISE EXCEPTION 'duplicate document admission was not idempotent: %',r;
  END IF;
  r := public.nexus_account_entitlement_status(second_user);
  IF (r->>'free_chat_queries_used')::integer<>0
     OR (r->>'lifetime_documents_used')::integer<>0 THEN
    RAISE EXCEPTION 'account counters are not isolated: %',r;
  END IF;
  IF has_table_privilege('authenticated','public.nexus_user_provider_keys','SELECT')
     OR has_function_privilege('authenticated','public.nexus_admit_account_operation(uuid,text,uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'client roles have access to account usage/key operations';
  END IF;
  IF (SELECT count(*) FROM pg_policies
      WHERE schemaname='public'
        AND tablename IN ('nexus_account_usage','nexus_user_provider_keys','nexus_account_operations')
        AND roles @> ARRAY['anon','authenticated']::name[]
        AND permissive='RESTRICTIVE'
        AND qual='false' AND with_check='false')<>3 THEN
    RAISE EXCEPTION 'explicit restrictive deny policies are missing';
  END IF;

  INSERT INTO public.llm_usage_events(
    workspace_id,provider,model,operation,success,cost_microusd
  ) VALUES (
    '11111111-1111-4111-8111-111111111111','gemini','fixture-model',
    'grounded_chat_byok',true,NULL
  );
  PERFORM public.reconcile_workspace_usage(
    '11111111-1111-4111-8111-111111111111',current_date
  );
  IF (SELECT estimated_cost_microusd FROM public.workspace_usage_daily
      WHERE workspace_id='11111111-1111-4111-8111-111111111111'
        AND usage_date=current_date) IS NOT NULL THEN
    RAISE EXCEPTION 'unknown BYOK spend was presented as a zero or known cost';
  END IF;
  IF shared_usage IS DISTINCT FROM (
       SELECT coalesce(jsonb_agg(to_jsonb(u) ORDER BY user_id),'[]'::jsonb)
       FROM public.nexus_account_usage u
       WHERE user_id IN ('22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333'))
     OR shared_operations IS DISTINCT FROM (
       SELECT coalesce(jsonb_agg(to_jsonb(o) ORDER BY user_id,operation,idempotency_key),'[]'::jsonb)
       FROM public.nexus_account_operations o
       WHERE user_id IN ('22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333'))
     OR shared_keys IS DISTINCT FROM (
       SELECT coalesce(jsonb_agg(to_jsonb(k) ORDER BY user_id,provider),'[]'::jsonb)
       FROM public.nexus_user_provider_keys k
       WHERE user_id IN ('22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333')) THEN
    RAISE EXCEPTION 'account assertions changed shared actor usage, operations or keys';
  END IF;
END
$$;
RESET ROLE;
ROLLBACK;
SELECT 'account_trial_byok_assertions_pass';
