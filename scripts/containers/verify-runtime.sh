#!/usr/bin/env bash
# Local images only: no provider credentials, registry pushes or cloud resources.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
cd "$ROOT"
SHA=$(git rev-parse HEAD)
WORK=$(mktemp -d)
BACKEND="nexusrag-backend-check:${SHA:0:12}"
FRONTEND="nexusrag-frontend-check:${SHA:0:12}"
CHECK="nexusrag-backend-tests:${SHA:0:12}"
backend_container=''
frontend_container=''
cleanup() {
  for container in "$backend_container" "$frontend_container"; do
    if [[ -n "$container" ]]; then docker rm -f "$container" >/dev/null 2>&1 || true; fi
  done
  rm -rf "$WORK"
}
trap cleanup EXIT

docker build --build-arg SOURCE_COMMIT="$SHA" -t "$BACKEND" backend
docker build --build-arg SOURCE_COMMIT="$SHA" \
  --build-arg NEXT_PUBLIC_API_URL=http://localhost:8000 \
  --build-arg NEXT_PUBLIC_SITE_URL=http://localhost:3000 \
  --build-arg NEXT_PUBLIC_SUPABASE_URL=https://supabase.invalid \
  --build-arg NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=synthetic-public-browser-test-key \
  -t "$FRONTEND" frontend

for image in "$BACKEND" "$FRONTEND"; do
  user=$(docker inspect --format '{{.Config.User}}' "$image")
  [[ -n "$user" && "$user" != root && "$user" != 0 ]]
  [[ "$(docker inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$image")" = "$SHA" ]]
  docker run --rm --network none --entrypoint sh "$image" -c 'test -z "$(find /app -type f \( -name .env -o -name ".env.*" \) ! -name .env.example -print -quit)"'
  docker inspect --format 'image={{.Id}} source={{index .Config.Labels "org.opencontainers.image.revision"}} user={{.Config.User}} bytes={{.Size}}' "$image"
done

# This deliberately uses the real neural model, not hash embeddings or mocks.
docker run --rm -i --network none \
  -e HF_HUB_OFFLINE=1 -e TRANSFORMERS_OFFLINE=1 \
  -e ENABLE_LIGHTWEIGHT_EMBEDDINGS=false --entrypoint python "$BACKEND" - <<'PY'
import math, os
from src.ingestion.embedder import Embedder
embedder = Embedder()
assert not embedder._lightweight
assert embedder._revision == os.environ['EMBEDDING_REVISION']
vector = embedder.embed_query('Non-sensitive container build fixture')
assert len(vector) == 384 and all(math.isfinite(value) for value in vector)
assert abs(sum(value * value for value in vector) - 1) < 1e-4
print('REAL_OFFLINE_NEURAL_EMBEDDING_PASSED', len(vector), embedder._revision)
PY

# Repository-contract tests also inspect migrations/configuration outside backend.
# Give the derived image the exact tracked source, without expanding production
# image scope or copying ignored credentials/node_modules from the checkout.
mkdir -p "$WORK/verified-source"
git archive HEAD | tar -x -C "$WORK/verified-source"
# Add test tools to a derived image; retain the actual heavyweight runtime deps.
cat > "$WORK/Dockerfile" <<EOF
FROM $BACKEND
USER root
RUN pip install --no-cache-dir pytest==9.1.1 pytest-asyncio==1.4.0
COPY --chown=nexusrag:nexusrag verified-source /verification
WORKDIR /verification/backend
USER nexusrag
EOF
docker build -t "$CHECK" "$WORK"
docker run --rm --network none --entrypoint python "$CHECK" scripts/run_full_tests.py -o cache_dir=/tmp/pytest-cache

# Inspect the installed runtime, rather than mistaking requirements for an SBOM.
docker run --rm -i --network none --entrypoint python "$BACKEND" - > "$WORK/python-runtime.json" <<'PY'
import importlib.metadata as m, json
rows=[]
for d in m.distributions():
    rows.append({'name':d.metadata['Name'],'version':d.version,
                 'license':d.metadata.get('License-Expression') or d.metadata.get('License') or 'UNKNOWN',
                 'license_classifiers':[v for v in d.metadata.get_all('Classifier',[]) if v.startswith('License ::')]})
print(json.dumps(sorted(rows,key=lambda v:v['name'].lower())))
PY
python3 - "$WORK" <<'PY'
import json, pathlib, sys
root=pathlib.Path(sys.argv[1]); rows=json.loads((root/'python-runtime.json').read_text())
# PyPI advisories use public versions; retain actual CPU/local versions in inventory.
(root/'audit-requirements.txt').write_text(''.join(f"{r['name']}=={r['version'].split('+')[0]}\n" for r in rows))
print('Installed runtime distributions:',len(rows))
print('Licence metadata is inventory, not a commercial distribution rights approval.')
for r in rows:
    import hashlib
    licence=r['license']
    print(r['name'], r['version'], json.dumps({'license_excerpt':licence[:240],'license_metadata_sha256':hashlib.sha256(licence.encode()).hexdigest(),'classifiers':r['license_classifiers']}))
PY
python3 -m venv "$WORK/audit-venv"
"$WORK/audit-venv/bin/pip" install --quiet 'pip>=26.2' pip-audit
"$WORK/audit-venv/bin/pip-audit" --no-deps --disable-pip -r "$WORK/audit-requirements.txt"

# Process health is explicitly not external-provider readiness.
backend_container=$(docker run -d --network none "$BACKEND")
ready=false
for attempt in $(seq 1 60); do
  if docker exec "$backend_container" curl --fail --silent http://127.0.0.1:8000/health > "$WORK/health.json"; then ready=true; break; fi
  sleep 1
done
if [[ "$ready" != true ]]; then docker logs "$backend_container"; exit 1; fi
python3 - "$WORK/health.json" <<'PY'
import json, sys
h=json.load(open(sys.argv[1])); assert h['probe']=='liveness' and h['readiness']=='NOT_PROBED'
assert 'total_chunks' not in h
print('BACKEND_ANONYMOUS_LIVENESS_PASSED')
PY
frontend_container=$(docker run -d --network none "$FRONTEND")
ready=false
for attempt in $(seq 1 30); do
  if docker exec "$frontend_container" node -e 'fetch("http://127.0.0.1:3000/auth/login").then(async r=>{if(!r.ok||!(await r.text()).includes("Sign in"))process.exit(1)}).catch(()=>process.exit(1))'; then ready=true; break; fi
  sleep 1
done
if [[ "$ready" != true ]]; then docker logs "$frontend_container"; exit 1; fi
docker exec "$frontend_container" sh -c 'grep -r -q "supabase.invalid" /app/.next/static && grep -r -q "localhost:8000" /app/.next/static'
printf '\nCONTAINER_RUNTIME_VERIFIED source=%s (synthetic/offline only; no provider or commercial-rights approval)\n' "$SHA"
