import { isDocumentDetailPath, STATIC_DOCUMENT_ROUTE_ID } from "./document-route";
import { withSecurityHeaders } from "./security-headers";

interface AssetEnvironment {
  ASSETS?: { fetch(request: Request): Promise<Response> };
}
interface Delegate {
  fetch(request: Request, env: AssetEnvironment, context: unknown): Promise<Response> | Response;
}

/**
 * Keep OpenNext for other routes; tenant data is fetched only by the gated client. `connect` lists the origins pages
 * may connect to besides their own, and `site` is the address the build was made for (scripts/write-page-policy.mjs).
 */
export function createDocumentStaticWorker(nextWorker: Delegate, connect: readonly string[] = [], site: string | null = null) {
  return {
    async fetch(request: Request, env: AssetEnvironment, context: unknown) {
      const moved = toPublicAddress(request, site);
      return withSecurityHeaders(moved ?? await route(nextWorker, request, env, context), connect);
    },
  };
}

/**
 * A page asked for on the Worker's own workers.dev address is sent to the address the build was made for: sign-in
 * returns only there, and the gateway expects requests from it. Files, data and every other method are served where
 * they are asked for, so release checks and open pages keep working. The redirect is temporary (302), so browsers do
 * not keep it if the public address ever changes.
 */
export function toPublicAddress(request: Request, site: string | null): Response | null {
  if (!site || !["GET", "HEAD"].includes(request.method)) return null;
  if (!(request.headers.get("Accept") ?? "").includes("text/html")) return null;
  const url = new URL(request.url);
  const target = new URL(site);
  if (url.host === target.host || !url.hostname.endsWith(".workers.dev")) return null;
  return new Response(null, {
    status: 302,
    headers: { Location: new URL(`${url.pathname}${url.search}`, target.origin).toString(), "Cache-Control": "no-store" },
  });
}

async function route(nextWorker: Delegate, request: Request, env: AssetEnvironment, context: unknown): Promise<Response> {
  const url = new URL(request.url);
  const shell = `/documents/${STATIC_DOCUMENT_ROUTE_ID}`;
  if (isDocumentDetailPath(url.pathname) || url.pathname === shell || url.pathname === `${shell}/` || url.pathname === `${shell}.html`) {
    if (!["GET", "HEAD"].includes(request.method)) {
      return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
    }
    if (!env.ASSETS) {
      return new Response("Document interface unavailable", { status: 503, headers: { "Cache-Control": "no-store" } });
    }
    url.pathname = `${shell}.html`;
    url.search = ""; // No client query, credential or workspace header enters asset lookup.
    const headers = new Headers({ Accept: "text/html" });
    for (const name of ["If-None-Match", "If-Modified-Since"]) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }
    return env.ASSETS.fetch(new Request(url, { method: request.method, headers }));
  }
  // Unknown document identifiers must not trigger expensive or misleading
  // dynamic rendering of a route whose dynamicParams is explicitly false.
  if (url.pathname.startsWith("/documents/")) {
    return new Response("Document route not found", { status: 404 });
  }
  return nextWorker.fetch(request, env, context);
}
