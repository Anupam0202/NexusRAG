/**
 * NexusRAG's front door: a Cloudflare Pages project whose only job is to give the app a plain public address,
 * https://nexusrag.pages.dev (the preview's is https://nexusrag-preview.pages.dev). Pages is the only free Cloudflare
 * product with a one-word address; the app itself keeps running, and releasing, as its frontend Worker.
 *
 * Every request goes to that Worker through the APP service binding, so the browser keeps the public address. A page
 * request is first checked against the build the Worker serves: its /_nexus-build.json names the address it was made
 * for (`site_url`), and sign-in returns only to that address. When that is not this one (a build from before the
 * front door, or a misrouted binding), the visitor is sent there instead (FALLBACK_ORIGIN for builds that name no
 * address), so this address switches over by itself when a build made for it is released.
 *
 * Deployed with scripts/front_door.py; docs/DEPLOYMENT_PRODUCTION.md has the runbook.
 */
const BUILD_IDENTITY = "/_nexus-build.json";

export default {
  async fetch(request, env) {
    if (!env.APP) return unavailable();
    if (isPageRequest(request)) {
      const here = new URL(request.url);
      const home = await buildAddress(request, env);
      if (home && home !== here.origin) {
        return new Response(null, {
          status: 302,
          headers: { Location: new URL(`${here.pathname}${here.search}`, home).toString(), "Cache-Control": "no-store" },
        });
      }
    }
    return env.APP.fetch(request);
  },
};

/** A browser asking for a page, as opposed to a file or data, which are always served here. */
export function isPageRequest(request) {
  return (request.method === "GET" || request.method === "HEAD") && (request.headers.get("Accept") ?? "").includes("text/html");
}

/**
 * The origin the served build was made for: its `site_url`, else FALLBACK_ORIGIN. A build without the identity file
 * (404) predates it and was made for the Worker's own address; every release since publishes it, and a release whose
 * identity is missing is rolled back (scripts/release.py). Null (serve here) when the file cannot be read for any
 * other reason, so a passing fault never turns into a redirect, and never into a loop with the Worker's own redirect.
 */
export async function buildAddress(request, env) {
  let response;
  try {
    response = await env.APP.fetch(new Request(new URL(BUILD_IDENTITY, request.url), { headers: { Accept: "application/json" } }));
  } catch {
    return null;
  }
  if (response.status === 404) return httpsOrigin(env.FALLBACK_ORIGIN);
  if (!response.ok) return null;
  let identity;
  try {
    identity = await response.json();
  } catch {
    return null;
  }
  if (identity === null || typeof identity !== "object") return null;
  return httpsOrigin(identity.site_url) ?? httpsOrigin(env.FALLBACK_ORIGIN);
}

function httpsOrigin(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" && !url.username && !url.password ? url.origin : null;
  } catch {
    return null;
  }
}

function unavailable() {
  return new Response("NexusRAG is not connected to this address yet.", {
    status: 503,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "Retry-After": "60" },
  });
}
