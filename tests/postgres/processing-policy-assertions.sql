\set ON_ERROR_STOP on
begin;
set request.jwt.claim.role='service_role';
do $$
declare
 w constant uuid := '11111111-1111-4111-8111-111111111111';
 a constant uuid := '22222222-2222-4222-8222-222222222222';
 b constant uuid := '33333333-3333-4333-8333-333333333333';
 r jsonb; v bigint; audits bigint;
begin
 if has_function_privilege('anon','public.nexus_processing_policy_version()','execute')
 or has_function_privilege('authenticated','public.nexus_processing_policy_version()','execute')
 or public.nexus_processing_policy_version()->>'version'<>'039' then raise exception 'Policy metadata grants unsafe'; end if;
 if has_function_privilege('anon','public.nexus_workspace_processing_policy(uuid,uuid,text,text,bigint)','execute')
 or has_function_privilege('authenticated','public.nexus_workspace_processing_policy(uuid,uuid,text,text,bigint)','execute')
 or not has_function_privilege('service_role','public.nexus_workspace_processing_policy(uuid,uuid,text,text,bigint)','execute') then
 raise exception 'Policy decision grants unsafe'; end if;
 r:=public.nexus_workspace_processing_policy(w,a);
 if r->>'state'<>'APPROVED' or r->>'operator_rights_current'<>'true' then raise exception 'Current reviewed terms invalid: %',r; end if;
 v:=(r->>'policy_version')::bigint;
 begin perform public.nexus_workspace_processing_policy(w,b); raise exception 'Foreign actor admitted';
 exception when raise_exception then if sqlerrm<>'NR:FORBIDDEN' then raise; end if; end;
 insert into public.workspace_members(workspace_id,user_id,role) values(w,b,'admin');
 r:=public.nexus_workspace_processing_policy(w,b);
 if r->>'owner_can_manage'<>'false' then raise exception 'Administrator can approve'; end if;
 begin perform public.nexus_workspace_processing_policy(w,b,'approve',repeat('c',64),v); raise exception 'Admin approval admitted';
 exception when raise_exception then if sqlerrm<>'NR:FORBIDDEN' then raise; end if; end;
 begin perform public.nexus_workspace_processing_policy(w,a,'approve',repeat('c',64),v+1); raise exception 'Stale version admitted';
 exception when raise_exception then if sqlerrm<>'NR:VERSION_CONFLICT' then raise; end if; end;
 begin perform public.nexus_workspace_processing_policy(w,a,'approve',repeat('a',64),v); raise exception 'Old terms admitted';
 exception when raise_exception then if sqlerrm<>'NR:RIGHTS_BLOCKED' then raise; end if; end;
 select count(*) into audits from public.audit_events where action like 'provider.policy.%';
 r:=public.nexus_workspace_processing_policy(w,a,'revoke',null,v);
 if r->>'state'<>'RIGHTS_BLOCKED' or r->>'policy_status'<>'DISABLED' then raise exception 'Revocation failed'; end if;
 v:=(r->>'policy_version')::bigint;
 r:=public.nexus_workspace_processing_policy(w,a,'approve',repeat('c',64),v);
 if r->>'state'<>'APPROVED' or (r->>'policy_version')::bigint<>v+1 then raise exception 'Owner approval failed'; end if;
 if (select count(*) from public.audit_events where action like 'provider.policy.%')<>audits+2 then raise exception 'Decisions not audited'; end if;
 -- A globally reviewed new terms snapshot must invalidate existing owner decisions.
 insert into public.provider_terms_snapshots(provider_id,revision,checked_at,content_hash,retrieval_method,terms,materiality,approved_by)
 values('gemini',2,now(),repeat('d',64),'STATIC_HTML','{"fixture":"changed synthetic terms"}','RIGHTS_REVIEW',a);
 update public.provider_registry set terms_hash=repeat('d',64),terms_checked_at=now() where id='gemini';
 r:=public.nexus_workspace_processing_policy(w,a);
 if r->>'state'<>'RIGHTS_BLOCKED' or r->>'approval_matches_terms'<>'false' then raise exception 'Old owner approval survived terms change'; end if;
 if public.v6_reserve_many(w,'gemini','{"requests":1}','changed-terms-test','interactive','gemini_non_sensitive','non_sensitive')->>'state'<>'RIGHTS_BLOCKED' then raise exception 'Platform bypassed terms change'; end if;
 insert into public.nexus_user_provider_keys(user_id,provider,ciphertext,nonce,key_fingerprint,cost_consent_at)
 values(a,'gemini','synthetic','synthetic','synthetic',now())
 on conflict(user_id,provider) do update set is_active=true,ciphertext=excluded.ciphertext,nonce=excluded.nonce,cost_consent_at=excluded.cost_consent_at;
 if public.nexus_authorize_byok_processing(w,a,'non_sensitive')->>'state'<>'RIGHTS_BLOCKED' then raise exception 'BYOK bypassed terms change'; end if;
 v:=(r->>'policy_version')::bigint;
 update public.provider_registry set status='DISABLED' where id='gemini';
 r:=public.nexus_workspace_processing_policy(w,a,'revoke',null,v);
 if r->>'policy_status'<>'DISABLED' then raise exception 'Disabled rights prevented revocation'; end if;
 begin perform public.nexus_workspace_processing_policy(w,a,'approve',repeat('d',64),(r->>'policy_version')::bigint); raise exception 'Disabled rights approved';
 exception when raise_exception then if sqlerrm<>'NR:RIGHTS_BLOCKED' then raise; end if; end;
 perform set_config('request.jwt.claim.role','authenticated',true);
 begin perform public.nexus_workspace_processing_policy(w,a); raise exception 'Client role decision admitted';
 exception when raise_exception then if sqlerrm<>'NR:FORBIDDEN' then raise; end if; end;
end $$;
rollback;
select 'TERMS_BOUND_OWNER_POLICY_ASSERTIONS_PASS (synthetic local fixtures only)';
