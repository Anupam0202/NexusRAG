/**
 * NexusRAG's front door: a Cloudflare Pages project whose only job is to give the app a plain public address,
 * https://nexusrag.pages.dev (the preview's is https://nexusrag-preview.pages.dev). Pages is the only free Cloudflare
 * product with a one-word address; the app itself keeps running, and releasing, as its frontend Worker.
 *
 * The gateway's API (/api/...) and its probes (/health, /ready) go to the gateway Worker through the GATEWAY service
 * binding, so the app and its API share this one address and neither Worker needs an address of its own. Everything
 * else goes to the frontend Worker through the APP binding, so the browser keeps the public address. A page
 * request is first checked against the build the Worker serves: its /_nexus-build.json names the address it was made
 * for (`site_url`), and sign-in returns only to that address. When that is not this one (a misrouted binding), the
 * visitor is sent there instead. A build that names no address is served here: the Workers have no address of their
 * own (their workers.dev addresses are off).
 *
 * The app has this one address (PUBLIC_ORIGIN). Every Pages deployment also answers at its own
 * <id>.<project>.pages.dev address, and plain http:// reaches the project too, so a request on any other address is
 * sent here with its method, path and query (308) before anything is served.
 *
 * Deployed with scripts/front_door.py; docs/DEPLOYMENT_PRODUCTION.md has the runbook.
 */
const BUILD_IDENTITY = "/_nexus-build.json";

export default {
  async fetch(request, env) {
    const here = new URL(request.url);
    const publicOrigin = httpsOrigin(env.PUBLIC_ORIGIN);
    if (publicOrigin && here.origin !== publicOrigin) return redirect(here, publicOrigin, 308);
    if (isGatewayPath(here.pathname)) return env.GATEWAY ? env.GATEWAY.fetch(request) : unavailable();
    if (!env.APP) return unavailable();
    if (isPageRequest(request)) {
      const home = await buildAddress(request, env);
      if (home && home !== here.origin) return redirect(here, home, 302);
    }
    return env.APP.fetch(request);
  },
};

/** The same path and query at another origin. Never stored, so a change of address is never remembered wrongly. */
function redirect(url, origin, status) {
  return new Response(null, {
    status,
    headers: { Location: new URL(`${url.pathname}${url.search}`, origin).toString(), "Cache-Control": "no-store" },
  });
}

/** The gateway's own paths: its API under /api/ and its two probes. The app has no pages there. */
export function isGatewayPath(pathname) {
  return pathname.startsWith("/api/") || pathname === "/health" || pathname === "/ready";
}

/** A browser asking for a page, as opposed to a file or data, which are always served here. */
export function isPageRequest(request) {
  return (request.method === "GET" || request.method === "HEAD") && (request.headers.get("Accept") ?? "").includes("text/html");
}

/**
 * The origin the served build was made for: its `site_url`. Null (serve here) when the build names none, has no
 * identity file (every release publishes one, and a release whose identity is missing is rolled back by
 * scripts/release.py), or the file cannot be read, so a passing fault never turns into a redirect.
 */
export async function buildAddress(request, env) {
  let response;
  try {
    response = await env.APP.fetch(new Request(new URL(BUILD_IDENTITY, request.url), { headers: { Accept: "application/json" } }));
  } catch {
    return null;
  }
  if (!response.ok) return null;
  let identity;
  try {
    identity = await response.json();
  } catch {
    return null;
  }
  if (identity === null || typeof identity !== "object") return null;
  return httpsOrigin(identity.site_url);
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
