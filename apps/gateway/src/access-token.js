// Access tokens checked in the Worker (NX-25).
//
// Supabase signs its access tokens with the project's key (ES256), whose public half it publishes at
// /auth/v1/.well-known/jwks.json. Checking the signature, issuer, audience, role and expiry here gives the same
// answer as asking Supabase Auth, without a round trip on every request (one of the 50 outbound requests a free-plan
// invocation may make). The only part of the user the gateway uses is its id (`sub`).
//
// A token signed any other way (a project still on its legacy shared secret) or a key list that cannot be read is
// handed to Supabase Auth, as before (`null`). A token that fails a check is refused, never handed on.
// As with any token checked locally, signing out does not end a token before its expiry (an hour at most); every
// request still checks membership in the database, so removing a member or deleting an account takes effect at once.

const KEY_LIST_LIFETIME_MS = 10 * 60 * 1000;
const UNKNOWN_KEY_RETRY_MS = 60 * 1000;
const CLOCK_SKEW_S = 30;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const projects = new Map(); // SUPABASE_URL -> { keys: Map(kid -> CryptoKey promise), readAt, lastMissAt }

export class InvalidAccessToken extends Error {}

/** For tests: forget every project's keys. */
export function resetAccessTokenKeys() {
  projects.clear();
}

function base64url(text) {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(text.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function decode(part) {
  try {
    return JSON.parse(new TextDecoder().decode(base64url(part)));
  } catch {
    throw new InvalidAccessToken("The access token cannot be read.");
  }
}

async function readKeys(env, fetchImpl, now) {
  const response = await fetchImpl(`${env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`, { signal: AbortSignal.timeout(5_000) });
  if (!response.ok) throw new Error(`key list answered HTTP ${response.status}`);
  const body = await response.json();
  const keys = new Map();
  for (const jwk of Array.isArray(body?.keys) ? body.keys : []) {
    if (jwk?.kty !== "EC" || jwk.crv !== "P-256" || (jwk.alg && jwk.alg !== "ES256") || typeof jwk.kid !== "string") continue;
    keys.set(jwk.kid, crypto.subtle.importKey("jwk", { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y },
      { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]));
  }
  const project = { keys, readAt: now, lastMissAt: projects.get(env.SUPABASE_URL)?.lastMissAt ?? 0 };
  projects.set(env.SUPABASE_URL, project);
  return project;
}

async function keyFor(kid, env, fetchImpl, now) {
  let project = projects.get(env.SUPABASE_URL);
  if (!project || now - project.readAt > KEY_LIST_LIFETIME_MS) project = await readKeys(env, fetchImpl, now);
  if (!project.keys.has(kid) && now - project.lastMissAt > UNKNOWN_KEY_RETRY_MS) {
    // A key Supabase has just rotated in: read the list again, at most once a minute.
    project.lastMissAt = now;
    project = await readKeys(env, fetchImpl, now);
    project.lastMissAt = now;
  }
  return project.keys.get(kid) ?? null;
}

/**
 * The user `{ id }` of a valid token; `null` when the token cannot be checked here (not ES256, or the key list cannot
 * be read), so the caller asks Supabase Auth; throws InvalidAccessToken when a check fails.
 */
export async function verifyAccessToken(token, env, { fetchImpl = fetch, now = Date.now() } = {}) {
  const parts = typeof token === "string" ? token.split(".") : [];
  if (parts.length !== 3 || parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) return null;
  let header;
  try {
    header = decode(parts[0]);
  } catch {
    return null; // Not a token this project issues: Supabase Auth decides.
  }
  if (header?.alg !== "ES256" || typeof header.kid !== "string") return null;
  let key;
  try {
    key = await keyFor(header.kid, env, fetchImpl, now);
  } catch {
    return null;
  }
  if (!key) throw new InvalidAccessToken("The access token was not signed by this project.");
  let publicKey;
  try {
    publicKey = await key;
  } catch {
    return null; // A published key this runtime cannot import: let Supabase Auth decide.
  }
  const valid = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, publicKey, base64url(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if (!valid) throw new InvalidAccessToken("The access token signature is invalid.");
  const claims = decode(parts[1]);
  const seconds = now / 1000;
  const audience = Array.isArray(claims?.aud) ? claims.aud : [claims?.aud];
  if (claims?.iss !== `${env.SUPABASE_URL}/auth/v1` || !audience.includes("authenticated") || claims.role !== "authenticated"
      || !Number.isFinite(claims.exp) || claims.exp <= seconds
      || (claims.nbf !== undefined && !(Number.isFinite(claims.nbf) && claims.nbf <= seconds + CLOCK_SKEW_S))
      || (claims.iat !== undefined && !(Number.isFinite(claims.iat) && claims.iat <= seconds + CLOCK_SKEW_S))
      || typeof claims.sub !== "string" || !UUID.test(claims.sub)) {
    throw new InvalidAccessToken("The access token is invalid or expired.");
  }
  return { id: claims.sub.toLowerCase() };
}
