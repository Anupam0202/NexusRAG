import test from "node:test";
import assert from "node:assert/strict";
import frontDoor, { buildAddress, isGatewayPath, isPageRequest } from "../../apps/front-door/worker.js";

const PUBLIC = "https://nexusrag.pages.dev";
const WORKER = "https://nexusrag-v6-frontend-preview.example.workers.dev";
const page = (path, init = {}) => new Request(`${PUBLIC}${path}`, { ...init, headers: { Accept: "text/html,*/*;q=0.8", ...(init.headers ?? {}) } });

/** The frontend Worker behind the APP binding: `identity` is what its /_nexus-build.json says (or a Response). */
function app(identity) {
  const calls = [];
  return {
    calls,
    async fetch(request) {
      calls.push(request);
      if (new URL(request.url).pathname === "/_nexus-build.json") {
        if (identity instanceof Response) return identity;
        if (identity instanceof Error) throw identity;
        return Response.json(identity);
      }
      return new Response(`app served ${new URL(request.url).pathname}`, { headers: { "Content-Type": "text/html" } });
    },
  };
}

test("a build made for this address is served here, with the request untouched", async () => {
  const APP = app({ source_commit: "a".repeat(40), site_url: PUBLIC });
  const request = page("/research?plan=1", { headers: { Cookie: "sb=session" } });
  const response = await frontDoor.fetch(request, { APP, FALLBACK_ORIGIN: WORKER });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "app served /research");
  assert.equal(APP.calls.at(-1), request, "the original request, with its URL, cookies and body, reaches the app");
});

test("a page of a build made for another address goes there, keeping path and query, and is never stored", async () => {
  const APP = app({ source_commit: "a".repeat(40), site_url: "https://nexusrag-preview.pages.dev/" });
  const response = await frontDoor.fetch(page("/documents?view=all"), { APP, FALLBACK_ORIGIN: WORKER });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("Location"), "https://nexusrag-preview.pages.dev/documents?view=all");
  assert.equal(response.headers.get("Cache-Control"), "no-store");
});

test("a build from before the front door names no address, so its pages go to the Worker's own address", async () => {
  const response = await frontDoor.fetch(page("/"), { APP: app({ source_commit: "a".repeat(40), format: "nexusrag-build/1" }), FALLBACK_ORIGIN: WORKER });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("Location"), `${WORKER}/`);
  const unconfigured = await frontDoor.fetch(page("/"), { APP: app({ source_commit: "a".repeat(40) }) });
  assert.equal(unconfigured.status, 200, "with no fallback either, the page is served here");
});

test("a build older than the identity file (production until its next release) also goes to the Worker's own address", async () => {
  const older = app(new Response("<title>404: This page could not be found.</title>", { status: 404, headers: { "Content-Type": "text/html" } }));
  const response = await frontDoor.fetch(page("/documents?view=all"), { APP: older, FALLBACK_ORIGIN: WORKER });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("Location"), `${WORKER}/documents?view=all`);
});

test("files, data and changes are always served here, without reading the build identity", async () => {
  const APP = app({ site_url: "https://elsewhere.invalid" });
  for (const request of [
    new Request(`${PUBLIC}/_next/static/chunks/app.js`),
    new Request(`${PUBLIC}/research`, { headers: { Accept: "*/*", RSC: "1" } }),
    page("/auth/callback", { method: "POST", body: "synthetic" }),
  ]) {
    assert.equal((await frontDoor.fetch(request, { APP, FALLBACK_ORIGIN: WORKER })).status, 200);
  }
  assert.ok(APP.calls.every((request) => new URL(request.url).pathname !== "/_nexus-build.json"));
});

test("an unreadable build identity is served here rather than redirected, so a passing fault never loops", async () => {
  for (const identity of [new Response("failed", { status: 500 }), new Response("not json"), new Error("binding failed"), null, "text"]) {
    const env = { APP: app(identity), FALLBACK_ORIGIN: WORKER };
    assert.equal((await frontDoor.fetch(page("/"), env)).status, 200, String(identity));
    assert.equal(await buildAddress(page("/"), { APP: app(identity), FALLBACK_ORIGIN: WORKER }), null);
  }
});

test("an address that is not a plain HTTPS origin is never followed", async () => {
  for (const site of ["http://nexusrag.pages.dev", "https://user:secret@elsewhere.invalid", "not a url", "", 42]) {
    assert.equal(await buildAddress(page("/"), { APP: app({ site_url: site }), FALLBACK_ORIGIN: WORKER }), WORKER, String(site));
    assert.equal(await buildAddress(page("/"), { APP: app({ site_url: site }) }), null, String(site));
    assert.equal(await buildAddress(page("/"), { APP: app({ site_url: site }), FALLBACK_ORIGIN: "javascript:alert(1)" }), null);
  }
});

test("an address with no app behind it says so instead of failing", async () => {
  const response = await frontDoor.fetch(page("/"), {});
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.match(await response.text(), /not connected/);
});

