\set ON_ERROR_STOP on
begin;
set request.jwt.claim.role='service_role';
insert into public.nexus_user_provider_keys(user_id,provider,ciphertext,nonce,key_fingerprint,cost_consent_at)
values('22222222-2222-4222-8222-222222222222','gemini','synthetic-ciphertext','synthetic-nonce','synthetic-fingerprint',now())
on conflict(user_id,provider) do update set is_active=true,ciphertext=excluded.ciphertext,nonce=excluded.nonce,key_fingerprint=excluded.key_fingerprint,cost_consent_at=excluded.cost_consent_at;
do $$
declare
 w constant uuid := '11111111-1111-4111-8111-111111111111';
 a constant uuid := '22222222-2222-4222-8222-222222222222';
 b constant uuid := '33333333-3333-4333-8333-333333333333';
 r jsonb; reservations_before bigint; audits_before bigint;
begin
 if has_function_privilege('anon','public.nexus_authorize_byok_processing(uuid,uuid,text)','execute')
 or has_function_privilege('authenticated','public.nexus_authorize_byok_processing(uuid,uuid,text)','execute')
 or not has_function_privilege('service_role','public.nexus_authorize_byok_processing(uuid,uuid,text)','execute') then
 raise exception 'BYOK authority execute grants unsafe'; end if;
 select count(*) into reservations_before from public.budget_reservations;
 select count(*) into audits_before from public.audit_events where action='provider.byok.admit';
 r:=public.nexus_authorize_byok_processing(w,a,'non_sensitive');
 if r->>'state'<>'READY' or r->>'provider_cost_status'<>'UNKNOWN' then raise exception 'Valid BYOK denied: %',r; end if;
 if (select count(*) from public.budget_reservations)<>reservations_before then raise exception 'BYOK charged operator-funded budget'; end if;
 if (select count(*) from public.audit_events where action='provider.byok.admit')<>audits_before+1 then raise exception 'BYOK admission not durably audited'; end if;
 if public.nexus_authorize_byok_processing(w,b,'non_sensitive')->>'state'<>'RIGHTS_BLOCKED' then raise exception 'Cross-workspace BYOK admitted'; end if;
 if public.nexus_authorize_byok_processing(w,a,'sensitive')->>'state'<>'RIGHTS_BLOCKED' then raise exception 'Sensitive BYOK admitted'; end if;
 update public.workspace_provider_policies set reviewed_by=b where workspace_id=w and provider_id='gemini';
 if public.nexus_authorize_byok_processing(w,a,'non_sensitive')->>'state'<>'RIGHTS_BLOCKED' then raise exception 'Foreign-owner review admitted'; end if;
 r:=public.v6_reserve_many(w,'gemini','{"requests":1}'::jsonb,'platform-foreign-owner-review','interactive','gemini_non_sensitive','non_sensitive');
 if r->>'state'<>'RIGHTS_BLOCKED' then raise exception 'Platform processing bypassed workspace-owner review'; end if;
 update public.workspace_provider_policies set reviewed_by=a,reviewed_at=now()-interval '31 days' where workspace_id=w and provider_id='gemini';
 if public.nexus_authorize_byok_processing(w,a,'non_sensitive')->>'state'<>'RIGHTS_BLOCKED' then raise exception 'Stale privacy review admitted'; end if;
 update public.workspace_provider_policies set reviewed_at=now()+interval '1 hour' where workspace_id=w and provider_id='gemini';
 if public.nexus_authorize_byok_processing(w,a,'non_sensitive')->>'state'<>'RIGHTS_BLOCKED' then raise exception 'Future privacy review admitted'; end if;
 update public.workspace_provider_policies set reviewed_at=now(),prohibited_actions=array['gemini_non_sensitive'] where workspace_id=w and provider_id='gemini';
 if public.nexus_authorize_byok_processing(w,a,'non_sensitive')->>'state'<>'RIGHTS_BLOCKED' then raise exception 'Rights-disabled BYOK admitted'; end if;
 update public.workspace_provider_policies set prohibited_actions='{}' where workspace_id=w and provider_id='gemini';
 update public.provider_registry set status='DISABLED' where id='gemini';
 if public.nexus_authorize_byok_processing(w,a,'non_sensitive')->>'state'<>'RIGHTS_BLOCKED' then raise exception 'Disabled provider admitted'; end if;
 update public.provider_registry set status='APPROVED' where id='gemini';
 update public.nexus_user_provider_keys set cost_consent_at=null where user_id=a;
 if public.nexus_authorize_byok_processing(w,a,'non_sensitive')->>'state'<>'BYOK_REQUIRED' then raise exception 'Absent user billing consent admitted'; end if;
 perform set_config('request.jwt.claim.role','authenticated',true);
 if public.nexus_authorize_byok_processing(w,a,'non_sensitive')->>'state'<>'RIGHTS_BLOCKED' then raise exception 'Non-service caller admitted'; end if;
end $$;
rollback;
select 'BYOK_OWNER_RIGHTS_AND_ROLE_ASSERTIONS_PASS (synthetic local fixtures only)';
