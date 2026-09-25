\set ON_ERROR_STOP on
DO $$ DECLARE duplicate_rows int; index_unique boolean; BEGIN
 SELECT count(*) INTO duplicate_rows FROM public.document_versions
 WHERE id IN ('77777777-7777-4777-8777-777777777777','99999999-9999-4999-8999-999999999999')
   AND workspace_id='11111111-1111-4111-8111-111111111111'
   AND document_id='55555555-5555-4555-8555-555555555555';
 IF duplicate_rows<>2 THEN RAISE EXCEPTION 'reindex must permit two versions of one immutable source object'; END IF;
 SELECT i.indisunique INTO index_unique FROM pg_index i
 WHERE i.indexrelid=to_regclass('public.document_versions_original_object_idx');
 IF NOT FOUND OR index_unique THEN RAISE EXCEPTION 'original-object lookup index must exist and be non-unique'; END IF;
END $$;
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
