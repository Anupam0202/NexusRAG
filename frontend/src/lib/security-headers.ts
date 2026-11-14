import { scriptSource } from "./script-policy";

/**
 * Headers every page and file of the app is sent with (NX-28). The policy forbids framing (clickjacking), plugins,
 * a foreign <base>, form posts to other sites, and scripts from anywhere but the app's own origin. Pages also get
 * their inline scripts' hashes and the origins they may connect to (withSecurityHeaders). public/_headers repeats
 * these for files served without the Worker; a test keeps the two equal.
 */
export const BASE_POLICY = "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'";

export const SECURITY_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  "Content-Security-Policy": `${BASE_POLICY}; script-src 'self'`,
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "Cross-Origin-Opener-Policy": "same-origin",
});

const isPage = (headers: Headers) => (headers.get("Content-Type") ?? "").toLowerCase().startsWith("text/html");

/**
 * The same response with the security headers it does not already set. Every page is served by the Worker and gets
 * its own policy here: Next.js inlines a few scripts in each page, and the page's policy allows exactly those, by
 * hash; it may connect only to its own origin and `connect` (the gateway and Supabase). A response without a body
 * (HEAD, 304) is sent without a policy: browsers copy the headers of a 304 onto the page they stored, and a policy
 * without that page's hashes would block its scripts.
 */
export async function withSecurityHeaders(response: Response, connect: readonly string[] = []): Promise<Response> {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    if (!headers.has(name)) headers.set(name, value);
  }
  const init = { status: response.status, statusText: response.statusText, headers };
  if (response.body === null) {
    headers.delete("Content-Security-Policy");
    return new Response(null, init);
  }
  if (!isPage(headers)) return new Response(response.body, init);
  const page = await response.arrayBuffer();
  const scripts = await scriptSource(new TextDecoder().decode(page));
  headers.set("Content-Security-Policy", `${BASE_POLICY}; ${scripts}; connect-src ${["'self'", ...connect].join(" ")}`);
  return new Response(page, init);
}
