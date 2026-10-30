import { isDocumentDetailPath, STATIC_DOCUMENT_ROUTE_ID } from "./document-route";

interface AssetEnvironment {
  ASSETS?: { fetch(request: Request): Promise<Response> };
}
interface Delegate {
  fetch(request: Request, env: AssetEnvironment, context: unknown): Promise<Response> | Response;
}

/** Keep OpenNext for other routes; tenant data is fetched only by the gated client. */
export function createDocumentStaticWorker(nextWorker: Delegate) {
  return {
    async fetch(request: Request, env: AssetEnvironment, context: unknown) {
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
    },
  };
}