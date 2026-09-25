#!/usr/bin/env bash
set -euo pipefail
: "${PGHOST:?Set PGHOST to the local PostgreSQL socket directory}"
: "${PGPORT:?Set PGPORT to the local PostgreSQL port}"
: "${PGUSER:?Set PGUSER to a local test superuser}"
export PGDATABASE="${PGDATABASE:-postgres}"
TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT
user='33333333-3333-4333-8333-333333333333'
psql -X -qAt -v ON_ERROR_STOP=1 <<SQL
SET ROLE service_role;
SET request.jwt.claim.role='service_role';
DELETE FROM public.nexus_account_operations WHERE user_id='$user' AND operation='chat';
INSERT INTO public.nexus_account_usage(user_id,free_chat_queries,lifetime_documents)
VALUES ('$user',0,0)
ON CONFLICT(user_id) DO UPDATE SET free_chat_queries=0,lifetime_documents=0,updated_at=clock_timestamp();
DELETE FROM public.nexus_user_provider_keys WHERE user_id='$user' AND provider='gemini';
RESET ROLE;
SQL

for i in $(seq 1 16); do
  key=$(python3 -c 'import uuid; print(uuid.uuid4())')
  psql -X -qAt -v ON_ERROR_STOP=1 -c \
    "SET ROLE service_role; SET request.jwt.claim.role='service_role'; SELECT public.nexus_admit_account_operation('$user','chat','$key'::uuid)->>'state';" \
    > "$TMP_DIR/$i.out" &
done
wait
ready=$(grep -hxc 'READY' "$TMP_DIR"/*.out | awk '{n+=$1} END{print n+0}')
denied=$(grep -hxc 'BYOK_REQUIRED' "$TMP_DIR"/*.out | awk '{n+=$1} END{print n+0}')
if [[ "$ready" -ne 5 || "$denied" -ne 11 ]]; then
  echo "trial oversubscription or unexpected state: READY=$ready BYOK_REQUIRED=$denied" >&2
  cat "$TMP_DIR"/*.out >&2
  exit 1
fi
psql -X -qAt -v ON_ERROR_STOP=1 -c \
  "DO \$\$ DECLARE n integer; BEGIN SELECT free_chat_queries INTO n FROM public.nexus_account_usage WHERE user_id='$user'; IF n<>5 THEN RAISE EXCEPTION 'expected exactly five trials, got %',n; END IF; END \$\$;"
echo 'concurrent_account_trial_limit_pass'