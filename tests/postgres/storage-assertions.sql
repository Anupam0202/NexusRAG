\set ON_ERROR_STOP on
SET request.jwt.claim.role='authenticated';
SET request.jwt.claim.sub='22222222-2222-4222-8222-222222222222';
SET ROLE authenticated;
DO $$ DECLARE own_n int; cross_n int; BEGIN
 SELECT count(*) INTO own_n FROM storage.objects WHERE name LIKE '11111111-%';
 SELECT count(*) INTO cross_n FROM storage.objects WHERE name LIKE '44444444-%';
 IF own_n<>1 OR cross_n<>0 THEN RAISE EXCEPTION 'identity A storage scope own %, cross %',own_n,cross_n; END IF;
END $$;
RESET ROLE;
SET request.jwt.claim.sub='33333333-3333-4333-8333-333333333333';
SET ROLE authenticated;
DO $$ DECLARE own_n int; cross_n int; BEGIN
 SELECT count(*) INTO own_n FROM storage.objects WHERE name LIKE '44444444-%';
 SELECT count(*) INTO cross_n FROM storage.objects WHERE name LIKE '11111111-%';
 IF own_n<>1 OR cross_n<>0 THEN RAISE EXCEPTION 'identity B storage scope own %, cross %',own_n,cross_n; END IF;
END $$;
RESET ROLE;
SELECT 'storage_rls_two_identity_pass';
