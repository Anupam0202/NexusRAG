-- Backfill profiles for users that existed before the NexusRAG schema trigger
-- was installed in production.

insert into public.profiles (id, email, display_name, avatar_url)
select
  users.id,
  users.email,
  coalesce(
    users.raw_user_meta_data ->> 'display_name',
    users.raw_user_meta_data ->> 'name',
    nullif(split_part(coalesce(users.email, ''), '@', 1), '')
  ) as display_name,
  users.raw_user_meta_data ->> 'avatar_url' as avatar_url
from auth.users as users
where not exists (
  select 1
  from public.profiles as profiles
  where profiles.id = users.id
)
on conflict (id) do update set
  email = excluded.email,
  display_name = coalesce(public.profiles.display_name, excluded.display_name),
  avatar_url = coalesce(public.profiles.avatar_url, excluded.avatar_url),
  updated_at = now();
