\set ON_ERROR_STOP on
-- Clients reach data only through the gateway, which uses the service role. So the anon and authenticated roles get
-- no privilege on any table or view in public, cannot call a security-definer function there, and a signed-out
-- visitor can call no function there at all. Hosted Supabase grants both roles everything on new tables by default,
-- so every migration has to take that away; this catches one that forgets. Both hosted projects passed the same
-- checks on 2026-11-18 (NX-19). Functions that belong to an extension (pgvector's) are not ours and are skipped.
do $$ declare offenders text; begin
  select string_agg(c.relname, ', ' order by c.relname) into offenders
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity;
  if offenders is not null then raise exception 'public tables without row-level security: %', offenders; end if;

  select string_agg(c.relname, ', ' order by c.relname) into offenders
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm')
     and (has_table_privilege('anon', c.oid, 'select,insert,update,delete,truncate,references,trigger')
       or has_table_privilege('authenticated', c.oid, 'select,insert,update,delete,truncate,references,trigger'));
  if offenders is not null then raise exception 'public tables or views a client role can use directly: %', offenders; end if;

  select string_agg(p.oid::regprocedure::text, ', ' order by p.proname) into offenders
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef
     and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'));
  if offenders is not null then raise exception 'security-definer functions a client role can call: %', offenders; end if;

  select string_agg(p.oid::regprocedure::text, ', ' order by p.proname) into offenders
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')
     and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e');
  if offenders is not null then raise exception 'functions a signed-out visitor can call: %', offenders; end if;

  select string_agg(p.oid::regprocedure::text, ', ' order by p.proname) into offenders
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef
     and not exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) s where s like 'search_path=%');
  if offenders is not null then raise exception 'security-definer functions without a fixed search_path: %', offenders; end if;

  select string_agg(id, ', ' order by id) into offenders from storage.buckets where public;
  if offenders is not null then raise exception 'public storage buckets: %', offenders; end if;
end $$;
\echo CLIENT_PRIVILEGE_SQL_PASS