test("only browser page loads count as page requests", () => {
  assert.equal(isPageRequest(page("/")), true);
  assert.equal(isPageRequest(page("/", { method: "HEAD" })), true);
  assert.equal(isPageRequest(new Request(`${PUBLIC}/`)), false);
  assert.equal(isPageRequest(page("/", { method: "DELETE" })), false);
});

/** The gateway Worker behind the GATEWAY binding. */
function gateway() {
  const calls = [];
  return { calls, async fetch(request) { calls.push(request); return Response.json({ served: new URL(request.url).pathname }); } };
}

test("the gateway's API and probes are served on the public address, with the request untouched", async () => {
  const APP = app({ site_url: PUBLIC });
  const GATEWAY = gateway();
  for (const request of [
    new Request(`${PUBLIC}/api/v1/documents?limit=5`, { headers: { Authorization: "Bearer synthetic", Accept: "application/json" } }),
    new Request(`${PUBLIC}/api/v2/research/plans`, { method: "POST", body: "{}", headers: { "Content-Type": "application/json" } }),
    new Request(`${PUBLIC}/api/v1/chat`, { method: "POST", body: "{}", headers: { Accept: "text/event-stream" } }),
    new Request(`${PUBLIC}/health`),
    new Request(`${PUBLIC}/ready`, { headers: { Accept: "text/html" } }),
  ]) {
    const response = await frontDoor.fetch(request, { APP, GATEWAY, FALLBACK_ORIGIN: WORKER });
    assert.equal(response.status, 200, request.url);
    assert.equal(GATEWAY.calls.at(-1), request, "the original request, with its method, headers and body, reaches the gateway");
  }
  assert.equal(APP.calls.length, 0, "no API request reaches the frontend Worker, and no build identity is read for it");
});

test("pages that only look like gateway paths stay with the app", async () => {
  const APP = app({ site_url: PUBLIC });
  const GATEWAY = gateway();
  for (const path of ["/", "/api", "/apis/overview", "/evidence-api", "/healthz", "/ready/now", "/research"]) {
    assert.equal(isGatewayPath(path), false, path);
    const response = await frontDoor.fetch(page(path), { APP, GATEWAY, FALLBACK_ORIGIN: WORKER });
    assert.equal(response.status, 200, path);
  }
  assert.equal(GATEWAY.calls.length, 0);
});

test("without the gateway binding, its paths answer 503 and pages are still served", async () => {
  const APP = app({ site_url: PUBLIC });
  const unavailable = await frontDoor.fetch(new Request(`${PUBLIC}/api/v1/status`), { APP, FALLBACK_ORIGIN: WORKER });
  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.headers.get("Cache-Control"), "no-store");
  assert.equal(APP.calls.length, 0, "an API request is never handed to the frontend Worker");
  assert.equal((await frontDoor.fetch(page("/"), { APP, FALLBACK_ORIGIN: WORKER })).status, 200);
});

test("a deployment's own address sends every request to the public address, keeping method, path and query", async () => {
  const APP = app({ site_url: PUBLIC });
  const GATEWAY = gateway();
  const env = { APP, GATEWAY, FALLBACK_ORIGIN: WORKER, PUBLIC_ORIGIN: PUBLIC };
  for (const [request, location] of [
    [new Request("https://8150beca.nexusrag.pages.dev/research?plan=1", { headers: { Accept: "text/html" } }), `${PUBLIC}/research?plan=1`],
    [new Request("https://8150beca.nexusrag.pages.dev/api/v1/chat", { method: "POST", body: "{}" }), `${PUBLIC}/api/v1/chat`],
    [new Request("https://8150beca.nexusrag.pages.dev/health"), `${PUBLIC}/health`],
    [new Request("http://nexusrag.pages.dev/documents"), `${PUBLIC}/documents`],
  ]) {
    const response = await frontDoor.fetch(request, env);
    assert.equal(response.status, 308, request.url);
    assert.equal(response.headers.get("Location"), location);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
  }
  assert.equal(APP.calls.length + GATEWAY.calls.length, 0, "nothing is served at another address");
});

test("the public address itself, and a front door with no public address set, serve as before", async () => {
  const APP = app({ site_url: PUBLIC });
  const GATEWAY = gateway();
  assert.equal((await frontDoor.fetch(new Request(`${PUBLIC}/health`), { APP, GATEWAY, PUBLIC_ORIGIN: PUBLIC })).status, 200);
  assert.equal((await frontDoor.fetch(page("/"), { APP, GATEWAY, PUBLIC_ORIGIN: `${PUBLIC}/` })).status, 200, "a trailing slash names the same origin");
  const local = new Request("http://localhost:8788/health");
  assert.equal((await frontDoor.fetch(local, { APP, GATEWAY })).status, 200, "without PUBLIC_ORIGIN (a local run) nothing is redirected");
  for (const invalid of ["http://nexusrag.pages.dev", "https://user:secret@nexusrag.pages.dev", "not a url", ""]) {
    assert.equal((await frontDoor.fetch(local, { APP, GATEWAY, PUBLIC_ORIGIN: invalid })).status, 200, String(invalid));
  }
});
