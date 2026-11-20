#!/usr/bin/env bash
# Only the fresh, disposable synthetic PostgreSQL rehearsal database.
set -euo pipefail
: "${PGHOST:?}" "${PGPORT:?}" "${PGUSER:?}" "${PGDATABASE:?}"
w=11111111-1111-4111-8111-111111111111
actor=33333333-3333-4333-8333-333333333333
session=c1111111-1111-4111-8111-111111111111
login=c0000000-0000-4000-8000-000000000001
k1=c0000000-0000-4000-8000-000000000010
k2=c0000000-0000-4000-8000-000000000011
logs=$(mktemp -d)
finish() {
 status=$?
 if [[ "$status" -ne 0 ]]; then
  echo "BACKEND_PRIVATE_TURN_CONCURRENCY_FAILED stage=${stage:-setup}"
  for log in "$logs/locker" "$logs/write"; do
   if [[ -f "$log" ]]; then tail -n 60 "$log"; fi
  done
 fi
 rm -rf "$logs"
 exit "$status"
}
trap finish EXIT
sql() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }
await_lock() {
 for _ in $(seq 1 200); do
  if grep -q '^LOCKED$' "$logs/locker"; then return; fi
  sleep 0.02
 done
 cat "$logs/locker"; return 1
}
authority="set role authenticated;set request.jwt.claim.role='authenticated';set request.jwt.claim.sub='$actor';
 select set_config('request.jwt.claims',jsonb_build_object('session_id','$login','exp',extract(epoch from clock_timestamp())+3600)::text,false);"
commit1="select public.commit_backend_private_turn('$w','$session','$k1',1,0,'Question','Answer','[]','{}');"
commit2="select public.commit_backend_private_turn('$w','$session','$k2',1,0,'Second','Second answer','[]','{}');"
reset_fixture() {
 sql -c "set request.jwt.claim.role='service_role';
  update public.workspaces set lifecycle_state='active' where id='$w';
  insert into public.workspace_members(workspace_id,user_id,role) values('$w','$actor','viewer')
   on conflict(workspace_id,user_id) do update set role='viewer';
  insert into auth.sessions(id,user_id) values('$login','$actor')
   on conflict(id) do update set user_id=excluded.user_id,not_after=null;
  delete from public.chat_sessions where id='$session';
  insert into public.chat_sessions(id,workspace_id,user_id,title) values('$session','$w','$actor','Synthetic race');
  delete from public.nexus_account_operations where user_id='$actor' and operation='backend_private_turn' and idempotency_key in('$k1','$k2');
  select public.stage_backend_private_turn('$actor','$w','$session','$k1',1,0,'Question','Answer','[]','{}');
  select public.stage_backend_private_turn('$actor','$w','$session','$k2',1,0,'Second','Second answer','[]','{}');"
}
for boundary in membership workspace; do
 stage="deny-after-$boundary"; reset_fixture
 if [[ "$boundary" == membership ]]; then
  mutation="delete from public.workspace_members where workspace_id='$w' and user_id='$actor';"
 else mutation="update public.workspaces set lifecycle_state='deleting' where id='$w';"; fi
 sql >"$logs/locker" 2>&1 <<SQL &
begin;
set request.jwt.claim.role='service_role';
$mutation
\echo LOCKED
select pg_sleep(1);
commit;
SQL
 locker=$!; await_lock
 sql -At -c "$authority $commit1" >"$logs/write"
 wait "$locker"; grep -q '^\[\]$' "$logs/write"
 test "$(sql -At -c "select count(*) from public.chat_messages where session_id='$session'")" = 0
done
for operation in append clear; do
 stage="fence-after-$operation"; reset_fixture
 if [[ "$operation" == append ]]; then first="$commit1"; else first="select public.clear_private_history('$w','$session');"; fi
 sql >"$logs/locker" 2>&1 <<SQL &
begin;
$authority
$first
\echo LOCKED
select pg_sleep(1);
commit;
SQL
 locker=$!; await_lock
 sql -At -c "$authority $commit2" >"$logs/write"
 wait "$locker"; grep -q '"state": "CONFLICT"' "$logs/write"
 count=0; if [[ "$operation" == append ]]; then count=2; fi
 test "$(sql -At -c "select count(*) from public.chat_messages where session_id='$session'")" = "$count"
