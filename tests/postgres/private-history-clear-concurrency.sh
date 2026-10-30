#!/usr/bin/env bash
# Lock-wait authority tests in the disposable fixture database only.
set -euo pipefail
: "${PGHOST:?}" "${PGPORT:?}" "${PGUSER:?}" "${PGDATABASE:?}"
w=11111111-1111-4111-8111-111111111111
actor=33333333-3333-4333-8333-333333333333
session=c1111111-1111-4111-8111-111111111111
logs=$(mktemp -d)
finish() {
  status=$?
  if [[ "$status" -ne 0 ]]; then
    echo "PRIVATE_HISTORY_CLEAR_CONCURRENCY_FAILED stage=${stage:-setup}"
    for log in "$logs/locker" "$logs/clear"; do
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
  cat "$logs/locker"
  return 1
}
reset_fixture() {
  sql -c "set request.jwt.claim.role='service_role';
    update public.workspaces set lifecycle_state='active' where id='$w';
    insert into public.workspace_members(workspace_id,user_id,role) values('$w','$actor','viewer') on conflict do nothing;
    delete from public.chat_sessions where id='$session';
    insert into public.chat_sessions(id,workspace_id,user_id,title) values('$session','$w','$actor','Synthetic clear race');
    insert into public.chat_messages(workspace_id,session_id,role,content) values('$w','$session','user','Synthetic race fixture');"
}
clear_sql="set role authenticated;set request.jwt.claim.role='authenticated';set request.jwt.claim.sub='$actor';select public.clear_private_history('$w','$session');"

for boundary in membership workspace tombstone; do
  stage="deny-after-$boundary"
  reset_fixture
  case "$boundary" in
    membership) mutation="delete from public.workspace_members where workspace_id='$w' and user_id='$actor';" ;;
    workspace) mutation="update public.workspaces set lifecycle_state='deleting' where id='$w';" ;;
    tombstone) mutation="update public.chat_sessions set deleted_at=clock_timestamp() where id='$session';" ;;
  esac
  : >"$logs/locker"
  sql >"$logs/locker" 2>&1 <<SQL &
begin;
set request.jwt.claim.role='service_role';
$mutation
\echo LOCKED
select pg_sleep(1);
commit;
SQL
  locker=$!
  await_lock
  sql -At -c "$clear_sql" >"$logs/clear"
  wait "$locker"
  grep -q '^\[\]$' "$logs/clear"
  test "$(sql -At -c "select count(*) from public.chat_messages where session_id='$session'")" = 1
done

# Cleanup first: later revocation must wait; the receipt counts committed deletions.
stage=cleanup-before-revocation
reset_fixture
: >"$logs/locker"
sql >"$logs/locker" 2>&1 <<SQL &
begin;
$clear_sql
\echo LOCKED
select pg_sleep(1);
commit;
SQL
locker=$!
await_lock
sql -c "set request.jwt.claim.role='service_role';delete from public.workspace_members where workspace_id='$w' and user_id='$actor';"
wait "$locker"
grep -q '"durable_messages_deleted": 1' "$logs/locker"
test "$(sql -At -c "select count(*) from public.chat_messages where session_id='$session'")" = 0
sql -At -c "$clear_sql" >"$logs/clear"
grep -q '^\[\]$' "$logs/clear"

# Exact review interleaving: direct DELETE holds membership while its AFTER
# revision trigger waits for cleanup's workspace lock. NOWAIT must fail cleanly.
stage=inverse-membership-lock-order
reset_fixture
: >"$logs/locker"
sql >"$logs/locker" 2>&1 <<SQL &
begin;
select 1 from public.workspaces where id='$w' for no key update;
\echo LOCKED
do \$\$ declare waiting boolean=false; begin
 for i in 1..200 loop
  perform pg_stat_clear_snapshot();
  select exists(select 1 from pg_stat_activity where application_name='private-clear-revocation-test'
   and wait_event_type='Lock') into waiting;
  exit when waiting;
  perform pg_sleep(0.02);
 end loop;
 if not waiting then raise exception 'revocation did not reach workspace lock wait'; end if;
end \$\$;
set local role authenticated;
set request.jwt.claim.role='authenticated';
set request.jwt.claim.sub='$actor';
do \$\$ begin
 begin
  perform public.clear_private_history('$w','$session');
  raise exception 'cleanup accepted contested membership';
 exception when lock_not_available then null;
 end;
end \$\$;
commit;
SQL
locker=$!
await_lock
PGAPPNAME=private-clear-revocation-test sql -c "set request.jwt.claim.role='service_role';
 delete from public.workspace_members where workspace_id='$w' and user_id='$actor';"
wait "$locker"
test "$(sql -At -c "select count(*) from public.chat_messages where session_id='$session'")" = 1
test "$(sql -At -c "select count(*) from public.workspace_members where workspace_id='$w' and user_id='$actor'")" = 0

# Existing locked appends serialize with clear; a later turn is not an erasure failure.
stage=locked-append-before-clear
reset_fixture
: >"$logs/locker"
sql >"$logs/locker" 2>&1 <<SQL &
begin;
set request.jwt.claim.role='service_role';
select public.append_chat_turn('$w','$session','$actor','Synthetic question','Synthetic answer','[]','{}');
\echo LOCKED
select pg_sleep(1);
commit;
SQL
locker=$!
await_lock
sql -At -c "$clear_sql" >"$logs/clear"
wait "$locker"
grep -q '"durable_messages_deleted": 3' "$logs/clear"
test "$(sql -At -c "select count(*) from public.chat_messages where session_id='$session'")" = 0
sql -c "set request.jwt.claim.role='service_role';select public.append_chat_turn('$w','$session','$actor','New question','New answer','[]','{}');"
test "$(sql -At -c "select count(*) from public.chat_messages where session_id='$session'")" = 2
sql -c "set request.jwt.claim.role='service_role';delete from public.chat_sessions where id='$session';
 delete from public.workspace_members where workspace_id='$w' and user_id='$actor';"
echo 'PRIVATE_HISTORY_CLEAR_CONCURRENT_AUTHORITY_PASS (local fixture, not hosted OAuth or complete erasure)'
