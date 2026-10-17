import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const workspace = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const actor = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const requests = [];
let member = true;
let role = "viewer";
const originalDocument="d0360000-0000-4000-8100-000000000002",originalVersion="e0360000-0000-4000-8100-000000000002";
const originalBytes=Buffer.from("\uFEFFActual local Worker original.\r\n"),originalHash=createHash("sha256").update(originalBytes).digest("hex");
const originalKey=`${workspace}/${originalDocument}/${originalVersion}/Synthetic.txt`;
const authority = createServer(async(request, response) => {
  const url = new URL(request.url, "http://localhost");
  requests.push({ method: request.method, path: url.pathname });
  response.setHeader("content-type", "application/json");
  if(request.method==="POST"&&url.pathname==="/rest/v1/rpc/v6_reserve_many") {
    let text="";for await(const part of request)text+=part;const data=JSON.parse(text);
    assert.equal(data.p_provider,"supabase_storage");
    response.end(JSON.stringify({state:"READY",reservations:Object.values(data.p_dimensions).map(amount=>({id:randomUUID(),amount}))}));return;
  }
  if(request.method==="POST"&&url.pathname==="/rest/v1/rpc/v6_settle_many") {response.end('{"state":"SETTLED"}');return;}
  if(["GET","HEAD"].includes(request.method)&&decodeURIComponent(url.pathname)===`/storage/v1/object/${request.method==="HEAD"?"":"authenticated/"}documents/${originalKey}`) {
    response.setHeader("content-type","application/octet-stream");response.setHeader("content-length",originalBytes.length);
    response.end(request.method==="HEAD"?undefined:originalBytes);return;
  }
  if (request.method !== "GET") { response.writeHead(405); response.end("{}"); return; }
  if (url.pathname === "/auth/v1/user") { response.end(JSON.stringify({ id: actor })); return; }
  if (url.pathname === "/rest/v1/workspace_members" && url.searchParams.get("workspace_id") === `eq.${workspace}` &&
      url.searchParams.get("user_id") === `eq.${actor}`) {
    response.end(JSON.stringify(member ? [{ role, workspace_id: workspace, user_id: actor }] : [])); return;
  }
  if(url.pathname==="/rest/v1/documents"&&url.searchParams.get("id")===`eq.${originalDocument}`) {
    response.end(JSON.stringify([{id:originalDocument,workspace_id:workspace,filename:"Synthetic.txt",status:"ready",lifecycle_state:"active",lifecycle_epoch:1,active_version_id:originalVersion}]));return;
  }
  if(url.pathname==="/rest/v1/document_versions") {
    response.end(JSON.stringify([{id:originalVersion,document_id:originalDocument,workspace_id:workspace,publication_state:"ready",lifecycle_epoch:1,
      original_bucket:"documents",original_key:originalKey,original_bytes:originalBytes.length,original_hash:originalHash,original_verified_at:"2026-10-01T00:00:00Z"}]));return;
  }
  if (["/rest/v1/workspace_settings", "/rest/v1/documents"].includes(url.pathname)) { response.end("[]"); return; }
  response.writeHead(404); response.end("{}");
});
await new Promise(resolve => authority.listen(0, "127.0.0.1", resolve));
const reserve = createServer();
await new Promise(resolve => reserve.listen(0, "127.0.0.1", resolve));
const port = reserve.address().port;
await new Promise(resolve => reserve.close(resolve));
const directory = await mkdtemp(join(tmpdir(), "nexusrag-offline-fixture-"));
const config = join(directory, "wrangler.json");
await writeFile(config, JSON.stringify({ name: "nexusrag-offline-fixture", main: join(root, "apps/gateway/src/preview-worker.js"),
  compatibility_date: "2026-09-20", vars: { SUPABASE_URL: `http://127.0.0.1:${authority.address().port}`,
    SUPABASE_PUBLISHABLE_KEY: "synthetic-public", SUPABASE_SERVICE_ROLE_KEY: "synthetic-service",
    FRONTEND_ORIGIN: "https://frontend.invalid" } }));
