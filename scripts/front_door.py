"""Give a NexusRAG target its plain public address: the front door, a Cloudflare Pages project whose code
(apps/front-door/worker.js) hands the gateway's API and probes to the target's gateway Worker and every other
request to its frontend Worker, each through a service binding, so the app and its API share one address.

  python3 scripts/front_door.py plan   --target production
  python3 scripts/front_door.py deploy --target production

Environment: CLOUDFLARE_API_TOKEN (with Pages edit access) and CLOUDFLARE_ACCOUNT_ID.

`deploy` creates the Pages project when it is missing, refuses one whose address Cloudflare gave differently (the
name is taken by another account), binds the frontend Worker as APP and the gateway Worker as GATEWAY, and uploads
only the front door's code: no files and no upload token, so it also works from a session whose proxy replaces every
Cloudflare Authorization header. It then waits until the address answers /health as the gateway, which is what
scripts/release.py checks before it builds or releases anything for that address.

Deploying never breaks the app: the front door serves a build made for its address and sends the visitors of any
other build to the address that build names. The Workers have no workers.dev address, so this is their only one.
Runbook: docs/DEPLOYMENT_PRODUCTION.md ("The public address").
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sys
import time
import uuid
from urllib import error, parse, request

if __package__:
    from .release import API, ROOT, TARGETS, ReleaseError, gateway_behind, require_env, validate_targets
else:
    from release import API, ROOT, TARGETS, ReleaseError, gateway_behind, require_env, validate_targets

FRONT_DOOR = ROOT / "apps" / "front-door" / "worker.js"
# The same runtime date as the app's Workers, which the pinned wrangler also runs locally.
COMPATIBILITY_DATE = "2026-09-20"
PRODUCTION_BRANCH = "main"
APP_BINDING = "APP"
GATEWAY_BINDING = "GATEWAY"


def bindings(target: dict) -> dict[str, str]:
    """The Worker behind each of the front door's bindings."""
    return {APP_BINDING: target["frontend_worker"], GATEWAY_BINDING: target["gateway_worker"]}


def api(method: str, path: str, token: str, *, body: dict | None = None, form: list[tuple] | None = None,
        missing_ok: bool = False) -> dict:
    """One Cloudflare API call; returns the parsed answer. With `missing_ok`, a 404 is returned as
    {"success": False, "status": 404} so the caller can create what is missing; any other failure raises."""
    headers = {"Authorization": f"Bearer {token}"}
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    elif form is not None:
        data, headers["Content-Type"] = multipart(form)
    call = request.Request(f"{API}{path}", data=data, headers=headers, method=method)
    try:
        with request.urlopen(call, timeout=60) as response:
            answer = json.loads(response.read(4 * 1024 * 1024))
    except error.HTTPError as exc:
        if exc.code == 404 and missing_ok:
            return {"success": False, "status": 404}
        raise ReleaseError(f"Cloudflare API returned HTTP {exc.code} for {method} {path.split('?')[0]}: "
                           f"{api_errors(exc.read(64 * 1024))}") from None
    except (error.URLError, TimeoutError, OSError, ValueError) as exc:
        raise ReleaseError(f"Cloudflare API request failed: {type(exc).__name__}") from None
    if not isinstance(answer, dict) or answer.get("success") is not True:
        raise ReleaseError(f"Cloudflare API did not succeed for {method} {path.split('?')[0]}")
    return answer


def api_errors(raw: bytes) -> str:
    """Cloudflare's own error messages, which name what is wrong (never a credential)."""
    try:
        errors = json.loads(raw).get("errors") or []
    except (ValueError, AttributeError):
        return "no details"
    return "; ".join(str(item.get("message", "")).strip() for item in errors if isinstance(item, dict)) or "no details"


def multipart(fields: list[tuple]) -> tuple[bytes, str]:
    """multipart/form-data for (name, value) text fields and (name, filename, bytes, content type) files."""
    boundary = f"nexusrag-{uuid.uuid4().hex}"
    parts = []
    for field in fields:
        if len(field) == 2:
            name, value = field
            parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode())
        else:
            name, filename, content, kind = field
            parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"; filename="{filename}"\r\n'
                         f"Content-Type: {kind}\r\n\r\n".encode() + content + b"\r\n")
    parts.append(f"--{boundary}--\r\n".encode())
    return b"".join(parts), f"multipart/form-data; boundary={boundary}"


