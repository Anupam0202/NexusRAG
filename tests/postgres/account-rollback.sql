\set ON_ERROR_STOP on
BEGIN;
SET ROLE service_role;
SET request.jwt.claim.role='service_role';
SAVEPOINT before_trial_reservation;
SELECT public.nexus_admit_account_operation(
  '33333333-3333-4333-8333-333333333333',
  'chat',
  '40000000-0000-4000-8000-000000000001'
);
ROLLBACK TO SAVEPOINT before_trial_reservation;
DO $$
DECLARE r jsonb;
BEGIN
  r:=public.nexus_account_entitlement_status('33333333-3333-4333-8333-333333333333');
  IF (r->>'free_chat_queries_used')::integer<>0 THEN
    RAISE EXCEPTION 'rolled-back admission consumed a free query: %',r;
  END IF;
END
$$;
COMMIT;
RESET ROLE;
SELECT 'account_trial_rollback_pass';