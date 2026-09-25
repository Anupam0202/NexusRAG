\set ON_ERROR_STOP on
SET ROLE service_role;
SET request.jwt.claim.role='service_role';
DO $$
DECLARE r jsonb; replay jsonb; n integer;
BEGIN
 r := public.v6_reserve_many('11111111-1111-4111-8111-111111111111','gemini','{"input_tokens":20,"requests":10}'::jsonb,'pg-func-good','interactive','gemini_non_sensitive','non_sensitive');
 IF r->>'state' <> 'READY' OR jsonb_array_length(r->'reservations') <> 2 THEN RAISE EXCEPTION 'reserve: %',r; END IF;
 IF (public.v6_settle_many(r->'reservations',true)->>'state') <> 'SETTLED' THEN RAISE EXCEPTION 'settle'; END IF;
 r := public.v6_reserve_many('11111111-1111-4111-8111-111111111111','gemini','{"input_tokens":1,"zz_missing":1}'::jsonb,'pg-func-partial','interactive','gemini_non_sensitive','non_sensitive');
 IF r->>'state' <> 'REVIEW_REQUIRED' THEN RAISE EXCEPTION 'partial admission: %',r; END IF;
 SELECT count(*) INTO n FROM public.budget_reservations WHERE idempotency_key='pg-func-partial:input_tokens' AND state='RELEASED';
 IF n <> 1 THEN RAISE EXCEPTION 'partial reservation was not released'; END IF;
 r := public.v6_reserve_many('11111111-1111-4111-8111-111111111111','gemini','{"requests":1}'::jsonb,'pg-null-priority',NULL,'gemini_non_sensitive','non_sensitive');
 IF r->>'state' <> 'REVIEW_REQUIRED' THEN RAISE EXCEPTION 'null priority: %',r; END IF;
 r := public.v6_reserve_many('11111111-1111-4111-8111-111111111111','gemini','{"requests":1}'::jsonb,'pg-idem','interactive','gemini_non_sensitive','non_sensitive');
 IF r->>'state' <> 'READY' THEN RAISE EXCEPTION 'initial reservation: %',r; END IF;
 replay := public.v6_reserve_many('11111111-1111-4111-8111-111111111111','gemini','{"requests":1}'::jsonb,'pg-idem','interactive','gemini_non_sensitive','non_sensitive');
 IF replay->>'state' <> 'RESERVATION_IN_PROGRESS' OR replay ? 'reservations' THEN RAISE EXCEPTION 'replay authorized duplicate: %',replay; END IF;
 IF (public.v6_settle_many(r->'reservations',false)->>'state') <> 'RELEASED' THEN RAISE EXCEPTION 'release'; END IF;
 r := public.v6_reserve_many('11111111-1111-4111-8111-111111111111','gemini','{"requests":1}'::jsonb,'pg-null-measure','interactive','gemini_non_sensitive','non_sensitive');
 IF public.v6_settle_budget((r->'reservations'->0->>'id')::uuid,NULL,true)->>'state' <> 'RECONCILIATION_REQUIRED' THEN RAISE EXCEPTION 'uncertain usage was not held'; END IF;
END $$;
DO $$
DECLARE r jsonb; n integer;
BEGIN
 r := public.v6_reserve_many('11111111-1111-4111-8111-111111111111','gemini','{"requests":1}'::jsonb,'pg-sensitive-denial','interactive','gemini_non_sensitive','sensitive');
 IF r->>'state' <> 'RIGHTS_BLOCKED' THEN RAISE EXCEPTION 'sensitive data admitted: %',r; END IF;
 SELECT count(*) INTO n FROM public.budget_reservations WHERE idempotency_key like 'pg-sensitive-denial:%';
 IF n <> 0 THEN RAISE EXCEPTION 'sensitive denial created quota reservation'; END IF;
 r := public.v6_reserve_many('11111111-1111-4111-8111-111111111111','gemini','{"requests":1}'::jsonb,'pg-unapproved-action','interactive','send_all_data','non_sensitive');
 IF r->>'state' <> 'RIGHTS_BLOCKED' THEN RAISE EXCEPTION 'unapproved action admitted: %',r; END IF;
 r := public.v6_reserve_many('11111111-1111-4111-8111-111111111111','gemini','{"requests":1}'::jsonb,'pg-null-action','interactive',NULL,'non_sensitive');
 IF r->>'state' <> 'RIGHTS_BLOCKED' THEN RAISE EXCEPTION 'null action admitted: %',r; END IF;
 r := public.v6_reserve_many('11111111-1111-4111-8111-111111111111','gemini','{"requests":1}'::jsonb,'pg-null-class','interactive','gemini_non_sensitive',NULL);
 IF r->>'state' <> 'RIGHTS_BLOCKED' THEN RAISE EXCEPTION 'null classification admitted: %',r; END IF;
 UPDATE public.workspace_provider_policies SET reviewed_at=now()-interval '31 days'
 WHERE workspace_id='11111111-1111-4111-8111-111111111111' AND provider_id='gemini';
 r := public.v6_reserve_many('11111111-1111-4111-8111-111111111111','gemini','{"requests":1}'::jsonb,'pg-stale-review','interactive','gemini_non_sensitive','non_sensitive');
 IF r->>'state' <> 'RIGHTS_BLOCKED' THEN RAISE EXCEPTION 'stale privacy review admitted: %',r; END IF;
 UPDATE public.workspace_provider_policies SET reviewed_at=now()
 WHERE workspace_id='11111111-1111-4111-8111-111111111111' AND provider_id='gemini';
END $$;
RESET ROLE;
SELECT 'quota_functions_and_classification_gate_pass';