def production_config(target: dict) -> dict:
    """What the front door runs with: the frontend Worker as APP, the gateway Worker as GATEWAY, and its one public
    address (every other address of the project is sent there)."""
    return {
        "compatibility_date": COMPATIBILITY_DATE,
        "compatibility_flags": [],
        "services": {binding: {"service": worker, "environment": "production"} for binding, worker in bindings(target).items()},
        "env_vars": {"PUBLIC_ORIGIN": {"type": "plain_text", "value": target["public_url"]}},
    }


def with_stale_removed(config: dict, current: dict) -> dict:
    """`config` as a PATCH body. Cloudflare merges the variables and bindings a PATCH names into the project's, so each
    one the project still has but `config` no longer sets is named with null, which removes it."""
    body = dict(config)
    for key in ("env_vars", "services"):
        stale = sorted(set((current or {}).get(key) or {}) - set(config.get(key) or {}))
        if stale:
            body[key] = {**config.get(key, {}), **{name: None for name in stale}}
    return body


def ensure_project(target: dict, account: str, token: str) -> dict:
    path = f"/accounts/{account}/pages/projects/{target['pages_project']}"
    project = api("GET", path, token, missing_ok=True)
    if project.get("status") == 404:
        project = api("POST", f"/accounts/{account}/pages/projects", token,
                      body={"name": target["pages_project"], "production_branch": PRODUCTION_BRANCH})
        print(f"Created the Pages project {target['pages_project']}.")
    result = project["result"]
    expected = parse.urlsplit(target["public_url"]).hostname
    if result.get("subdomain") != expected:
        raise ReleaseError(f"Cloudflare gave {target['pages_project']} the address {result.get('subdomain')!r}, not {expected}: "
                           "the name is taken. Choose another pages_project and public_url in scripts/release.py.")
    return result


def deploy(name: str, attempts: int = 30, pause: float = 4.0) -> int:
    target = TARGETS[name]
    env = require_env("CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID")
    account, token = env["CLOUDFLARE_ACCOUNT_ID"], env["CLOUDFLARE_API_TOKEN"]
    code = FRONT_DOOR.read_bytes()
    current = (ensure_project(target, account, token).get("deployment_configs") or {}).get("production") or {}
    path = f"/accounts/{account}/pages/projects/{target['pages_project']}"
    # Bindings and variables are read when a deployment is made, so they are set first.
    config = with_stale_removed(production_config(target), current)
    api("PATCH", path, token, body={"production_branch": PRODUCTION_BRANCH, "deployment_configs": {"production": config}})
    created = api("POST", f"{path}/deployments", token, form=[
        ("manifest", "{}"),
        ("branch", PRODUCTION_BRANCH),
        ("commit_message", f"front door for {target['frontend_worker']}"),
        ("_worker.js", "_worker.js", code, "application/javascript"),
    ])["result"]
    deployment = created.get("id")
    for attempt in range(attempts):
        stage = (api("GET", f"{path}/deployments/{deployment}", token)["result"].get("latest_stage") or {})
        if stage.get("name") == "deploy" and stage.get("status") == "success":
            break
        if stage.get("status") in {"failure", "canceled"}:
            raise ReleaseError(f"The front door deployment {deployment} stopped at {stage.get('name')}: {stage.get('status')}.")
        if attempt + 1 < attempts:
            time.sleep(pause)
    else:
        raise ReleaseError(f"The front door deployment {deployment} did not finish in time; check the Pages project.")
    for attempt in range(attempts):
        status, service = gateway_behind(target["public_url"])
        if service == target["gateway_worker"]:
            break
        if attempt + 1 < attempts:
            time.sleep(pause)
    else:
        raise ReleaseError(f"The front door deployment {deployment} is live, but {target['public_url']}/health is not "
                           f"answered by {target['gateway_worker']} (HTTP {status}). Check the GATEWAY binding in the "
                           "Pages project and that the gateway Worker answers.")
    print(f"The front door {target['public_url']} serves {target['frontend_worker']} and its API from "
          f"{target['gateway_worker']} (deployment {deployment}).")
    return 0


def plan(name: str) -> int:
    target = TARGETS[name]
    print(json.dumps({"target": name, "pages_project": target["pages_project"], "public_url": target["public_url"],
                      "bindings": bindings(target), "compatibility_date": COMPATIBILITY_DATE,
                      "code": str(FRONT_DOOR.relative_to(ROOT))}, indent=2))
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("command", choices=["plan", "deploy"])
    parser.add_argument("--target", choices=sorted(TARGETS), required=True)
    args = parser.parse_args(argv)
    try:
        validate_targets()
        return plan(args.target) if args.command == "plan" else deploy(args.target)
    except ReleaseError as exc:
        print(f"::error::{exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
