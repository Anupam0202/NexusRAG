# Optional local/self-managed runtime; Cloudflare uses OpenNext instead.
FROM node:24-alpine AS builder
WORKDIR /app
RUN apk upgrade --no-cache
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
# Only intentionally public client configuration is compiled into Next.js.
ARG NEXT_PUBLIC_API_URL=http://localhost:8000
ARG NEXT_PUBLIC_SITE_URL=http://localhost:3000
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_OAUTH_PROVIDERS=google,github
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
    NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY \
    NEXT_PUBLIC_OAUTH_PROVIDERS=$NEXT_PUBLIC_OAUTH_PROVIDERS
RUN npm run build

FROM node:24-alpine
ARG SOURCE_COMMIT=unverified
LABEL org.opencontainers.image.revision=$SOURCE_COMMIT
WORKDIR /app
# Standalone Next.js needs node, not bundled npm/Corepack/Yarn build tooling.
# alpine-baselayout depends on /bin/sh and otherwise silently retains BusyBox.
# Retain its independent data package (passwd/group/network configuration),
# remove the shell-dependent init layout, and recreate the temporary directory
# with Node after removal. The package manager goes too: apk-tools and libapk
# are the only users of the system OpenSSL (libssl3, libcrypto3), while Node
# links its own, so removing them keeps advisories for code that never runs out
# of the image. ca-certificates-bundle is an apk-tools dependency, so it is
# named explicitly to stay. Keep APK metadata for truthful runtime scans.
RUN apk upgrade --no-cache && \
    rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /opt/yarn-* && \
    rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg /usr/local/bin/docker-entrypoint.sh && \
    apk add --no-cache alpine-baselayout-data ca-certificates-bundle && \
    apk del alpine-baselayout busybox busybox-binsh ssl_client apk-tools && \
    /usr/local/bin/node -e 'const fs=require("fs");fs.mkdirSync("/tmp",{recursive:true});fs.chmodSync("/tmp",0o1777);if(!fs.readFileSync("/etc/passwd","utf8").includes("node:"))throw Error("Runtime identity missing");for(const p of ["/bin/sh","/bin/busybox"])if(fs.existsSync(p))throw Error("Shell removal failed")'
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public/
USER node
EXPOSE 3000
ENTRYPOINT ["node"]
CMD ["server.js"]
