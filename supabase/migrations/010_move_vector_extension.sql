-- Keep extension-owned objects out of the API-exposed public schema.
-- Fresh installations already create pgvector in extensions via migration 005;
-- this idempotent migration relocates existing installations.

create schema if not exists extensions;

do $$
declare
  current_schema text;
begin
  select namespace.nspname
  into current_schema
  from pg_extension extension
  join pg_namespace namespace on namespace.oid = extension.extnamespace
  where extension.extname = 'vector';

  if current_schema is null then
    create extension vector with schema extensions;
  elsif current_schema <> 'extensions' then
    alter extension vector set schema extensions;
  end if;
end;
$$;

alter function public.match_document_chunks(extensions.vector, uuid, int, jsonb)
set search_path = public, extensions, pg_temp;
