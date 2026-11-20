\set ON_ERROR_STOP on
-- Every foreign key in the public schema has an index whose leading columns are its own columns, so deleting a
-- referenced row never scans the whole referencing table (Supabase performance advisor, lint 0001). A new foreign key
-- without one fails here and is named.
do $$
declare missing text;
begin
  select string_agg(format('%s.%s (%s)', c.conrelid::regclass, c.conname,
           (select string_agg(a.attname, ', ' order by k.ord) from unnest(c.conkey) with ordinality k(attnum, ord)
              join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum)), '; ' order by 1)
    into missing
    from pg_constraint c
   where c.contype = 'f' and c.connamespace = 'public'::regnamespace
     and not exists (
       select 1 from pg_index i
        where i.indrelid = c.conrelid
          and (select array_agg(x order by x) from unnest((string_to_array(i.indkey::text, ' ')::int2[])[1:cardinality(c.conkey)]) x)
            = (select array_agg(x order by x) from unnest(c.conkey) x));
  if missing is not null then raise exception 'foreign keys without a covering index: %', missing; end if;
end $$;
select 'FOREIGN_KEY_INDEX_SQL_PASS';
