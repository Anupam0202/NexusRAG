-- Preview candidate only. Do not apply to a hosted database without separate approval.
-- Gemini Free processing is restricted to explicitly attested non-sensitive input,
-- after provider terms and workspace privacy policy have been independently reviewed.
begin;

alter table public.document_versions
  add column if not exists data_classification text not null default 'unknown',
  add column if not exists classification_declared_by uuid,
  add column if not exists classification_declared_at timestamptz;

alter table public.document_versions
  drop constraint if exists document_versions_data_classification_check;
alter table public.document_versions
  add constraint document_versions_data_classification_check
  check (
    data_classification in ('unknown','non_sensitive','sensitive')
    and (
      data_classification <> 'non_sensitive'
      or (classification_declared_by is not null and classification_declared_at is not null)
    )
  );

comment on column public.document_versions.data_classification is
  'Fail-closed classification. Existing rows default to unknown and cannot be sent to Gemini until explicitly attested non_sensitive.';
comment on column public.document_versions.classification_declared_by is
  'Authenticated user who attested this version contains no sensitive data; this is not a substitute for workspace owner policy approval.';

-- Replace the old RPC signature so no application caller can bypass the new
-- action/classification arguments by continuing to call the 5-argument form.
drop function if exists public.v6_reserve_many(uuid,text,jsonb,text,text);

create function public.v6_reserve_many(
  p_workspace uuid,
  p_provider text,
  p_dimensions jsonb,
  p_idempotency_key text,
  p_priority text,
  p_action text,
  p_data_classification text
) returns jsonb language plpgsql security definer
set search_path = pg_catalog, public
as $fn$
declare
  item record;
  admission jsonb;
  reservations jsonb := '[]'::jsonb;
  prior jsonb;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    return jsonb_build_object('state','RIGHTS_BLOCKED');
  end if;
  if p_dimensions is null or jsonb_typeof(p_dimensions) <> 'object'
     or (select count(*) from jsonb_object_keys(p_dimensions)) not between 1 and 4
     or p_idempotency_key is null or length(p_idempotency_key) < 1 or length(p_idempotency_key) > 100
     or p_priority is null or p_priority not in ('essential','interactive','background','speculative') then
    return jsonb_build_object('state','REVIEW_REQUIRED');
  end if;
  for item in select key, value from jsonb_each(p_dimensions) order by key loop
    if item.key !~ '^[a-z_]{1,40}$' or jsonb_typeof(item.value) <> 'number'
       or item.value::text !~ '^[0-9]{1,10}$' then
      return jsonb_build_object('state','REVIEW_REQUIRED');
    end if;
  end loop;

  if p_provider = 'gemini' then
    if p_action <> 'gemini_non_sensitive' or p_data_classification <> 'non_sensitive' then
      return jsonb_build_object('state','RIGHTS_BLOCKED');
    end if;
    -- Do not infer approval from public plan limits or a user's upload checkbox.
    -- A workspace owner must record an explicit policy after reviewing current
    -- terms; absent, stale, or ambiguous evidence denies every Gemini call.
    if not exists (
      select 1 from public.provider_registry pr
      where pr.id = 'gemini'
        and pr.status = 'APPROVED'
        and pr.review_owner is not null
        and pr.terms_checked_at is not null
        and pr.terms_hash ~ '^[0-9a-f]{64}$'
    ) or not exists (
      select 1 from public.workspace_provider_policies wp
      where wp.workspace_id = p_workspace and wp.provider_id = 'gemini'
        and wp.status = 'APPROVED'
        and wp.reviewed_by is not null and wp.reviewed_at is not null
        and wp.allowed_actions @> array['gemini_non_sensitive']::text[]
        and not ('gemini_non_sensitive' = any(wp.prohibited_actions))
        and not ('gemini_non_sensitive' = any(wp.review_actions))
        and wp.rights_hash ~ '^[0-9a-f]{64}$'
    ) then
      return jsonb_build_object('state','RIGHTS_BLOCKED');
    end if;
  end if;

  for item in select key, value from jsonb_each(p_dimensions) order by key loop
    admission := public.v6_reserve_budget(
      p_workspace,p_provider,item.key,item.value::bigint,
      p_idempotency_key || ':' || item.key,p_priority
    );
    if admission->>'state' not in ('READY','QUOTA_NEAR_LIMIT') then
      for prior in select value from jsonb_array_elements(reservations) loop
        perform public.v6_settle_budget((prior->>'id')::uuid,0,false);
      end loop;
      return jsonb_build_object('state',coalesce(admission->>'state','REVIEW_REQUIRED'),
                                'reset_at',admission->'reset_at');
    end if;
    reservations := reservations || jsonb_build_array(jsonb_build_object(
      'id',admission->>'reservation_id','amount',item.value::bigint
    ));
  end loop;
  return jsonb_build_object('state','READY','reservations',reservations);
end
$fn$;

revoke execute on function public.v6_reserve_many(uuid,text,jsonb,text,text,text,text) from public, anon, authenticated;
grant execute on function public.v6_reserve_many(uuid,text,jsonb,text,text,text,text) to service_role;
-- Only the guarded multi-dimension entry point may admit usage from service code.
revoke execute on function public.v6_reserve_budget(uuid,text,text,bigint,text,text) from service_role;

commit;