\set ON_ERROR_STOP on
DO $$ DECLARE n int; BEGIN
 SELECT count(*) INTO n FROM pg_class c JOIN pg_namespace s ON s.oid=c.relnamespace
 WHERE s.nspname='public' AND c.relkind='r' AND c.relrowsecurity;
 IF n<>53 THEN RAISE EXCEPTION 'expected 53 RLS tables, found %',n; END IF;
 IF has_table_privilege('authenticated','public.provider_registry','select') OR has_table_privilege('anon','public.provider_registry','select') THEN
  RAISE EXCEPTION 'client role unexpectedly reads protected provider table';
 END IF;
 IF has_function_privilege('anon','public.v6_reserve_many(uuid,text,jsonb,text,text,text,text)','execute') OR
    has_function_privilege('authenticated','public.v6_reserve_many(uuid,text,jsonb,text,text,text,text)','execute') OR
    NOT has_function_privilege('service_role','public.v6_reserve_many(uuid,text,jsonb,text,text,text,text)','execute') OR
    has_function_privilege('service_role','public.v6_reserve_budget(uuid,text,text,bigint,text,text)','execute') THEN
  RAISE EXCEPTION 'quota RPC execute grants are too broad or missing';
 END IF;
 IF has_function_privilege('anon','public.cleanup_terminal_ingestion_extraction()','execute') OR
    has_function_privilege('authenticated','public.cleanup_terminal_ingestion_extraction()','execute') OR
    NOT has_function_privilege('service_role','public.cleanup_terminal_ingestion_extraction()','execute') THEN
  RAISE EXCEPTION 'extraction trigger execute grants are too broad or missing';
 END IF;
 IF (SELECT count(*) FROM pg_policies
       WHERE schemaname='public'
         AND tablename IN ('ingestion_extraction_manifests','ingestion_extraction_chunks')
         AND policyname='nexusrag_explicit_client_deny') <> 2 THEN
  RAISE EXCEPTION 'extraction staging explicit-deny policies are missing';
 END IF;
 IF has_function_privilege('anon','public.workbench_stage_chunk_batch(uuid,uuid,text,bigint,uuid,bigint,text,text,jsonb,integer,integer,jsonb)','execute') OR
    has_function_privilege('authenticated','public.workbench_finalize_chunk_stage(uuid,uuid,text,bigint,uuid,bigint,integer,text)','execute') OR
    has_function_privilege('anon','public.workbench_store_extracted_chunks(uuid,uuid,text,bigint,uuid,bigint,text,text,jsonb,integer,jsonb)','execute') OR
    has_function_privilege('authenticated','public.workbench_read_extracted_batch(uuid,uuid,text,bigint,uuid,bigint,integer,integer)','execute') OR
    has_function_privilege('anon','public.workbench_cleanup_expired_extractions(integer)','execute') OR
    has_table_privilege('anon','public.ingestion_extraction_manifests','SELECT') OR
    NOT has_function_privilege('service_role','public.workbench_cleanup_expired_extractions(integer)','execute') OR
    NOT has_function_privilege('service_role','public.workbench_store_extracted_chunks(uuid,uuid,text,bigint,uuid,bigint,text,text,jsonb,integer,jsonb)','execute') OR
    NOT has_function_privilege('service_role','public.workbench_read_extracted_batch(uuid,uuid,text,bigint,uuid,bigint,integer,integer)','execute') OR
    has_table_privilege('authenticated','public.ingestion_extraction_chunks','SELECT') OR
    NOT has_function_privilege('service_role','public.workbench_finalize_chunk_stage(uuid,uuid,text,bigint,uuid,bigint,integer,text)','execute') THEN
  RAISE EXCEPTION 'batch staging function grants are too broad or missing';
 END IF;
END $$;
SET ROLE anon;
SET request.jwt.claim.role='anon';
DO $$ DECLARE denied boolean := false; BEGIN
 BEGIN
  EXECUTE $q$SELECT public.v6_reserve_many('11111111-1111-4111-8111-111111111111','gemini','{"requests":1}'::jsonb,'unauthorized','interactive','gemini_non_sensitive','non_sensitive')$q$;
 EXCEPTION WHEN insufficient_privilege THEN denied := true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'anon role unexpectedly executed the service-only RPC'; END IF;
END $$;
RESET ROLE;
SELECT 'schema_grants_role_denial_pass';
