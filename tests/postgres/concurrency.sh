#!/usr/bin/env bash
set -euo pipefail
: "${PGHOST:?Set PGHOST to the local PostgreSQL socket directory}"
: "${PGPORT:?Set PGPORT to the local PostgreSQL port}"
: "${PGUSER:?Set PGUSER to a local test superuser}"
export PGDATABASE="${PGDATABASE:-postgres}"
TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT
psql -X -qAt -v ON_ERROR_STOP=1 <<'SQL'
DELETE FROM public.budget_reservations WHERE idempotency_key IN ('race-settle-seed','concurrent-A','concurrent-same-key');
UPDATE public.resource_budgets SET used=0,reserved=0 WHERE provider_id='gemini' AND dimension IN ('race','idem','settlement');
SET ROLE service_role; SET request.jwt.claim.role='service_role';
DO $$ DECLARE r jsonb; BEGIN
 r:=public.v6_reserve_budget('11111111-1111-4111-8111-111111111111','gemini','settlement',10,'race-settle-seed','interactive');
 IF r->>'state'<>'READY' THEN RAISE EXCEPTION 'seed settlement: %',r; END IF;
END $$;
SQL
# v6_reserve_budget stores the exact idempotency key.
r_id=$(psql -X -qAt -v ON_ERROR_STOP=1 -c "select id from public.budget_reservations where idempotency_key='race-settle-seed'")
cat > $TMP_DIR/a-reserve.sql <<'SQL'
BEGIN; SET ROLE service_role; SET request.jwt.claim.role='service_role';
SELECT public.v6_reserve_budget('11111111-1111-4111-8111-111111111111','gemini','race',60,'concurrent-A','interactive');
SELECT pg_sleep(3); COMMIT;
SQL
cat > $TMP_DIR/b-reserve.sql <<'SQL'
SET ROLE service_role; SET request.jwt.claim.role='service_role';
SELECT public.v6_reserve_budget('11111111-1111-4111-8111-111111111111','gemini','race',60,'concurrent-B','interactive');
SQL
psql -X -qAt -v ON_ERROR_STOP=1 -f $TMP_DIR/a-reserve.sql > $TMP_DIR/a-reserve.out & a_pid=$!
sleep 0.4
b_start=$(date +%s)
psql -X -qAt -v ON_ERROR_STOP=1 -f $TMP_DIR/b-reserve.sql > $TMP_DIR/b-reserve.out
b_elapsed=$(( $(date +%s) - b_start ))
wait "$a_pid"
cat $TMP_DIR/a-reserve.out $TMP_DIR/b-reserve.out
if [ "$b_elapsed" -lt 2 ]; then echo "reservation contention did not block: ${b_elapsed}s" >&2; exit 1; fi
b_state=$(cat $TMP_DIR/b-reserve.out | grep -o 'TRY_AFTER_RESET\|READY\|QUOTA_EXHAUSTED' | tail -1)
[ "$b_state" = "TRY_AFTER_RESET" ] || { echo "unexpected second reservation state: $b_state" >&2; exit 1; }
psql -X -qAt -v ON_ERROR_STOP=1 <<'SQL'
DO $$ DECLARE g bigint; w bigint; n int; BEGIN
 SELECT reserved INTO g FROM public.resource_budgets WHERE scope_key='global' AND provider_id='gemini' AND dimension='race';
 SELECT reserved INTO w FROM public.resource_budgets WHERE scope_key='workspace:11111111-1111-4111-8111-111111111111' AND provider_id='gemini' AND dimension='race';
 SELECT count(*) INTO n FROM public.budget_reservations WHERE idempotency_key like 'concurrent-%' AND state='RESERVED';
 IF g<>60 OR w<>60 OR n<>1 THEN RAISE EXCEPTION 'oversubscribed: global %, workspace %, reservations %',g,w,n; END IF;
END $$;
SQL
# Same idempotency key serializes concurrent requests: second must be denied as in-progress.
cat > $TMP_DIR/a-idem.sql <<'SQL'
BEGIN; SET ROLE service_role; SET request.jwt.claim.role='service_role';
SELECT public.v6_reserve_budget('11111111-1111-4111-8111-111111111111','gemini','idem',5,'concurrent-same-key','interactive');
SELECT pg_sleep(3); COMMIT;
SQL
cat > $TMP_DIR/b-idem.sql <<'SQL'
SET ROLE service_role; SET request.jwt.claim.role='service_role';
SELECT public.v6_reserve_budget('11111111-1111-4111-8111-111111111111','gemini','idem',5,'concurrent-same-key','interactive');
SQL
psql -X -qAt -v ON_ERROR_STOP=1 -f $TMP_DIR/a-idem.sql > $TMP_DIR/a-idem.out & a_pid=$!
sleep 0.4
psql -X -qAt -v ON_ERROR_STOP=1 -f $TMP_DIR/b-idem.sql > $TMP_DIR/b-idem.out
wait "$a_pid"
cat $TMP_DIR/a-idem.out $TMP_DIR/b-idem.out
if ! grep -q 'RESERVATION_IN_PROGRESS' $TMP_DIR/b-idem.out; then echo 'same-key replay was not serialized/denied' >&2; exit 1; fi
# Concurrent settlement: exactly one measurement is charged, the second returns replay state.
psql -X -qAt -v ON_ERROR_STOP=1 -c "BEGIN; SET ROLE service_role; SET request.jwt.claim.role='service_role'; SELECT public.v6_settle_budget('${r_id}'::uuid,5,true); SELECT pg_sleep(2); COMMIT;" > $TMP_DIR/a-settle.out & a_pid=$!
sleep 0.3
psql -X -qAt -v ON_ERROR_STOP=1 -c "SET ROLE service_role; SET request.jwt.claim.role='service_role'; SELECT public.v6_settle_budget('${r_id}'::uuid,5,true);" > $TMP_DIR/b-settle.out
wait "$a_pid"
cat $TMP_DIR/a-settle.out $TMP_DIR/b-settle.out
psql -X -qAt -v ON_ERROR_STOP=1 <<'SQL'
DO $$ DECLARE u bigint; r bigint; got_state text; BEGIN
 SELECT used,reserved INTO u,r FROM public.resource_budgets WHERE scope_key='global' AND provider_id='gemini' AND dimension='settlement';
 SELECT br.state INTO got_state FROM public.budget_reservations br WHERE idempotency_key='race-settle-seed';
 IF u<>5 OR r<>0 OR got_state<>'SETTLED' THEN RAISE EXCEPTION 'settlement race: used %, reserved %, state %',u,r,got_state; END IF;
END $$;
SELECT 'concurrent_reservation_settlement_pass';
SQL
