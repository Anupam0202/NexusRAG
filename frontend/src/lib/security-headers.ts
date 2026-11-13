/**
 * Headers every page and file of the app is sent with (NX-28). The policy forbids framing (clickjacking),
 * plugins, a foreign <base> and form posts to other sites. It does not restrict scripts or connections yet:
 * Next.js inlines scripts in prerendered pages, and a script policy needs per-request nonces first.
 * public/_headers repeats these for files served without the Worker; a test keeps the two equal.
 */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  "Content-Security-Policy": "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'",
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "Cross-Origin-Opener-Policy": "same-origin",
});

/** The same response with the security headers it does not already set. */
export function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    if (!headers.has(name)) headers.set(name, value);
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
