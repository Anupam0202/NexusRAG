import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Where pages may connect (NX-28): their own origin, the gateway and Supabase, exactly as the client bundle was built
// to reach them (src/lib/backend-url.ts falls back to the local gateway when no URL is set; src/lib/supabase/config.ts).
// The Worker adds these to every page's policy (worker.js).
export const LOCAL_GATEWAY = "http://localhost:8000";

/** The origins, besides its own, that a page built with these settings connects to. An invalid URL fails the build. */
export function connectSources(env) {
  const gateway = env.NEXT_PUBLIC_API_URL?.trim() || LOCAL_GATEWAY;
  const supabase = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  return [...new Set([gateway, ...(supabase ? [supabase] : [])].map((url) => new URL(url).origin))];
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * The address the app is built for (NEXT_PUBLIC_SITE_URL): sign-in returns there, and the build identity names it
 * (`site_url` in /_nexus-build.json, scripts/write-build-info.mjs) so the front door can tell which build it serves.
 * None for a build without one; a URL that is not HTTPS (outside local development) fails the build, as
 * src/lib/auth-redirect.ts would at sign-in.
 */
export function siteOrigin(env) {
  const value = env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!value) return null;
  const url = new URL(value);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && LOOPBACK.has(url.hostname))) {
    throw new Error("NEXT_PUBLIC_SITE_URL must use HTTPS outside local development.");
  }
  return url.origin;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const connect = connectSources(process.env);
  writeFileSync(path.join(root, ".open-next", "page-policy.json"),
    `${JSON.stringify({ format: "nexusrag-page-policy/1", connect })}\n`);
  console.log(`Pages may connect to their own origin and ${connect.join(", ")}.`);
}
