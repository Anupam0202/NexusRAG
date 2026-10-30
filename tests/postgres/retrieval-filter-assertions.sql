\set ON_ERROR_STOP on
-- Disposable local SQL semantics, not hosted PostgREST/OAuth acceptance.
-- Use the real baseline's column types; all fixtures roll back.
BEGIN;
CREATE TEMP TABLE filter_documents (LIKE public.documents INCLUDING DEFAULTS);
CREATE TEMP TABLE filter_chunks (LIKE public.document_chunks INCLUDING DEFAULTS);
INSERT INTO filter_documents(id,workspace_id,uploaded_by,filename,original_filename,created_at,active_version_id) VALUES
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','Report.PDF','Report.PDF','2026-01-02T23:59:59.999Z','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'),
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333','Report.PDF','Report.PDF','2026-01-02T12:00:00Z','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'),
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3','44444444-4444-4444-8444-444444444444','33333333-3333-4333-8333-333333333333','Report.PDF','Report.PDF','2026-01-02T12:00:00Z','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3');
INSERT INTO filter_chunks(id,workspace_id,document_id,version_id,chunk_index,content,page_number,metadata)
SELECT gen_random_uuid(),'11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
       'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',ordinal,'Synthetic filter evidence',page,meta
FROM (VALUES
 (0,0,'{"literal.key":"finance","reviewed":false,"revision":0}'::jsonb),
 (1,2,'{"literal.key":"finance","reviewed":false,"revision":0}'::jsonb),
 (2,3,'{"literal.key":"finance","reviewed":false,"revision":0}'::jsonb),
 (3,NULL,'{"literal.key":"finance","reviewed":false,"revision":0}'::jsonb),
 (4,1,'{"literal":{"key":"finance"},"reviewed":false,"revision":0}'::jsonb),
 (5,1,'{"literal.key":"finance","reviewed":false,"revision":"0"}'::jsonb)
) AS fixtures(ordinal,page,meta);
DO $$
DECLARE document_count integer; chunk_count integer;
BEGIN
  SELECT count(*) INTO document_count FROM filter_documents
   WHERE workspace_id='11111111-1111-4111-8111-111111111111'
     AND uploaded_by='22222222-2222-4222-8222-222222222222'
     AND filename='Report.PDF' AND (filename ILIKE '%.pdf' OR filename ILIKE '%.md')
     AND created_at>='2026-01-02T00:00:00Z' AND created_at<='2026-01-02T23:59:59.999Z';
  IF document_count<>1 THEN RAISE EXCEPTION 'Document tenant/uploader/extension/inclusive-date filters diverge'; END IF;
  IF EXISTS(SELECT 1 FROM filter_documents WHERE filename='report.pdf') THEN
    RAISE EXCEPTION 'Exact filename filter unexpectedly became case-insensitive';
  END IF;
  SELECT count(*) INTO chunk_count FROM filter_chunks c JOIN filter_documents d
    ON d.id=c.document_id AND d.active_version_id=c.version_id AND d.workspace_id=c.workspace_id
   WHERE c.workspace_id='11111111-1111-4111-8111-111111111111'
     AND c.page_number>=0 AND c.page_number<=2
     AND c.metadata @> '{"literal.key":"finance","reviewed":false,"revision":0}'::jsonb;
  IF chunk_count<>2 THEN RAISE EXCEPTION 'Page/null/literal-key/scalar-type filters diverge'; END IF;
END $$;
ROLLBACK;
SELECT 'RETRIEVAL_FILTER_SQL_PASS' AS receipt;