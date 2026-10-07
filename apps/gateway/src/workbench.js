// Record-authorized durable findings. All identity and policy fields are derived
// from authenticated server state, never from the caller's JSON.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const problem = (code, message, status = 422) => Object.assign(new Error(message), { code, status });
function boundedText(value, name, maximum, minimum = 0) {
  if (typeof value !== "string" || value.length > maximum || value.trim().length < minimum || value.includes("\0"))
    throw problem("INVALID_SCOPE", `${name} is invalid.`);
  return value;
}
function uuid(value) {
  if (!UUID.test(value || "")) throw problem("INVALID_SCOPE", "The record identifier is invalid.");
  return value;
}
async function body(request) {
  if (Number(request.headers.get("content-length")) > 100_000)
    throw problem("PAYLOAD_TOO_LARGE", "The finding is too large.", 413);
  const text = await request.text();
  if (new TextEncoder().encode(text).length > 100_000) throw problem("PAYLOAD_TOO_LARGE", "The finding is too large.", 413);
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw Error();
    return value;
  } catch { throw problem("INVALID_REQUEST", "A JSON object is required.", 400); }
}
async function digest(value) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, "0")).join("");
}
async function context({ serviceRequest, env, workspace, user }) {
  const [workspaces, settings] = await Promise.all([
    serviceRequest(env, `workspaces?id=eq.${workspace}&select=capability_revision,lifecycle_state&limit=1`),
    serviceRequest(env, `workspace_settings?workspace_id=eq.${workspace}&select=active_policy_id,policy_version&limit=1`),
  ]);
  if (workspaces?.[0]?.lifecycle_state !== "active" || !settings?.[0]?.active_policy_id
      || !Number.isSafeInteger(workspaces[0].capability_revision) || !Number.isSafeInteger(settings[0].policy_version))
    throw problem("WORKSPACE_UNAVAILABLE", "Workspace policy is unavailable. Reload or contact an administrator.", 503);
  return { workspace_id: workspace, user_id: user.id,
    membership_revision: workspaces[0].capability_revision, policy_id: settings[0].active_policy_id,
    policy_version: settings[0].policy_version, deadline: new Date(Date.now() + 30_000).toISOString() };
}
async function rpc(args, name, values) {
  return args.serviceRequest(args.env, `rpc/${name}`, { method: "POST", body: JSON.stringify(values) });
}
async function listFindings(args, limit = 20, after = null) {
  const result = await rpc(args, "workbench_read", { p_context: await context(args), p_resource: "findings",
    p_limit: limit, p_after: after, p_id: null, p_latest: false, p_search: "" });
  return { ...result, limit, workspace_id: args.workspace, capability: "finding:read" };
}
async function projectFinding(args, finding) {
  if (typeof finding?.authored_markdown !== "string") return finding;
  const versions = await args.serviceRequest(args.env,
    `finding_versions?workspace_id=eq.${args.workspace}&finding_id=eq.${finding.id}&revision=eq.${finding.revision}&select=author_id&limit=1`);
  return { ...finding, author_id: versions?.[0]?.author_id || null };
}
async function handleWorkbench(args) {
  const { request, env, user, workspace, member, json } = args;
  const url = new URL(request.url);
  const matched = url.pathname.match(/^\/api\/v2\/findings\/([0-9a-f-]{36})(?:\/(review|share|unshare|export))?$/i);
  if (!matched && !["/api/v2/findings", "/api/v2/claims"].includes(url.pathname)) return null;
  if (!matched && ["GET", "HEAD"].includes(request.method)) {
    const limit = Number(url.searchParams.get("limit") || 20);
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw problem("INVALID_SCOPE", "Limit must be between 1 and 50.");
    const after = url.searchParams.get("after");
    return json(request, env, await listFindings(args, limit, after ? uuid(after) : null));
  }
  const findingId = matched ? uuid(matched[1]) : null;
  const action = matched?.[2];
  const p_context = await context(args);
  const read = () => rpc(args, "nexus_finding", { p_context, p_operation: "read", p_id: findingId,
    p_command: {}, p_revision: null, p_key: null, p_hash: null });
  if (matched && !action && ["GET", "HEAD"].includes(request.method)) return json(request, env, await projectFinding(args, await read()));
  if (action === "export" && request.method === "POST") {
    if (!["editor", "admin", "owner"].includes(member.role)) throw problem("FORBIDDEN", "Export capability is required.", 403);
    const finding = await read();
    if (finding.source_unavailable) throw problem("SOURCE_UNAVAILABLE", "Unavailable evidence cannot be exported.", 409);
    if (finding.source_run_id) throw problem("RIGHTS_BLOCKED", "Source-backed exports require verified export rights.", 403);
    // This is a user-authored finding export, not a provider-rights or standards certification.
    const manifest = { "@context": { "@vocab": "https://schema.org/", "nexus": "urn:nexusrag:ns:" },
      "@type": "CreativeWork", "@id": `urn:nexusrag:finding:${finding.id}:${finding.revision}`,
      format: "nexusrag-finding/1", workspace_id: workspace, finding_id: finding.id,
      revision: finding.revision, title: finding.title, authored_markdown: finding.authored_markdown,
      generated_markdown: finding.generated_markdown, evidence: finding.evidence, reviews: finding.reviews };
    const manifest_hash = await digest(JSON.stringify(manifest));
    const receipt = await rpc(args, "nexus_record_finding_export", {
      p_context, p_finding: findingId, p_revision: finding.revision, p_manifest_text: JSON.stringify(manifest), p_hash: manifest_hash,
    });
    return json(request, env, { receipt, manifest, manifest_hash }, 201);
  }
  if (!["editor", "admin", "owner"].includes(member.role))
    throw problem("FORBIDDEN", "Finding write capability is required.", 403);
  const data = request.method === "DELETE" ? {} : await body(request);
  let operation, command, revision = null, key = null, hash = null;
  if (!matched && request.method === "POST") {
    operation = "create";
    key = boundedText(request.headers.get("idempotency-key"), "Idempotency-Key", 128, 1);
    command = { title: boundedText(data.title, "Title", 160, 1).trim(),
      authored_markdown: boundedText(data.authored_markdown ?? "", "Finding text", 50_000),
      ...(data.run_id ? { run_id: uuid(data.run_id) } : {}) };
    hash = await digest(JSON.stringify(command));
  } else if (matched && !action && request.method === "PATCH") {
    operation = "edit";
    command = { title: boundedText(data.title, "Title", 160, 1).trim(),
      authored_markdown: boundedText(data.authored_markdown, "Finding text", 50_000) };
    revision = data.revision;
  } else if (action === "review" && request.method === "POST") {
    operation = "review";
    if (!["approved", "changes_requested"].includes(data.decision))
      throw problem("INVALID_SCOPE", "Choose an explicit review decision.");
    command = { decision: data.decision, comment: boundedText(data.comment ?? "", "Review comment", 4_000) };
    revision = data.revision;
  } else if (action === "share" && request.method === "POST") {
    if (!["read", "contribute"].includes(data.permission)) throw problem("INVALID_SCOPE", "Sharing permission is invalid.");
    operation = "share"; command = { user_id: uuid(data.user_id), permission: data.permission };
  } else if (action === "unshare" && request.method === "POST") {
    operation = "unshare"; command = { user_id: uuid(data.user_id) };
  } else if (matched && !action && request.method === "DELETE") {
    operation = "delete"; command = {};
  } else throw problem("METHOD_NOT_ALLOWED", "This operation does not accept that method.", 405);
  if (["edit", "review"].includes(operation) && (!Number.isSafeInteger(revision) || revision < 1))
    throw problem("INVALID_SCOPE", "The expected revision is required.");
  const result = await rpc(args, "nexus_finding", { p_context, p_operation: operation, p_id: findingId,
    p_command: command, p_revision: revision, p_key: key, p_hash: hash });
  return json(request, env, await projectFinding(args, result), operation === "create" ? 201 : 200);
}
export { handleWorkbench, listFindings };