// How the gateway presents its Supabase service key (NX-26). A legacy service_role key is a JWT and goes in both
// the apikey and Authorization headers. A secret key (sb_secret_...) is not a JWT: Supabase refuses it in
// Authorization, so it goes in apikey only and the platform gives the request the service role. Supabase stops
// accepting the legacy keys at the end of 2026, so SUPABASE_SERVICE_ROLE_KEY may hold either kind.
export const isSupabaseApiKey = key => typeof key === "string" && key.startsWith("sb_");

/** Headers that authenticate a request as the service role, followed by any extra headers. */
export function serviceHeaders(env, extra = {}) {
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  return { apikey: key, ...(isSupabaseApiKey(key) ? {} : { authorization: `Bearer ${key}` }), ...extra };
}
