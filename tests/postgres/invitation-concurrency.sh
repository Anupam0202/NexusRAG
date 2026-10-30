#!/usr/bin/env bash
# Only disposable local SQL fixtures; no Supabase/OAuth/provider operation.
set -euo pipefail
: "${PGHOST:?Local Unix socket is required}"
: "${PGPORT:?Local port is required}"
: "${PGUSER:?Local test superuser is required}"
: "${PGDATABASE:?Fresh disposable test database is required}"
[[ "$PGHOST" = /* ]] || { echo 'Invitation rehearsal requires a local Unix socket.' >&2; exit 1; }
TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT
ws='a1111111-1111-4111-8111-111111111111'
owner='22222222-2222-4222-8222-222222222222'
target='a6000000-0000-4000-8000-000000000001'
psql -X -qAt -v ON_ERROR_STOP=1 <<SQL
SET request.jwt.claim.role='service_role';
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES('$target','concurrent-invite@example.invalid',clock_timestamp());
INSERT INTO public.workspaces(id,name,slug,owner_id) VALUES('$ws','Synthetic invitation concurrency','invitation-concurrency','$owner');
INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES('$ws','$owner','owner');
SELECT public.nexus_workspace_invitation('$ws','$owner','create',null,jsonb_build_object('recipient_email','concurrent-invite@example.invalid','role','viewer','token_hash',repeat('d',64),'idempotency_key','concurrent-accept-fixture'));
SQL
# Sixteen simultaneous first-use/replay calls must grant exactly one membership.
pids=()
for i in $(seq 1 16); do
 psql -X -qAt -v ON_ERROR_STOP=1 -c "SET ROLE service_role; SET request.jwt.claim.role='service_role'; SELECT public.nexus_accept_workspace_invitation('$target',repeat('d',64))->>'accepted';" > "$TMP_DIR/$i.out" 2>&1 &
 pids+=("$!")
done
for pid in "${pids[@]}"; do wait "$pid"; done
accepted=$(grep -hxc 'true' "$TMP_DIR"/*.out | awk '{n+=$1} END{print n+0}')
test "$accepted" = 16
psql -X -qAt -v ON_ERROR_STOP=1 <<SQL
DO \$\$ BEGIN
 IF (SELECT count(*) FROM public.workspace_members WHERE workspace_id='$ws' AND user_id='$target')<>1
 OR (SELECT count(*) FROM public.audit_events WHERE workspace_id='$ws' AND action='invitation.accept')<>1 THEN RAISE EXCEPTION 'Concurrent acceptance duplicated authority/audit'; END IF;
END \$\$;
SET request.jwt.claim.role='service_role';
SELECT public.nexus_workspace_invitation('$ws','$owner','create',null,jsonb_build_object('recipient_email','capacity@example.invalid','role','viewer','token_hash',repeat('e',64),'idempotency_key','pending-capacity-fixture'));
SQL
# Independent different recipients race for the remaining 49 pending slots.
pids=()
for i in $(seq 1 64); do
 psql -X -qAt -v ON_ERROR_STOP=1 -c "SET ROLE service_role; SET request.jwt.claim.role='service_role'; SELECT public.nexus_workspace_invitation('$ws','$owner','create',null,jsonb_build_object('recipient_email','capacity-$i@example.invalid','role','viewer','token_hash',encode(sha256(convert_to('synthetic-capacity-$i','UTF8')),'hex'),'idempotency_key','capacity-$i'));" > "$TMP_DIR/capacity-$i.out" 2>&1 &
 pids+=("$!")
done
# Denied calls are expected and checked, never counted as successful operations.
for pid in "${pids[@]}"; do wait "$pid" || true; done
quota=$(grep -hl 'NR:TENANT_QUOTA_EXCEEDED' "$TMP_DIR"/capacity-*.out | wc -l)
test "$quota" = 15
unexpected=$(grep -h 'ERROR:' "$TMP_DIR"/capacity-*.out | grep -v 'NR:TENANT_QUOTA_EXCEEDED' || true)
test -z "$unexpected" || { printf '%s\n' "$unexpected" >&2; exit 1; }
psql -X -qAt -v ON_ERROR_STOP=1 <<SQL
DO \$\$ BEGIN
 IF (SELECT count(*) FROM public.workspace_invitations WHERE workspace_id='$ws' AND state='pending')<>50
 OR (SELECT count(*) FROM public.audit_events WHERE workspace_id='$ws' AND action='invitation.create')<>51 THEN RAISE EXCEPTION 'Pending invitation limit oversubscribed or missing audit'; END IF;
END \$\$;
SQL
echo 'POSTGRES_INVITATION_CONCURRENT_ACCEPT_CAPACITY_PASS (16 replay calls, 64 admission calls; local synthetic only)'
