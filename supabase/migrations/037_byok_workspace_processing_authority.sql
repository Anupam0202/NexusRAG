-- User billing consent does not replace provider rights or workspace-owner privacy approval.
begin;
create function public.nexus_authorize_byok_processing(
  p_workspace uuid, p_actor uuid, p_data_classification text
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,pg_temp as $fn$
begin
  if coalesce(current_setting('request.jwt.claim.role',true),'') <> 'service_role'
     or p_workspace is null or p_actor is null
     or p_data_classification is distinct from 'non_sensitive' then
    return jsonb_build_object('state','RIGHTS_BLOCKED');
  end if;
  -- Revalidate current workspace and researcher authority for every provider call,
  -- including queued work whose uploader may have lost access since submission.
  perform 1 from public.workspaces w join public.workspace_members m
    on m.workspace_id=w.id and m.user_id=p_actor
    where w.id=p_workspace and w.lifecycle_state='active'
      and m.role in ('owner','admin','editor') for share of w,m;
  if not found then return jsonb_build_object('state','RIGHTS_BLOCKED'); end if;
  perform 1 from public.nexus_user_provider_keys k
    where k.user_id=p_actor and k.provider='gemini' and k.is_active
      and k.ciphertext is not null and k.nonce is not null
      and k.cost_consent_at is not null and k.cost_consent_at<=now() for share;
  if not found then return jsonb_build_object('state','BYOK_REQUIRED'); end if;
  perform 1 from public.provider_registry pr
    where pr.id='gemini' and pr.status='APPROVED' and pr.review_owner is not null
      and pr.terms_checked_at between now()-interval '30 days' and now()
      and pr.terms_hash ~ '^[0-9a-f]{64}$'
      and exists(select 1 from public.provider_terms_snapshots pts
        where pts.provider_id=pr.id and pts.content_hash=pr.terms_hash
          and pts.checked_at=pr.terms_checked_at and pts.approved_by=pr.review_owner)
    for share;
  if not found then return jsonb_build_object('state','RIGHTS_BLOCKED'); end if;
  perform 1 from public.workspace_provider_policies wp
    join public.workspace_members owner
      on owner.workspace_id=wp.workspace_id and owner.user_id=wp.reviewed_by and owner.role='owner'
    where wp.workspace_id=p_workspace and wp.provider_id='gemini' and wp.status='APPROVED'
      and wp.reviewed_at between now()-interval '30 days' and now()
      and wp.allowed_actions @> array['gemini_non_sensitive']::text[]
      and not('gemini_non_sensitive'=any(wp.prohibited_actions))
      and not('gemini_non_sensitive'=any(wp.review_actions))
      and wp.rights_hash ~ '^[0-9a-f]{64}$' for share of wp,owner;
  if not found then return jsonb_build_object('state','RIGHTS_BLOCKED'); end if;
  insert into public.audit_events(workspace_id,user_id,action,resource_type,metadata)
    values(p_workspace,p_actor,'provider.byok.admit','gemini',
      jsonb_build_object('data_classification','non_sensitive','credential_mode','user_byok',
        'provider_cost_status','UNKNOWN','platform_budget_charged',false));
  return jsonb_build_object('state','READY','credential_mode','user_byok','provider_cost_status','UNKNOWN');
end
$fn$;
revoke all on function public.nexus_authorize_byok_processing(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.nexus_authorize_byok_processing(uuid,uuid,text) to service_role;
-- The same current-owner approval is required for operator-funded processing.
create or replace function public.v6_reserve_many(
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
    if p_action is distinct from 'gemini_non_sensitive'
       or p_data_classification is distinct from 'non_sensitive' then
      return jsonb_build_object('state','RIGHTS_BLOCKED');
    end if;
    -- Do not infer approval from public plan limits or a user's upload checkbox.
    -- Both the provider terms snapshot and workspace privacy review expire after
    -- 30 days; absent, stale, future-dated, or ambiguous evidence denies calls.
    if not exists (
      select 1 from public.provider_registry pr
      where pr.id = 'gemini'
        and pr.status = 'APPROVED'
        and pr.review_owner is not null
        and pr.terms_checked_at between now() - interval '30 days' and now()
        and pr.terms_hash ~ '^[0-9a-f]{64}$'
        and exists (
          select 1 from public.provider_terms_snapshots pts
          where pts.provider_id = pr.id
            and pts.content_hash = pr.terms_hash
            and pts.checked_at = pr.terms_checked_at
            and pts.approved_by = pr.review_owner
        )
    ) or not exists (
      select 1 from public.workspace_provider_policies wp
      join public.workspace_members owner
        on owner.workspace_id=wp.workspace_id and owner.user_id=wp.reviewed_by and owner.role='owner'
      join public.workspaces w on w.id=wp.workspace_id and w.lifecycle_state='active'
      where wp.workspace_id = p_workspace and wp.provider_id = 'gemini'
        and wp.status = 'APPROVED'
        and wp.reviewed_by is not null
        and wp.reviewed_at between now() - interval '30 days' and now()
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

commit;
