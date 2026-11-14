// The script policy of a page (NX-28): scripts from the app's own origin, plus the exact inline scripts the page
// contains, allowed by their SHA-256 hashes. Pages are prerendered or rendered without request data, so a nonce
// would be the same for everyone; hashes allow only the scripts that were actually served. The Worker computes them
// for each page it sends (security-headers.ts).

// A script element: its attributes (quoted values may contain ">") and its text, which ends at the first </script.
const SCRIPT_ELEMENT = /<script(?=[\s>/])((?:[^>"']|"[^"]*"|'[^']*')*)>([\s\S]*?)<\/script[\s/>]/gi;
const SRC_ATTRIBUTE = /(?:^|\s)src\s*=/i;

/** The text of every script element of a page that has no src attribute. */
export function inlineScripts(html) {
  const scripts = [];
  for (const [, attributes, body] of html.matchAll(SCRIPT_ELEMENT)) {
    if (!SRC_ATTRIBUTE.test(attributes)) scripts.push(body);
  }
  return scripts;
}

/** The base64 SHA-256 digest of a script's text, as a Content-Security-Policy hash source uses it. */
export async function scriptHash(text) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** The script-src directive for a page: its own origin and each of its inline scripts. */
export async function scriptSource(html) {
  const hashes = [...new Set(await Promise.all(inlineScripts(html).map(scriptHash)))];
  return ["script-src 'self'", ...hashes.map((hash) => `'sha256-${hash}'`)].join(" ");
}
