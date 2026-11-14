-- Optional declared identity preserves legacy drafts; it never verifies claims or starts execution.
alter function public.nexus_research_plan_limits(jsonb) rename to nexus_research_plan_limits_before_passport_subject;

create function public.nexus_research_plan_limits(p_plan jsonb)
returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  caps jsonb; subject jsonb; field text; value text; maximum integer;
  whitespace text = E' \t\n\r\f\v' || U&'\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff';
begin
  caps=public.nexus_research_plan_limits_before_passport_subject(p_plan);
  if p_plan ? 'passport_subject' then
    subject=p_plan->'passport_subject';
    if p_plan->>'mode'<>'PRODUCT_PASSPORT' or jsonb_typeof(subject) is distinct from 'object' then raise exception 'NR:INVALID_SCOPE'; end if;
    if (select count(*) from jsonb_object_keys(subject))<>4
      or not subject ?& array['product_id','product_name','product_version','supplier'] then raise exception 'NR:INVALID_SCOPE'; end if;
    foreach field in array array['product_id','product_name','product_version','supplier'] loop
      maximum=case when field in('product_id','product_version') then 128 else 256 end;
      value=subject->>field;
      if jsonb_typeof(subject->field) is distinct from 'string' or length(value) not between 1 and maximum
        or length(btrim(value,whitespace))=0 or value<>btrim(value,whitespace) then raise exception 'NR:INVALID_SCOPE'; end if;
    end loop;
  end if;
  return caps;
end; $$;

revoke all on function public.nexus_research_plan_limits(jsonb) from public, anon, authenticated;
grant execute on function public.nexus_research_plan_limits(jsonb) to service_role;