// Isolate the local runtime from owner credentials, .dev.vars, queues and crons.
const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  ["path", "systemroot", "windir", "temp", "tmp", "comspec"].includes(key.toLowerCase())));
Object.assign(environment, { HOME: directory, USERPROFILE: directory, WRANGLER_SEND_METRICS: "false", CI: "true" });
const child = spawn(process.execPath, [join(root, "frontend/node_modules/wrangler/bin/wrangler.js"), "dev", "--config", config,
  "--local", "--ip", "127.0.0.1", "--port", String(port), "--inspector-port", "0", "--log-level", "error"],
{ cwd: directory, env: environment, stdio: ["ignore", "pipe", "pipe"] });
let output = "";
child.stdout.on("data", data => { output += data; });
child.stderr.on("data", data => { output += data; });
const endpoint = `http://127.0.0.1:${port}/api/v1/evaluations/sample`;
const call = (body, authenticated = true) => fetch(endpoint, { method: "POST", signal: AbortSignal.timeout(10000),
  headers: { "content-type": "application/json", "X-Nexus-Workspace-Id": workspace,
    ...(authenticated ? { authorization: "Bearer synthetic.user.token" } : {}) }, body: JSON.stringify(body) });
try {
  let ready = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    if (child.exitCode !== null) throw new Error(`Local runtime exited ${child.exitCode}: ${output}`);
    try { if ((await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break; } }
    catch { /* The owned local runtime is still starting. */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.ok(ready, `Local runtime did not become ready: ${output}`);
  for (const mode of ["retrieval", "extractive"]) {
    const response = await call({ mode, top_k: 20 });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control"), /no-store/);
    const report = await response.json();
    assert.equal(report.mode, mode);
    assert.equal(report.results.length, 3);
    assert.equal(report.summary.fixture_only, true);
    assert.equal(report.summary.production_quality_claimed, false);
    assert.equal(report.summary.provider_processing, false);
    assert.equal(report.summary.cross_workspace_leaks, 0);
    assert.equal(report.gates.passed, false);
    assert.equal(report.gates.checks.citation_precision.passed, false);
    assert.ok(report.results.every(item => item.sources.every(source => source.workspace_id === item.workspace_id)));
  }
  assert.equal((await call({ top_k: 21 })).status, 422);
  assert.equal((await call({}, false)).status, 401);
  member = false;
  assert.equal((await call({})).status, 403);
  member = true; role = "owner";
  const chat = (sessionId, idempotencyKey) => fetch(`http://127.0.0.1:${port}/api/v1/chat`, {
    method: "POST", signal: AbortSignal.timeout(10000), headers: { "content-type": "application/json",
      "X-Nexus-Workspace-Id": workspace, authorization: "Bearer synthetic.user.token", "Idempotency-Key": idempotencyKey },
    body: JSON.stringify({ question: "Synthetic fixture question", non_sensitive_attested: true, session_id: sessionId }),
  });
  assert.equal((await chat("not-a-uuid", "dddddddd-dddd-4ddd-8ddd-dddddddddddd")).status, 422);
  assert.equal((await chat("cccccccc-cccc-4ccc-8ccc-cccccccccccc", `dddddddd-${"-".repeat(27)}`)).status, 400);
  assert.ok(requests.every(request => request.method === "GET" &&
    ["/auth/v1/user", "/rest/v1/workspace_members", "/rest/v1/workspace_settings", "/rest/v1/documents"].includes(request.path)));
  console.log(JSON.stringify({ marker: "ACTUAL_WORKER_FIXTURE_EVALUATION_PASS", cases: 3, modes: 2,
    transport_authority_checks: 5, request_identity_checks: 2, upstream_calls: requests.length, customer_records: false,
    provider_processing: false, production_acceptance: false }));
  for(const method of ["GET","HEAD"]) {
    const response=await fetch(`http://127.0.0.1:${port}/api/v1/documents/${originalDocument}/original?version_id=${originalVersion}`,{
      method,signal:AbortSignal.timeout(10000),headers:{"X-Nexus-Workspace-Id":workspace,authorization:"Bearer synthetic.user.token"}});
    assert.equal(response.status,200,response.ok?undefined:await response.clone().text());
    assert.equal(response.headers.get("content-length"),String(originalBytes.length));
    assert.equal(response.headers.get("x-nexus-original-sha256"),originalHash);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()),method==="HEAD"?Buffer.alloc(0):originalBytes);
  }
  console.log(JSON.stringify({marker:"ACTUAL_WORKER_ORIGINAL_DELIVERY_PASS",get_and_head:true,bytes:originalBytes.length,
    exact_hash:originalHash,content_length:true,provider_processing:false,hosted_acceptance:false}));
} finally {
  if (child.exitCode === null) {
    if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    else child.kill("SIGTERM");
    if (child.exitCode === null) await once(child, "exit");
  }
  await new Promise(resolve => authority.close(resolve));
}
