#!/usr/bin/env bash
# Disposable synthetic database only; never hosted users or customer history.
set -euo pipefail
: "${PGHOST:?}" "${PGPORT:?}" "${PGUSER:?}" "${PGDATABASE:?}"
w=11111111-1111-4111-8111-111111111111
actor=33333333-3333-4333-8333-333333333333
session=e1111111-1111-4111-8111-111111111111
k1=e0000000-0000-4000-8000-000000000001
k2=e0000000-0000-4000-8000-000000000002
logs=$(mktemp -d)
finish() {
  status=$?
  if [[ "$status" -ne 0 ]]; then
    echo "GATEWAY_PRIVATE_TURN_CONCURRENCY_FAILED stage=${stage:-setup}"
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
reset_fixture() {
  sql -c "set request.jwt.claim.role='service_role';
    update public.workspaces set lifecycle_state='active' where id='$w';
    insert into public.workspace_members(workspace_id,user_id,role) values('$w','$actor','editor')
      on conflict(workspace_id,user_id) do update set role='editor';
    delete from public.chat_sessions where id='$session';
    insert into public.chat_sessions(id,workspace_id,user_id,title) values('$session','$w','$actor','Synthetic turn race');
    insert into public.nexus_account_operations(user_id,operation,idempotency_key,outcome)
      values('$actor','chat','$k1','{\"state\":\"READY\"}'),('$actor','chat','$k2','{\"state\":\"READY\"}')
      on conflict(user_id,operation,idempotency_key) do update set outcome=excluded.outcome,created_at=clock_timestamp();"
  sql -c "set request.jwt.claim.role='service_role';
    select public.stage_gateway_private_turn('$actor','$w','$session','$k1',1,'Synthetic question','Synthetic answer','[]','{}');
    select public.stage_gateway_private_turn('$actor','$w','$session','$k2',1,'Concurrent question','Concurrent answer','[]','{}');"
}
authority="set role authenticated;set request.jwt.claim.role='authenticated';set request.jwt.claim.sub='$actor';"
commit1="select public.commit_gateway_private_turn('$w','$session','$k1',1,'Synthetic question','Synthetic answer','[]','{}');"
commit2="select public.commit_gateway_private_turn('$w','$session','$k2',1,'Concurrent question','Concurrent answer','[]','{}');"

for boundary in membership workspace; do
  stage="deny-after-$boundary"
  reset_fixture
  if [[ "$boundary" == membership ]]; then
    mutation="delete from public.workspace_members where workspace_id='$w' and user_id='$actor';"
  else
    mutation="update public.workspaces set lifecycle_state='deleting' where id='$w';"
  fi
  : >"$logs/locker"
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
  stage="fence-after-$operation"
  reset_fixture; : >"$logs/locker"
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

# A different session cannot reuse an already committed key, even concurrently.
stage=one-admission-two-sessions
reset_fixture; : >"$logs/locker"
sql >"$logs/locker" 2>&1 <<SQL &
begin;
$authority
$commit1
\echo LOCKED
select pg_sleep(1);
commit;
SQL
locker=$!; await_lock
sql -At -c "$authority select public.commit_gateway_private_turn('$w','e2222222-2222-4222-8222-222222222222','$k1',0,'Replay','Replay','[]','{}');" >"$logs/write"
wait "$locker"; grep -q '"state": "CONFLICT"' "$logs/write"
test "$(sql -At -c "select count(*) from public.chat_sessions where id='e2222222-2222-4222-8222-222222222222'")" = 0

# Match direct member DELETE's inverse workspace-trigger order. A contested
# membership must fail NOWAIT, not deadlock or write after stale authority.
stage=inverse-membership-lock-order
reset_fixture; : >"$logs/locker"
sql >"$logs/locker" 2>&1 <<SQL &
begin;
select 1 from public.workspaces where id='$w' for no key update;
\echo LOCKED
do \$\$ declare waiting boolean=false; begin
 for i in 1..200 loop
  perform pg_stat_clear_snapshot();
  select exists(select 1 from pg_stat_activity where application_name='private-turn-revocation-test'
   and wait_event_type='Lock') into waiting;
  exit when waiting; perform pg_sleep(0.02);
 end loop;
 if not waiting then raise exception 'revocation did not reach workspace lock wait'; end if;
end \$\$;
$authority
do \$\$ begin
 begin
  perform public.commit_gateway_private_turn('$w','$session','$k1',1,'Question','Answer','[]','{}');
  raise exception 'contested membership accepted' using errcode='XX000';
 exception when lock_not_available then null;
 end;
end \$\$;
commit;
SQL
locker=$!; await_lock
PGAPPNAME=private-turn-revocation-test sql -c "set request.jwt.claim.role='service_role';delete from public.workspace_members where workspace_id='$w' and user_id='$actor';"
wait "$locker"
test "$(sql -At -c "select count(*) from public.chat_messages where session_id='$session'")" = 0
sql -c "set request.jwt.claim.role='service_role';delete from public.chat_sessions where id='$session';
 delete from public.nexus_account_operations where user_id='$actor' and idempotency_key in('$k1','$k2');"
echo 'GATEWAY_PRIVATE_TURN_CONCURRENT_AUTHORITY_PASS (synthetic PostgreSQL, not hosted OAuth)'
