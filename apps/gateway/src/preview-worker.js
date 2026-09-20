const BASE_HEADERS = Object.freeze({
  "cache-control": "no-store",
  "content-security-policy": "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "content-type": "application/json; charset=utf-8",
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "referrer-policy": "no-referrer",
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "x-permitted-cross-domain-policies": "none",
});

function responseHeaders(request) {
  return {
    ...BASE_HEADERS,
    "x-request-id": request.headers.get("cf-ray") || crypto.randomUUID(),
  };
}

function jsonResponse(request, body, status = 200) {
  return new Response(request.method === "HEAD" ? null : JSON.stringify(body), {
    status,
    headers: responseHeaders(request),
  });
}

export async function handle(request, env = {}) {
  const url = new URL(request.url);
  if (request.method !== "GET" && request.method !== "HEAD") {
    return jsonResponse(
      request,
      {
        code: "MIGRATION_REQUIRED",
        message: "The preview gateway is read-only until authoritative services pass validation.",
      },
      405,
    );
  }

  if (url.pathname === "/" || url.pathname === "/health") {
    return jsonResponse(request, {
      service: "nexusrag-v6-preview-gateway",
      profile: "ZERO_COST_LOW_TRAFFIC",
      status: "DEGRADED",
      production_verified: false,
      authorities: { business_records: "supabase", vectors: "qdrant" },
      providers: {
        qdrant: env.QDRANT_URL && env.QDRANT_API_KEY ? "CONFIGURED" : "BLOCKED",
        gemini: env.GOOGLE_API_KEY ? "CONFIGURED" : "BLOCKED",
      },
      paid_fallback: false,
    });
  }

  if (url.pathname === "/api/v2/capabilities") {
    return jsonResponse(
      request,
      {
        status: "MIGRATION_REQUIRED",
        authenticated: false,
        workspace_bound: false,
        available: ["health"],
        blocked: ["private-evidence", "provider-egress", "database-mutation", "vector-mutation"],
      },
      503,
    );
  }

  return jsonResponse(request, { code: "NOT_FOUND", message: "Preview route unavailable." }, 404);
}

export default { fetch: handle };
