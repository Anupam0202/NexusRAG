"""Deploy a NexusRAG Worker, smoke-test it, and roll back if the smoke test fails.

The candidate preview and production use the same code path, from GitHub Actions or a terminal:

  python3 scripts/release.py plan     --target candidate
  python3 scripts/release.py env      --target candidate                     # public build settings
  python3 scripts/release.py gateway  --target candidate --sha <commit> [--secrets-file FILE] [--allow-index-down]
  python3 scripts/release.py frontend --target candidate --sha <commit>     # after `npm run cf:build`
  python3 scripts/release.py rollback --target candidate --component gateway --version <version-id>

Environment: CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID; for the gateway also SUPABASE_URL and
SUPABASE_PUBLISHABLE_KEY. WRANGLER overrides the wrangler command (default: the pinned npx version).
A target can only ever bind its own Supabase project, Workers, queues and Qdrant collection.

The gateway smoke test also asks the new version's `/ready` endpoint, so a release whose gateway cannot use
its database or its search index is rolled back. `--allow-index-down` accepts one case only: a search index
that does not answer (for example a suspended free cluster that is being reactivated).
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import sys
import time
from urllib import error, parse, request

if __package__:
    from .gemini_model_policy import embedding_model, generation_models
else:
    from gemini_model_policy import embedding_model, generation_models

ROOT = Path(__file__).resolve().parents[1]
WRANGLER_DEFAULT = "npx --yes wrangler@4.148.0"
SHA = re.compile(r"^[a-f0-9]{40}$")
API = "https://api.cloudflare.com/client/v4"

# The Workers named "*-preview" have served production since September 2026 (decision D8): releasing into them
# keeps the public URL, the OAuth redirect settings, the queue and the stored secrets.
TARGETS = {
    "candidate": {
        "gateway_worker": "nexusrag-v6-candidate-gateway",
        "gateway_config": "apps/gateway/wrangler.preview.jsonc",
        "frontend_worker": "nexusrag-v6-candidate-frontend",
        "frontend_config": "wrangler.jsonc",
        "queue": "nexusrag-v6-candidate-ingestion",
        "dlq": "nexusrag-v6-candidate-ingestion-dlq",
        "qdrant_collection": "nexusrag-v6-candidate",
        "supabase_ref": "ukgjygzfhyvnrsecdcuu",
    },
    "production": {
        "gateway_worker": "nexusrag-v6-preview-gateway",
        "gateway_config": "apps/gateway/wrangler.production.jsonc",
        "frontend_worker": "nexusrag-v6-frontend-preview",
        "frontend_config": "wrangler.production.jsonc",
        "queue": "nexusrag-v6-preview-ingestion",
        "dlq": "nexusrag-v6-preview-ingestion-dlq",
        "qdrant_collection": "nexusrag-v6-preview",
        "supabase_ref": "fcjaomiceajcdownarel",
    },
}


# PR-specific preview configs were retired in October 2026; deployments must not bring them back.
RETIRED_CONFIGS = ("frontend/wrangler.pr3.jsonc", "apps/gateway/wrangler.pr3-preview.jsonc")
# The frontend Worker wraps the OpenNext Worker so document links are served from the shell and every page gets its
# script and connection policy (NX-28).
FRONTEND_WRAPPER = (
    'import nextWorker from "./.open-next/worker.js"',
    'import pagePolicy from "./.open-next/page-policy.json"',
    'from "./src/lib/static-document-worker"',
    'export * from "./.open-next/worker.js"',
    "export default createDocumentStaticWorker(nextWorker, pagePolicy.connect)",
)


class ReleaseError(RuntimeError):
    """A release precondition or step failed; the message is safe to print."""


def supabase_url(target: dict) -> str:
    return f"https://{target['supabase_ref']}.supabase.co"


def other_refs(name: str) -> list[str]:
    return [target["supabase_ref"] for key, target in TARGETS.items() if key != name]


def require_env(*names: str) -> dict[str, str]:
    values = {name: os.environ.get(name, "").strip() for name in names}
    missing = [name for name, value in values.items() if not value]
    if missing:
        raise ReleaseError(f"Missing environment: {', '.join(missing)}")
    return values


def strip_jsonc(text: str) -> str:
    return re.sub(r"^\s*//.*$", "", text, flags=re.M)


def validate_targets(root: Path = ROOT) -> None:
    """Every target owns its resources, and its wrangler configs name exactly those resources."""
    for retired in RETIRED_CONFIGS:
        if (root / retired).exists():
            raise ReleaseError(f"Retired PR preview configuration must not be recreated: {retired}")
    wrapper = root / "frontend" / "worker.js"
    if not wrapper.is_file():
        raise ReleaseError("The frontend routing wrapper frontend/worker.js is missing.")
    for expected in FRONTEND_WRAPPER:
        if expected not in wrapper.read_text(encoding="utf-8"):
            raise ReleaseError(f"The frontend wrapper does not preserve {expected}.")
    for key in ("gateway_worker", "frontend_worker", "queue", "dlq", "qdrant_collection", "supabase_ref"):
        values = [target[key] for target in TARGETS.values()]
        if len(values) != len(set(values)):
            raise ReleaseError(f"Release targets share a resource that must be separate: {key}")
    for name, target in TARGETS.items():
        gateway = json.loads(strip_jsonc((root / target["gateway_config"]).read_text(encoding="utf-8")))
        queues = gateway.get("queues", {})
        producer = (queues.get("producers") or [{}])[0]
        consumer = (queues.get("consumers") or [{}])[0]
        if (gateway.get("name") != target["gateway_worker"] or producer.get("queue") != target["queue"]
                or consumer.get("queue") != target["queue"] or consumer.get("dead_letter_queue") != target["dlq"]):
            raise ReleaseError(f"{target['gateway_config']} does not match the {name} target.")
        if gateway.get("observability", {}).get("redact_query_string") is not True:
            raise ReleaseError(f"{target['gateway_config']} must redact query strings in logs.")
        frontend = json.loads(strip_jsonc((root / "frontend" / target["frontend_config"]).read_text(encoding="utf-8")))
        service = (frontend.get("services") or [{}])[0].get("service")
        if frontend.get("name") != target["frontend_worker"] or service != target["frontend_worker"]:
            raise ReleaseError(f"frontend/{target['frontend_config']} does not match the {name} target.")
        if frontend.get("observability", {}).get("redact_query_string") is not True:
            raise ReleaseError(f"frontend/{target['frontend_config']} must redact query strings in logs.")
        assets = frontend.get("assets", {})
        # Unknown paths must reach the Worker and return 404 rather than crash it (NX-01), and original
        # documents must pass through the wrapper.
        if (frontend.get("main") != "worker.js" or assets.get("binding") != "ASSETS"
                or assets.get("run_worker_first") != ["/documents/*"]
                or assets.get("html_handling") != "none" or assets.get("not_found_handling") != "none"):
            raise ReleaseError(f"frontend/{target['frontend_config']} does not keep the required asset routing.")


def cloudflare(path: str, token: str) -> dict:
    call = request.Request(f"{API}{path}", headers={"Authorization": f"Bearer {token}"})
    try:
        with request.urlopen(call, timeout=30) as response:
            body = json.loads(response.read(4 * 1024 * 1024))
    except error.HTTPError as exc:
        raise ReleaseError(f"Cloudflare API returned HTTP {exc.code} for {path.split('?')[0]}") from None
    except (error.URLError, TimeoutError, OSError, ValueError) as exc:
        raise ReleaseError(f"Cloudflare API request failed: {type(exc).__name__}") from None
    if not isinstance(body, dict) or body.get("success") is not True:
        raise ReleaseError(f"Cloudflare API did not succeed for {path.split('?')[0]}")
    return body


def origins(target: dict, account: str, token: str) -> dict[str, str]:
    subdomain = cloudflare(f"/accounts/{account}/workers/subdomain", token)["result"]["subdomain"]
    return {
        "gateway": f"https://{target['gateway_worker']}.{subdomain}.workers.dev",
        "frontend": f"https://{target['frontend_worker']}.{subdomain}.workers.dev",
    }


def active_version(worker: str, account: str, token: str) -> str | None:
    """The version currently taking all traffic, or None for a Worker that has never been deployed."""
    try:
        body = cloudflare(f"/accounts/{account}/workers/scripts/{worker}/deployments", token)
    except ReleaseError as exc:
        if "HTTP 404" in str(exc):
            return None
        raise
    deployments = body.get("result", {}).get("deployments") or []
    if not deployments:
        return None
    versions = sorted(deployments[0].get("versions") or [], key=lambda item: item.get("percentage", 0), reverse=True)
    return versions[0].get("version_id") if versions else None


def wrangler(*args: str, cwd: Path = ROOT, check: bool = True) -> subprocess.CompletedProcess:
    command = [*shlex.split(os.environ.get("WRANGLER", WRANGLER_DEFAULT)), *args]
    result = subprocess.run(command, cwd=cwd, check=False)
    if check and result.returncode != 0:
        raise ReleaseError(f"wrangler {args[0]} failed with exit code {result.returncode}")
    return result


def ensure_queues(target: dict) -> None:
    for queue in (target["queue"], target["dlq"]):
        if wrangler("queues", "info", queue, check=False).returncode != 0:
            # Workers Free keeps queue messages for 24 hours at most.
            wrangler("queues", "create", queue, "--message-retention-period-secs", "86400")


def fetch(url: str) -> tuple[int, str]:
    call = request.Request(url, headers={"User-Agent": "nexusrag-release-smoke"})
    try:
        with request.urlopen(call, timeout=30) as response:
            return response.status, response.read(2 * 1024 * 1024).decode("utf-8", "replace")
    except error.HTTPError as exc:
        return exc.code, exc.read(64 * 1024).decode("utf-8", "replace")
    except (error.URLError, TimeoutError, OSError) as exc:
        return 0, type(exc).__name__


def page_policy(url: str) -> str:
    """The Content-Security-Policy a page is served with, or "" when it cannot be read."""
    call = request.Request(url, headers={"User-Agent": "nexusrag-release-smoke"})
    try:
        with request.urlopen(call, timeout=30) as response:
            return response.headers.get("Content-Security-Policy", "")
    except (error.URLError, TimeoutError, OSError):
        return ""


PAGE_SCRIPT_POLICY = re.compile(r"script-src 'self'( 'sha256-[A-Za-z0-9+/]{43}=')+")


def url_origin(url: str) -> str:
    parts = parse.urlsplit(url)
    return f"{parts.scheme}://{parts.netloc}"


def policy_failures(policy: str, connect: tuple[str, ...]) -> list[str]:
    """What is wrong with a page's policy: the Worker gives every page its inline scripts' hashes and lets it connect
    only to its own origin, the gateway and Supabase (NX-28). Without them, the deploy bypassed the Worker's entry
    point or was built for other services."""
    directives = {part.strip().split(" ", 1)[0]: part.strip() for part in policy.split(";") if part.strip()}
    failures = []
    if not PAGE_SCRIPT_POLICY.fullmatch(directives.get("script-src", "")):
        failures.append("the home page is served without its script policy (script-src 'self' with the page's hashes)")
    allowed = set(directives.get("connect-src", "").split()[1:])
    if allowed != {"'self'", *connect}:
        failures.append(f"the home page may connect to {sorted(allowed) or 'anywhere'}, expected 'self' and {', '.join(connect)}")
    return failures


def until_clean(check, attempts: int = 6, pause: float = 4.0) -> list[str]:
    """Retry a smoke check while a new deployment propagates; return the last list of failures."""
    failures: list[str] = []
    for attempt in range(attempts):
        failures = check()
        if not failures:
            return []
        if attempt + 1 < attempts:
            time.sleep(pause * (attempt + 1))
    return failures


def gateway_failures(origin: str, target: dict, sha: str, models: tuple[str, ...], embedding: str) -> list[str]:
    failures = []
    status, body = fetch(f"{origin}/health")
    try:
        health = json.loads(body) if status == 200 else {}
    except ValueError:
        health = {}
    expected = {
        "service": target["gateway_worker"], "source_commit": sha, "status": "CONFIGURED",
        "authenticated_api": True, "paid_fallback": False,
    }
    if status != 200:
        failures.append(f"/health returned HTTP {status}")
    for key, value in expected.items():
        if status == 200 and health.get(key) != value:
            failures.append(f"/health {key} is {health.get(key)!r}, expected {value!r}")
    if status == 200:
        if health.get("providers") != {"qdrant": "CONFIGURED", "gemini": "CONFIGURED"}:
            failures.append("/health reports a provider that is not configured")
        served = health.get("gemini_models") or {}
        if served.get("generation") not in models or served.get("embedding") != embedding:
            failures.append(f"/health reports models {served!r}, expected one of {list(models)} and {embedding}")
    status, _ = fetch(f"{origin}/api/v2/capabilities")
    if status != 401:
        failures.append(f"an unauthenticated API call returned HTTP {status}, expected 401")
    return failures


DATABASE_PROBLEMS = {
    "KEY_REJECTED": "the database refused the gateway's service role key (SUPABASE_SERVICE_ROLE_KEY)",
    "SCHEMA_MISSING": "the database has no NexusRAG schema; apply the migrations first",
    "NOT_CONFIGURED": "SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing on the Worker",
}
INDEX_PROBLEMS = {
    "KEY_REJECTED": "the search index refused the gateway's key (QDRANT_API_KEY)",
    "NOT_CONFIGURED": "QDRANT_URL or QDRANT_API_KEY is missing on the Worker",
}


def readiness_check(origin: str, target: dict, allow_index_down: bool = False) -> tuple[list[str], list[str]]:
    """What the released gateway reached with its own credentials: (failures, notes for the summary)."""
    status, body = fetch(f"{origin}/ready")
    try:
        answer = json.loads(body) if status in (200, 503) else None
    except ValueError:
        answer = None
    dependencies = answer.get("dependencies") if isinstance(answer, dict) else None
    if not isinstance(dependencies, dict):
        return [f"/ready returned HTTP {status} without a readiness report"], []
    failures, notes = [], []
    database = (dependencies.get("database") or {}).get("state")
    if database != "REACHABLE":
        failures.append(DATABASE_PROBLEMS.get(database, f"the database did not answer the gateway ({database})"))
    index = dependencies.get("search_index") or {}
    state, collection = index.get("state"), index.get("collection")
    if collection != target["qdrant_collection"]:
        failures.append(f"the gateway uses the collection {collection!r}, expected {target['qdrant_collection']!r}")
    if state == "READY":
        holds = {True: "holds indexed documents", False: "is empty"}.get(index.get("populated"), "answered")
        notes.append(f"Search index: ready; `{collection}` {holds}")
    elif state == "EMPTY":
        notes.append(f"Search index: reachable; `{collection}` will be created by the first upload")
    elif state in INDEX_PROBLEMS:
        failures.append(INDEX_PROBLEMS[state])
    elif allow_index_down:
        notes.append(f"Search index: did not answer ({state}); released anyway because --allow-index-down was given")
    else:
        failures.append(f"the search index did not answer the gateway ({state}); if the cluster was suspended, "
                        "reactivate it in Qdrant Cloud and release again, or pass --allow-index-down")
    return failures, notes


def frontend_failures(site: str, sha: str, connect: tuple[str, ...]) -> list[str]:
    failures = []
    status, body = fetch(f"{site}/")
    if status != 200 or "NexusRAG" not in body:
        failures.append(f"the home page returned HTTP {status} or lacks the product name")
    failures += policy_failures(page_policy(f"{site}/"), connect)
    status, body = fetch(f"{site}/_nexus-build.json")
    try:
        built = json.loads(body).get("source_commit") if status == 200 else None
    except ValueError:
        built = None
    if built != sha:
        failures.append(f"the deployed build identity is {built!r}, expected {sha}")
    for path in ("/research", "/radar", "/evidence-api"):
        status, _ = fetch(f"{site}{path}")
        if status != 200:
            failures.append(f"{path} returned HTTP {status}")
    status, _ = fetch(f"{site}/release-smoke-missing-{sha[:12]}")
    if status != 404:
        failures.append(f"an unknown path returned HTTP {status}, expected 404")
    return failures


def rollback(worker: str, previous: str | None, reason: str) -> str:
    if not previous:
        return "no earlier version exists to roll back to"
    result = wrangler("rollback", previous, "--name", worker, "--message", reason, "--yes", check=False)
    return f"rolled back to {previous}" if result.returncode == 0 else f"ROLLBACK FAILED; restore version {previous} by hand"


def report(lines: list[str]) -> None:
    text = "\n".join(lines)
    print(text)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with Path(os.environ["GITHUB_STEP_SUMMARY"]).open("a", encoding="utf-8") as handle:
            handle.write(text + "\n")


def finish(component: str, name: str, worker: str, origin: str, sha: str, previous: str | None, failures: list[str],
           notes: tuple[str, ...] | list[str] = ()) -> int:
    if os.environ.get("GITHUB_OUTPUT"):
        with Path(os.environ["GITHUB_OUTPUT"]).open("a", encoding="utf-8") as handle:
            handle.write(f"previous_version={previous or ''}\n")
    if not failures:
        report([f"## {component} released to {name}", "", f"- Worker: `{worker}`", f"- URL: {origin}",
                f"- Commit: `{sha}`", f"- Previous version: `{previous or 'none'}`", "- Smoke test: passed",
                *[f"- {note}" for note in notes]])
        return 0
    outcome = rollback(worker, previous, f"smoke test failed for {sha[:12]}")
    report([f"## {component} release to {name} failed", "", *[f"- {failure}" for failure in failures], f"- Result: {outcome}"])
    return 1


def release_gateway(name: str, sha: str, secrets_file: str | None, allow_index_down: bool = False) -> int:
    target = TARGETS[name]
    env = require_env("CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID", "SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY")
    if env["SUPABASE_URL"] != supabase_url(target):
        raise ReleaseError(f"The {name} gateway may only use the Supabase project {target['supabase_ref']}.")
    if secrets_file and not Path(secrets_file).is_file():
        raise ReleaseError("The secrets file does not exist.")
    models = generation_models(os.environ.get("GEMINI_MODEL"))
    embedding = embedding_model(os.environ.get("GEMINI_EMBEDDING_MODEL"))
    urls = origins(target, env["CLOUDFLARE_ACCOUNT_ID"], env["CLOUDFLARE_API_TOKEN"])
    previous = active_version(target["gateway_worker"], env["CLOUDFLARE_ACCOUNT_ID"], env["CLOUDFLARE_API_TOKEN"])
    ensure_queues(target)
    variables = {
        "SUPABASE_URL": env["SUPABASE_URL"],
        "SUPABASE_PUBLISHABLE_KEY": env["SUPABASE_PUBLISHABLE_KEY"],
        "QDRANT_COLLECTION": target["qdrant_collection"],
        "FRONTEND_ORIGIN": urls["frontend"],
        "RUNTIME_SERVICE_NAME": target["gateway_worker"],
        # --keep-vars would keep a stale model on the Worker, so every release states the policy (D24).
        "GEMINI_MODEL": ",".join(models),
        "GEMINI_EMBEDDING_MODEL": embedding,
        "SOURCE_COMMIT": sha,
    }
    arguments = ["deploy", "--config", target["gateway_config"], "--keep-vars", "--message", f"release {sha[:12]}"]
    for key, value in variables.items():
        arguments += ["--var", f"{key}:{value}"]
    if secrets_file:
        # Secrets ship with the new version, so the new code never takes traffic without them.
        arguments += ["--secrets-file", secrets_file]
    wrangler(*arguments)
    notes: list[str] = []

    def smoke() -> list[str]:
        failures = gateway_failures(urls["gateway"], target, sha, models, embedding)
        unreachable, notes[:] = readiness_check(urls["gateway"], target, allow_index_down)
        return failures + unreachable

    failures = until_clean(smoke)
    return finish("Gateway", name, target["gateway_worker"], urls["gateway"], sha, previous, failures, notes)


def release_frontend(name: str, sha: str) -> int:
    target = TARGETS[name]
    env = require_env("CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID")
    build = ROOT / "frontend" / ".open-next"
    identity = build / "assets" / "_nexus-build.json"
    if not identity.is_file() or json.loads(identity.read_text()).get("source_commit") != sha:
        raise ReleaseError("Build the frontend for this commit first: write-build-info.mjs, then npm run cf:build.")
    for path in build.rglob("*"):
        if path.is_file() and path.suffix in {".js", ".mjs", ".json", ".html"}:
            content = path.read_text(encoding="utf-8", errors="ignore")
            if any(ref in content for ref in other_refs(name)):
                raise ReleaseError(f"The frontend build contains another environment's Supabase project: {path.name}")
    urls = origins(target, env["CLOUDFLARE_ACCOUNT_ID"], env["CLOUDFLARE_API_TOKEN"])
    previous = active_version(target["frontend_worker"], env["CLOUDFLARE_ACCOUNT_ID"], env["CLOUDFLARE_API_TOKEN"])
    result = subprocess.run(["npm", "run", "cf:deploy", "--", "--config", target["frontend_config"]], cwd=ROOT / "frontend", check=False)
    if result.returncode != 0:
        raise ReleaseError(f"The frontend deploy failed with exit code {result.returncode}")
    connect = (url_origin(urls["gateway"]), url_origin(supabase_url(target)))
    failures = until_clean(lambda: frontend_failures(urls["frontend"], sha, connect))
    return finish("Frontend", name, target["frontend_worker"], urls["frontend"], sha, previous, failures)


def build_env(name: str) -> int:
    """Public build settings for the frontend, in GITHUB_ENV format."""
    target = TARGETS[name]
    env = require_env("CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY")
    if env["NEXT_PUBLIC_SUPABASE_URL"] != supabase_url(target):
        raise ReleaseError(f"The {name} frontend may only use the Supabase project {target['supabase_ref']}.")
    urls = origins(target, env["CLOUDFLARE_ACCOUNT_ID"], env["CLOUDFLARE_API_TOKEN"])
    print(f"NEXT_PUBLIC_API_URL={urls['gateway']}")
    print(f"NEXT_PUBLIC_SITE_URL={urls['frontend']}")
    return 0


def roll_back(name: str, component: str, version: str) -> int:
    worker = TARGETS[name][f"{component}_worker"]
    if not re.fullmatch(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", version or ""):
        raise ReleaseError("--version must be a Worker version ID.")
    require_env("CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID")
    outcome = rollback(worker, version, "release rolled back")
    report([f"## {component.capitalize()} on {name}: {outcome}", "", f"- Worker: `{worker}`"])
    return 0 if outcome.startswith("rolled back") else 1


def plan(name: str) -> int:
    target = TARGETS[name]
    print(json.dumps({"target": name, **target, "supabase_url": supabase_url(target),
                      "gemini_model": ",".join(generation_models(os.environ.get("GEMINI_MODEL"))),
                      "gemini_embedding_model": embedding_model(os.environ.get("GEMINI_EMBEDDING_MODEL"))}, indent=2))
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("command", choices=["plan", "env", "gateway", "frontend", "rollback"])
    parser.add_argument("--target", choices=sorted(TARGETS), required=True)
    parser.add_argument("--sha", help="full commit SHA being released")
    parser.add_argument("--component", choices=["gateway", "frontend"], help="Worker to roll back")
    parser.add_argument("--version", help="Worker version ID to roll back to")
    parser.add_argument("--secrets-file", help="JSON or .env file of Worker secrets to ship with the gateway version")
    parser.add_argument("--allow-index-down", action="store_true",
                        help="release the gateway even though its search index does not answer")
    args = parser.parse_args(argv)
    try:
        validate_targets()
        if args.command == "plan":
            return plan(args.target)
        if args.command == "env":
            return build_env(args.target)
        if args.command == "rollback":
            if not args.component:
                raise ReleaseError("rollback needs --component gateway or frontend.")
            return roll_back(args.target, args.component, args.version)
        if not SHA.fullmatch(args.sha or ""):
            raise ReleaseError("--sha must be a full 40-character commit SHA.")
        if args.command == "gateway":
            return release_gateway(args.target, args.sha, args.secrets_file, args.allow_index_down)
        return release_frontend(args.target, args.sha)
    except ReleaseError as exc:
        # stderr keeps redirected stdout (for example >>"$GITHUB_ENV") clean; GitHub reads annotations from both.
        print(f"::error::{exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
