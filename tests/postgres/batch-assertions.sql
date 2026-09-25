\set ON_ERROR_STOP on
SET ROLE service_role;
SET request.jwt.claim.role='service_role';
INSERT INTO public.documents(id,workspace_id,uploaded_by,filename,original_filename,content_type,status)
VALUES ('99999999-9999-4999-8999-999999999999','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','batch.txt','batch.txt','text/plain','queued');
INSERT INTO public.document_versions(id,workspace_id,document_id,original_bucket,original_key,original_hash,original_bytes,original_verified_at,parser_version,chunker_version,index_generation,lifecycle_epoch,publication_state)
VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','99999999-9999-4999-8999-999999999999','documents','11111111-1111-4111-8111-111111111111/99999999-9999-4999-8999-999999999999/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/batch.txt',repeat('d',64),64,now(),'test','test','batch-index',1,'staged');
INSERT INTO public.ingestion_jobs(id,workspace_id,document_id,version_id,status,progress,stage,attempts,max_attempts,kind,lifecycle_epoch,lease_owner,lease_generation,lease_expires_at,payload)
VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','11111111-1111-4111-8111-111111111111','99999999-9999-4999-8999-999999999999','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','processing',50,'embedding',1,3,'ingestion',1,'pg-worker',7,now()+interval '5 minutes','{}'::jsonb);
DO $$
DECLARE first_batch jsonb; second_batch jsonb; replay_batch jsonb; final jsonb; published jsonb; rows jsonb; text_value text; chunk_id text; i int;
BEGIN
 FOR i IN 0..3 LOOP
   text_value := 'chunk '||i;
   chunk_id := 'cccccccc-cccc-4ccc-8ccc-'||lpad((i+1)::text,12,'0');
   rows := coalesce(rows,'[]'::jsonb) || jsonb_build_array(jsonb_build_object(
     'chunk_id',chunk_id,'workspace_id','11111111-1111-4111-8111-111111111111',
     'document_id','99999999-9999-4999-8999-999999999999','version_id','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
     'ordinal',i,'original_text',text_value,'original_content_hash',encode(sha256(convert_to(text_value,'UTF8')),'hex'),
     'retrieval_text',text_value,'location',jsonb_build_object('char_start',i*10,'char_end',i*10+length(text_value)),
     'extraction',jsonb_build_object('method','synthetic')));
 END LOOP;
 first_batch := public.workbench_stage_chunk_batch('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','11111111-1111-4111-8111-111111111111','pg-worker',7,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',1,'test-space','batch-index','{"mime_type":"text/plain"}'::jsonb,4,0,jsonb_build_array(rows->0,rows->1));
 IF (first_batch->>'count')::int<>2 THEN RAISE EXCEPTION 'first batch: %',first_batch; END IF;
 second_batch := public.workbench_stage_chunk_batch('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','11111111-1111-4111-8111-111111111111','pg-worker',7,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',1,'test-space','batch-index','{"mime_type":"text/plain"}'::jsonb,4,2,jsonb_build_array(rows->2,rows->3));
 IF (second_batch->>'count')::int<>4 THEN RAISE EXCEPTION 'second batch: %',second_batch; END IF;
 replay_batch := public.workbench_stage_chunk_batch('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','11111111-1111-4111-8111-111111111111','pg-worker',7,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',1,'test-space','batch-index','{"mime_type":"text/plain"}'::jsonb,4,0,jsonb_build_array(rows->0,rows->1));
 IF replay_batch->>'manifest_hash'<>second_batch->>'manifest_hash' OR (replay_batch->>'count')::int<>4 THEN RAISE EXCEPTION 'idempotent replay mismatch'; END IF;
 final := public.workbench_finalize_chunk_stage('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','11111111-1111-4111-8111-111111111111','pg-worker',7,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',1,4,'batch-index');
 published := public.workbench_publish_version('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','11111111-1111-4111-8111-111111111111','pg-worker',7,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',1,jsonb_build_object('manifest_hash',final->>'manifest_hash','verified_vectors',4,'index_generation','batch-index','hashes_valid',true));
 IF published->>'state'<>'ready' OR (published->>'chunks')::int<>4 THEN RAISE EXCEPTION 'publish: %',published; END IF;
END $$;
RESET ROLE;
SELECT 'postgres_resumable_batch_publish_pass';
