\set ON_ERROR_STOP on
SET request.jwt.claim.role='service_role';
INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
 ('22222222-2222-4222-8222-222222222222','a@example.invalid','{"display_name":"A"}'),
 ('33333333-3333-4333-8333-333333333333','b@example.invalid','{"display_name":"B"}');
INSERT INTO public.workspaces(id,name,slug,owner_id) VALUES
 ('11111111-1111-4111-8111-111111111111','A workspace','workspace-a','22222222-2222-4222-8222-222222222222'),
 ('44444444-4444-4444-8444-444444444444','B workspace','workspace-b','33333333-3333-4333-8333-333333333333');
INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES
 ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','owner'),
 ('44444444-4444-4444-8444-444444444444','33333333-3333-4333-8333-333333333333','owner');
INSERT INTO public.provider_registry(id,display_name,authority,documentation_url,terms_url,status)
VALUES ('gemini','Synthetic rehearsal provider','Synthetic only','https://example.invalid/docs','https://example.invalid/terms','APPROVED');
INSERT INTO public.workspace_provider_policies(workspace_id,provider_id,status,rights_hash)
VALUES ('11111111-1111-4111-8111-111111111111','gemini','APPROVED',repeat('a',64)),
       ('44444444-4444-4444-8444-444444444444','gemini','APPROVED',repeat('b',64));
INSERT INTO public.resource_budgets(scope_key,workspace_id,provider_id,dimension,hard_limit,window_kind,reset_at,state)
SELECT scope,workspace_id,'gemini',dimension,100,'daily','2030-01-01T00:00:00Z','READY'
FROM (VALUES
 ('global',null::uuid),
 ('workspace:11111111-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111111'::uuid),
 ('workspace:44444444-4444-4444-8444-444444444444','44444444-4444-4444-8444-444444444444'::uuid)
) scopes(scope,workspace_id)
CROSS JOIN (VALUES ('requests'),('input_tokens'),('output_tokens'),('race'),('idem'),('rollback'),('settlement')) dims(dimension);
