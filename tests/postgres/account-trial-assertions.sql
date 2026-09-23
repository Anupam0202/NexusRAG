\set ON_ERROR_STOP on
SET ROLE service_role;
SET request.jwt.claim.role='service_role';
DO $$
DECLARE
  first_user uuid := '22222222-2222-4222-8222-222222222222';
  second_user uuid := '33333333-3333-4333-8333-333333333333';
  r jsonb;
  i integer;
BEGIN
  FOR i IN 1..5 LOOP
    r := public.nexus_admit_account_operation(
      first_user,'chat',('00000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid
    );
    IF r->>'state'<>'READY' OR r->>'credential_mode'<>'platform_trial'
       OR (r->>'used')::integer<>i THEN
      RAISE EXCEPTION 'unexpected chat trial admission %: %',i,r;
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
END
$$;
RESET ROLE;
SELECT 'account_trial_byok_assertions_pass';