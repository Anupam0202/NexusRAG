-- Remove anonymous execution from exposed helper and retrieval functions.
-- Preserve authenticated retrieval and policy-helper execution while keeping
-- trigger helpers service-mediated.
begin;

revoke execute on function public.match_document_chunks(extensions.vector, uuid, integer, jsonb)
  from public, anon;
grant execute on function public.match_document_chunks(extensions.vector, uuid, integer, jsonb)
  to authenticated, service_role;

revoke execute on function public.set_updated_at()
  from public, anon, authenticated;
grant execute on function public.set_updated_at()
  to service_role;

revoke execute on function public.uuid_or_null(text)
  from public, anon;
grant execute on function public.uuid_or_null(text)
  to authenticated, service_role;

do $verify$
begin
  if has_function_privilege('anon', 'public.match_document_chunks(extensions.vector,uuid,integer,jsonb)', 'EXECUTE')
     or has_function_privilege('anon', 'public.set_updated_at()', 'EXECUTE')
     or has_function_privilege('anon', 'public.uuid_or_null(text)', 'EXECUTE') then
    raise exception 'NR:MIGRATION_REQUIRED anonymous function execution remains'
      using errcode = '42501';
  end if;

  if not has_function_privilege('authenticated', 'public.match_document_chunks(extensions.vector,uuid,integer,jsonb)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.uuid_or_null(text)', 'EXECUTE') then
    raise exception 'NR:MIGRATION_REQUIRED authenticated function contract missing'
      using errcode = '42501';
  end if;
end
$verify$;

commit;
