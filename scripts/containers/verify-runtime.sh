#!/usr/bin/env bash
# Local images only: no provider credentials, registry pushes or cloud resources.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
cd "$ROOT"
SHA=$(git rev-parse HEAD)
WORK=$(mktemp -d)
FRONTEND="nexusrag-frontend-check:${SHA:0:12}"
if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  printf 'frontend_image=%s\n' "$FRONTEND" >> "$GITHUB_OUTPUT"
fi
frontend_container=''
cleanup() {
  if [[ -n "$frontend_container" ]]; then docker rm -f "$frontend_container" >/dev/null 2>&1 || true; fi
  rm -rf "$WORK"
}
trap cleanup EXIT

docker build --build-arg SOURCE_COMMIT="$SHA" \
  --build-arg NEXT_PUBLIC_API_URL=http://localhost:8000 \
  --build-arg NEXT_PUBLIC_SITE_URL=http://localhost:3000 \
  --build-arg NEXT_PUBLIC_SUPABASE_URL=https://supabase.invalid \
  --build-arg NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=synthetic-public-browser-test-key \
  -t "$FRONTEND" frontend

for image in "$FRONTEND"; do
  user=$(docker inspect --format '{{.Config.User}}' "$image")
  [[ -n "$user" && "$user" != root && "$user" != 0 ]]
  [[ "$(docker inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$image")" = "$SHA" ]]
  docker run --rm --network none --entrypoint node "$image" -e 'const fs=require("fs");function walk(dir){for(const item of fs.readdirSync(dir,{withFileTypes:true})){if(item.name!==".env.example"&&(item.name===".env"||item.name.startsWith(".env.")))throw Error("Private env file");if(item.isDirectory())walk(dir+"/"+item.name)}}walk("/app")'
  docker inspect --format 'image={{.Id}} source={{index .Config.Labels "org.opencontainers.image.revision"}} user={{.Config.User}} bytes={{.Size}}' "$image"
done

docker run --rm --network none --entrypoint node "$FRONTEND" -e 'const fs=require("fs");for(const path of ["/usr/local/lib/node_modules/npm","/usr/local/lib/node_modules/corepack","/usr/local/bin/yarn","/bin/busybox","/bin/sh","/sbin/apk","/usr/bin/ssl_client"]){if(fs.existsSync(path))throw Error("Unused runtime tooling remains: "+path)}'
docker run --rm --network none --entrypoint node "$FRONTEND" -e 'const fs=require("fs");if(process.getuid()!==1000)throw Error("Unexpected runtime identity");if((fs.statSync("/tmp").mode&0o7777)!==0o1777)throw Error("Invalid temporary directory");fs.writeFileSync("/tmp/runtime-fixture","synthetic");fs.unlinkSync("/tmp/runtime-fixture");const inventory=fs.readFileSync("/lib/apk/db/installed","utf8");if(!inventory.includes("P:alpine-baselayout-data\n")||!inventory.includes("P:musl\n"))throw Error("Runtime package inventory lost");if(/\nP:(busybox|busybox-binsh|alpine-baselayout)\n/.test("\n"+inventory))throw Error("Shell dependency retained");if(/\nP:(apk-tools|libapk|ssl_client|libssl3|libcrypto3)\n/.test("\n"+inventory))throw Error("Package manager or system TLS library retained");if(!process.versions.openssl||!require("tls").getCiphers().length)throw Error("Node TLS unavailable");if(!fs.existsSync("/etc/ssl/certs/ca-certificates.crt"))throw Error("CA bundle missing");console.log("REAL_FRONTEND_IDENTITY_FILESYSTEM_AND_PACKAGE_INVENTORY_PASSED")'

frontend_container=$(docker run -d --network none "$FRONTEND")
ready=false
for attempt in $(seq 1 30); do
  if docker exec "$frontend_container" node -e 'fetch("http://127.0.0.1:3000/auth/login").then(async r=>{if(!r.ok||!(await r.text()).includes("Sign in"))process.exit(1)}).catch(()=>process.exit(1))'; then ready=true; break; fi
  sleep 1
done
if [[ "$ready" != true ]]; then docker logs "$frontend_container"; exit 1; fi
docker exec "$frontend_container" node -e 'const fs=require("fs");let found=new Set();function walk(dir){for(const item of fs.readdirSync(dir,{withFileTypes:true})){const path=dir+"/"+item.name;if(item.isDirectory())walk(path);else if(item.isFile()){const text=fs.readFileSync(path,"utf8");for(const marker of ["supabase.invalid","localhost:8000"])if(text.includes(marker))found.add(marker)}}}walk("/app/.next/static");if(found.size!==2)throw Error("Compiled public configuration missing")'
printf '\nCONTAINER_RUNTIME_VERIFIED source=%s (synthetic/offline only; no provider or commercial-rights approval)\n' "$SHA"
