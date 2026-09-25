\set ON_ERROR_STOP on
SET ROLE service_role;
SET request.jwt.claim.role='service_role';
INSERT INTO public.documents(id,workspace_id,uploaded_by,filename,original_filename,content_type,status)
VALUES ('88888888-8888-4888-8888-888888888888','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','extraction.txt','extraction.txt','text/plain','queued');
INSERT INTO public.document_versions(id,workspace_id,document_id,original_bucket,original_key,original_hash,original_bytes,original_verified_at,parser_version,chunker_version,index_generation,lifecycle_epoch,publication_state)
VALUES ('99999999-9999-4999-8999-999999999998','11111111-1111-4111-8111-111111111111','88888888-8888-4888-8888-888888888888','documents','11111111-1111-4111-8111-111111111111/88888888-8888-4888-8888-888888888888/99999999-9999-4999-8999-999999999998/extraction.txt',repeat('e',64),64,now(),'test','test',null,1,'staged');
INSERT INTO public.ingestion_jobs(id,workspace_id,document_id,version_id,status,progress,stage,attempts,max_attempts,kind,lifecycle_epoch,lease_owner,lease_generation,lease_expires_at,payload)
VALUES ('77777777-7777-4777-8777-777777777777','11111111-1111-4111-8111-111111111111','88888888-8888-4888-8888-888888888888','99999999-9999-4999-8999-999999999998','processing',10,'extracting',1,3,'ingestion',1,'pg-worker',8,now()+interval '5 minutes','{}'::jsonb);
DO $$
DECLARE
  rows jsonb;
  stored jsonb;
  replay jsonb;
  first_batch jsonb;
  tail_batch jsonb;
  changed_manifest jsonb;
  cleanup_count integer;
  text_value text;
  i integer;
BEGIN
  FOR i IN 0..3 LOOP
    text_value := 'durable extraction chunk '||i;
    rows := coalesce(rows,'[]'::jsonb) || jsonb_build_array(jsonb_build_object(
      'ordinal',i,
      'original_text',text_value,
      'original_content_hash',encode(sha256(convert_to(text_value,'UTF8')),'hex'),
      'location',jsonb_build_object('char_start',i*32,'char_end',i*32+length(text_value))
    ));
  END LOOP;

  stored := public.workbench_store_extracted_chunks(
    '77777777-7777-4777-8777-777777777777',
    '11111111-1111-4111-8111-111111111111',
    'pg-worker',8,'99999999-9999-4999-8999-999999999998',1,
    'test-space','batch-index','{"mime_type":"text/plain","method":"worker-utf8-v1"}'::jsonb,4,rows
  );
  IF (stored->>'count')::integer<>4 OR stored->>'found'<>'true' THEN
    RAISE EXCEPTION 'extraction was not durably staged: %',stored;
  END IF;
  replay := public.workbench_store_extracted_chunks(
    '77777777-7777-4777-8777-777777777777',
    '11111111-1111-4111-8111-111111111111',
    'pg-worker',8,'99999999-9999-4999-8999-999999999998',1,
    'test-space','batch-index','{"mime_type":"text/plain","method":"worker-utf8-v1"}'::jsonb,4,rows
  );
  IF replay->>'manifest'<>stored->>'manifest' OR (replay->>'total_bytes')::integer<>(stored->>'total_bytes')::integer THEN
    RAISE EXCEPTION 'extraction replay changed durable metadata';
  END IF;
  first_batch := public.workbench_read_extracted_batch(
    '77777777-7777-4777-8777-777777777777',
    '11111111-1111-4111-8111-111111111111',
    'pg-worker',8,'99999999-9999-4999-8999-999999999998',1,0,3
  );
  tail_batch := public.workbench_read_extracted_batch(
    '77777777-7777-4777-8777-777777777777',
    '11111111-1111-4111-8111-111111111111',
    'pg-worker',8,'99999999-9999-4999-8999-999999999998',1,3,3
  );
  IF jsonb_array_length(first_batch->'chunks')<>3
     OR jsonb_array_length(tail_batch->'chunks')<>1
     OR first_batch->>'found'<>'true'
     OR tail_batch->>'found'<>'true'
     OR first_batch->'chunks'->0->>'original_text'<>'durable extraction chunk 0'
     OR tail_batch->'chunks'->0->>'ordinal'<>'3' THEN
    RAISE EXCEPTION 'bounded extraction batch mismatch: %, %',first_batch,tail_batch;
  END IF;

  BEGIN
    changed_manifest := public.workbench_store_extracted_chunks(
      '77777777-7777-4777-8777-777777777777',
      '11111111-1111-4111-8111-111111111111',
      'pg-worker',8,'99999999-9999-4999-8999-999999999998',1,
      'test-space','batch-index','{"mime_type":"text/plain","method":"tampered"}'::jsonb,4,rows
    );
    RAISE EXCEPTION 'changed extraction manifest was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'NR:VERSION_CONFLICT%' THEN RAISE; END IF;
  END;

  UPDATE public.ingestion_extraction_manifests SET expires_at=clock_timestamp()-interval '1 second'
    WHERE job_id='77777777-7777-4777-8777-777777777777';
  cleanup_count := public.workbench_cleanup_expired_extractions(1);
  IF cleanup_count<>1 OR EXISTS (SELECT 1 FROM public.ingestion_extraction_manifests WHERE job_id='77777777-7777-4777-8777-777777777777') THEN
    RAISE EXCEPTION 'expired extraction cleanup failed: %',cleanup_count;
  END IF;
  stored := public.workbench_store_extracted_chunks(
    '77777777-7777-4777-8777-777777777777',
    '11111111-1111-4111-8111-111111111111',
    'pg-worker',8,'99999999-9999-4999-8999-999999999998',1,
    'test-space','batch-index','{"mime_type":"text/plain","method":"worker-utf8-v1"}'::jsonb,4,rows
  );
  UPDATE public.ingestion_jobs SET status='failed' WHERE id='77777777-7777-4777-8777-777777777777';
  IF EXISTS (SELECT 1 FROM public.ingestion_extraction_manifests WHERE job_id='77777777-7777-4777-8777-777777777777') THEN
    RAISE EXCEPTION 'terminal failure did not purge temporary extraction';
  END IF;
END $$;
RESET ROLE;
SELECT 'postgres_durable_extraction_stage_pass';