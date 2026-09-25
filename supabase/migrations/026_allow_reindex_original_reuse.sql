-- Reindexing creates a new processing/index version over the same immutable
-- original object. The original object address therefore cannot be unique per
-- document version; referential authority remains the version primary key and
-- tenant/document composite keys.

begin;

alter table public.document_versions
  drop constraint if exists document_versions_original_bucket_original_key_key;

create index if not exists document_versions_original_object_idx
  on public.document_versions (original_bucket, original_key);

commit;
