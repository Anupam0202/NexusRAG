-- Creating a workspace failed on hosted Supabase with "permission denied for table users":
-- nexus_create_workspace checks the actor in auth.users with the caller's rights, and the service role that
-- the gateway uses cannot read the auth schema there. Run it with the owner's rights, like the other
-- functions that read auth.users. Its search path is already pinned, and only the service role may execute it.
alter function public.nexus_create_workspace(uuid, text, text, text) security definer;
revoke all on function public.nexus_create_workspace(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.nexus_create_workspace(uuid, text, text, text) to service_role;
