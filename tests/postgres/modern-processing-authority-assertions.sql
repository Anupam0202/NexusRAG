\set ON_ERROR_STOP on
begin;
set request.jwt.claim.role='';
set request.jwt.claims='{"role":"service_role"}';
insert into public.nexus_user_provider_keys(user_id,provider,ciphertext,nonce,key_fingerprint,cost_consent_at)
values('22222222-2222-4222-8222-222222222222','gemini','synthetic','synthetic','synthetic',now())
on conflict(user_id,provider) do update set is_active=true,ciphertext=excluded.ciphertext,nonce=excluded.nonce,cost_consent_at=excluded.cost_consent_at;
set role service_role;
do $$
declare w constant uuid:='11111111-1111-4111-8111-111111111111';
 a constant uuid:='22222222-2222-4222-8222-222222222222'; r jsonb; v bigint;
begin
 if auth.role()<>'service_role' then raise exception 'Modern service role not resolved'; end if;
 r:=public.nexus_workspace_processing_policy(w,a);
 if r->>'state'<>'APPROVED' then raise exception 'Modern service read denied: %',r; end if;
 v:=(r->>'policy_version')::bigint;
 if public.nexus_authorize_byok_processing(w,a,'non_sensitive')->>'state'<>'READY' then raise exception 'Modern BYOK service admission denied'; end if;
 r:=public.v6_reserve_many(w,'gemini','{"requests":1}','modern-service-fixture','interactive','gemini_non_sensitive','non_sensitive');
 if r->>'state'<>'READY' then raise exception 'Modern operator-funded service admission denied: %',r; end if;
 if public.v6_settle_many(r->'reservations',false)->>'state'<>'RELEASED' then raise exception 'Modern settlement denied'; end if;
 if public.nexus_account_entitlement_status(a)->>'gemini_key_configured'<>'true' then raise exception 'Modern account read denied'; end if;
 if public.nexus_admit_account_operation(a,'chat','00000000-0000-4000-8000-000000000991')->>'state'<>'READY' then raise exception 'Modern account admission denied'; end if;
 perform * from public.claim_expired_document_uploads(1);
 -- Modern authenticated/anonymous roles remain blocked despite valid owner IDs.
 for r in select to_jsonb(x) from (values('authenticated'),('anon')) roles(x) loop
  perform set_config('request.jwt.claims',jsonb_build_object('role',r#>>'{}')::text,true);
  begin perform public.nexus_workspace_processing_policy(w,a,'approve',repeat('c',64),v); raise exception 'Modern browser role admitted';
  exception when raise_exception then if sqlerrm<>'NR:FORBIDDEN' then raise; end if; end;
  begin perform public.nexus_account_entitlement_status(a); raise exception 'Modern browser account read admitted';
  exception when raise_exception then if sqlerrm<>'NR:INVALID_SCOPE' then raise; end if; end;
  begin perform public.nexus_admit_account_operation(a,'chat','00000000-0000-4000-8000-000000000992'); raise exception 'Modern browser account admission admitted';
  exception when raise_exception then if sqlerrm<>'NR:INVALID_SCOPE' then raise; end if; end;
  begin perform * from public.claim_expired_document_uploads(1); raise exception 'Modern browser cleanup admitted';
  exception when insufficient_privilege then if sqlerrm<>'NR:FORBIDDEN' then raise; end if; end;
  if public.nexus_authorize_byok_processing(w,a,'non_sensitive')->>'state'<>'RIGHTS_BLOCKED' then raise exception 'Modern browser BYOK admitted'; end if;
  if public.v6_reserve_many(w,'gemini','{"requests":1}','modern-browser-denied','interactive','gemini_non_sensitive','non_sensitive')->>'state'<>'RIGHTS_BLOCKED' then raise exception 'Modern browser platform admitted'; end if;
 end loop;
end $$;
reset role;
rollback;
select 'MODERN_VERIFIED_SERVICE_AUTHORITY_ASSERTIONS_PASS (synthetic local fixtures only)';