done
# A legacy writer that does not update revision still blocks through the epoch.
stage=legacy-epoch; reset_fixture
sql >"$logs/locker" 2>&1 <<SQL &
begin;
insert into public.chat_messages(workspace_id,session_id,role,content) values('$w','$session','user','Legacy');
\echo LOCKED
select pg_sleep(1);
commit;
SQL
locker=$!; await_lock
if sql -At -c "$authority $commit1" >"$logs/write" 2>&1; then
 echo 'contested legacy session unexpectedly committed'; exit 1
fi
grep -q 'could not obtain lock' "$logs/write"
wait "$locker"
sql -At -c "$authority $commit1" >"$logs/write"
grep -q '"state": "CONFLICT"' "$logs/write"
test "$(sql -At -c "select count(*) from public.chat_messages where session_id='$session'")" = 1

# Expiry while waiting for the workspace lock must be rechecked before ANY
# creation/insert, even though the initial JWT/session check succeeded.
stage=expiry-after-wait; reset_fixture
sql >"$logs/locker" 2>&1 <<SQL &
begin;
select 1 from public.workspaces where id='$w' for no key update;
\echo LOCKED
select pg_sleep(1);
commit;
SQL
locker=$!; await_lock
sql -At -c "set role authenticated;set request.jwt.claim.role='authenticated';set request.jwt.claim.sub='$actor';
 select set_config('request.jwt.claims',jsonb_build_object('session_id','$login','exp',extract(epoch from clock_timestamp())+0.2)::text,false); $commit1" >"$logs/write"
wait "$locker"; grep -q '^\[\]$' "$logs/write"
test "$(sql -At -c "select count(*) from public.chat_messages where session_id='$session'")" = 0

stage=auth-revocation-contention; reset_fixture
sql >"$logs/locker" 2>&1 <<SQL &
begin;
delete from auth.sessions where id='$login';
\echo LOCKED
select pg_sleep(1);
commit;
SQL
locker=$!; await_lock
if sql -At -c "$authority $commit1" >"$logs/write" 2>&1; then
 echo 'contested auth session unexpectedly committed'; exit 1
fi
grep -q 'could not obtain lock' "$logs/write"
wait "$locker"
sql -At -c "$authority $commit1" >"$logs/write"
grep -q '^\[\]$' "$logs/write"
test "$(sql -At -c "select count(*) from public.chat_messages where session_id='$session'")" = 0

stage=inverse-membership-lock-order; reset_fixture
sql >"$logs/locker" 2>&1 <<SQL &
begin;
select 1 from public.workspaces where id='$w' for no key update;
\echo LOCKED
do \$\$ declare waiting boolean=false; begin
 for i in 1..200 loop
  perform pg_stat_clear_snapshot();
  select exists(select 1 from pg_stat_activity where application_name='backend-turn-revocation-test'
   and wait_event_type='Lock') into waiting;
  exit when waiting; perform pg_sleep(0.02);
 end loop;
 if not waiting then raise exception 'revocation never reached workspace wait'; end if;
end \$\$;
$authority
do \$\$ begin
 begin
  perform public.commit_backend_private_turn('$w','$session','$k1',1,0,'Question','Answer','[]','{}');
  raise exception 'contested membership accepted' using errcode='XX000';
 exception when lock_not_available then null;
 end;
end \$\$;
commit;
SQL
locker=$!; await_lock
PGAPPNAME=backend-turn-revocation-test sql -c "set request.jwt.claim.role='service_role';delete from public.workspace_members where workspace_id='$w' and user_id='$actor';"
wait "$locker"
test "$(sql -At -c "select count(*) from public.chat_messages where session_id='$session'")" = 0
sql -c "delete from public.chat_sessions where id='$session';delete from auth.sessions where id='$login';
 delete from public.nexus_account_operations where user_id='$actor' and operation='backend_private_turn' and idempotency_key in('$k1','$k2');"
echo 'BACKEND_PRIVATE_TURN_CONCURRENT_AUTHORITY_PASS (synthetic PostgreSQL, not hosted OAuth)'
