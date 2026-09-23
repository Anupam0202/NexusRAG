\set ON_ERROR_STOP on
SET ROLE service_role;
SET request.jwt.claim.role='service_role';
DO $$
DECLARE r jsonb; replay jsonb; n integer;
BEGIN
 r := public.v6_reserve_many('11111111-1111-4111-8111-111111111111','gemini','{"input_tokens":20,"requests":10}'::jsonb,'pg-func-good','interactive');
 IF r->>'state' <> 'READY' OR jsonb_array_length(r->'reservations') <> 2 THEN RAISE EXCEPTION 'reserve: %',r; END IF;
 IF (public.v6_settle_many(r->'reservations',true)->>'state') <> 'SETTLED' THEN RAISE EXCEPTION 'settle'; END IF;
 r := public.v6_reserve_many('11111111-1111-4111-8111-111111111111','gemini','{"input_tokens":1,"zz_missing":1}'::jsonb,'pg-func-partial','interactive');
 IF r->>'state' <> 'REVIEW_REQUIRED' THEN RAISE EXCEPTION 'partial admission: %',r; END IF;
 SELECT count(*) INTO n FROM public.budget_reservations WHERE idempotency_key='pg-func-partial:input_tokens' AND state='RELEASED';
 IF n <> 1 THEN RAISE EXCEPTION 'partial reservation was not released'; END IF;
 r := public.v6_reserve_budget('11111111-1111-4111-8111-111111111111','gemini','requests',1,'pg-null-priority',NULL);
 IF r->>'state' <> 'REVIEW_REQUIRED' THEN RAISE EXCEPTION 'null priority: %',r; END IF;
 r := public.v6_reserve_many('11111111-1111-4111-8111-111111111111','gemini','{"requests":1}'::jsonb,'pg-idem','interactive');
 IF r->>'state' <> 'READY' THEN RAISE EXCEPTION 'initial reservation: %',r; END IF;
 replay := public.v6_reserve_many('11111111-1111-4111-8111-111111111111','gemini','{"requests":1}'::jsonb,'pg-idem','interactive');
 IF replay->>'state' <> 'RESERVATION_IN_PROGRESS' OR replay ? 'reservations' THEN RAISE EXCEPTION 'replay authorized duplicate: %',replay; END IF;
 IF (public.v6_settle_many(r->'reservations',false)->>'state') <> 'RELEASED' THEN RAISE EXCEPTION 'release'; END IF;
 r := public.v6_reserve_budget('11111111-1111-4111-8111-111111111111','gemini','requests',1,'pg-null-measure','interactive');
 IF public.v6_settle_budget((r->>'reservation_id')::uuid,NULL,true)->>'state' <> 'RECONCILIATION_REQUIRED' THEN RAISE EXCEPTION 'uncertain usage was not held'; END IF;
END $$;
RESET ROLE;
SELECT 'quota_functions_pass';
