"""End-to-end smoke test of the deployed candidate preview with two real accounts.

Runs the core journey on real services (Supabase, the ingestion queue, Qdrant and Gemini through the
gateway's own keys): workspace, upload, ingestion, a grounded answer with citations, proof that a second
account can see none of it, deletion, and proof that the answer is gone afterwards.

  SMOKE_GATEWAY_URL=... SMOKE_SUPABASE_URL=... SMOKE_SUPABASE_PUBLISHABLE_KEY=... \\
  SMOKE_USER_A_EMAIL=... SMOKE_USER_A_PASSWORD=... SMOKE_USER_B_EMAIL=... SMOKE_USER_B_PASSWORD=... \\
  python3 scripts/preview_smoke.py [--keep-document] [--report FILE]

It refuses to run against anything but the candidate gateway. Each account's free trial covers one document
and five chats on the platform key, so reset the two test accounts' usage on the rehearsal project before a
rerun (rows in nexus_account_usage and nexus_account_operations for those users), or give them their own keys.
A run that fails after its upload deletes the document it uploaded, so reruns start clean.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import secrets
import sys
import time
from urllib import error, request
import uuid

TIMEOUT = 90
INGESTION_DEADLINE = 300
DELETION_DEADLINE = 420  # the gateway's cron finishes a deletion that had to wait, within a few minutes


class SmokeFailure(RuntimeError):
    pass


def call(method: str, url: str, *, headers: dict | None = None, body: bytes | dict | None = None, timeout: int = TIMEOUT):
    """Returns (status, parsed JSON or text). Never raises for HTTP errors."""
    # Cloudflare rejects the default Python user agent on workers.dev.
    headers = {"User-Agent": "nexusrag-preview-smoke", **(headers or {})}
    if isinstance(body, dict):
        body = json.dumps(body).encode()
        headers.setdefault("Content-Type", "application/json")
    outgoing = request.Request(url, data=body, method=method, headers=headers)
    try:
        with request.urlopen(outgoing, timeout=timeout) as response:
            status, raw = response.status, response.read(8 * 1024 * 1024)
    except error.HTTPError as exc:
        status, raw = exc.code, exc.read(1024 * 1024)
    except (error.URLError, TimeoutError, OSError) as exc:
        return 0, type(exc).__name__
    text = raw.decode("utf-8", "replace")
    try:
        return status, json.loads(text)
    except ValueError:
        return status, text


def multipart(fields: dict[str, str], filename: str, content: bytes, content_type: str) -> tuple[bytes, str]:
    boundary = f"----nexusrag-smoke-{secrets.token_hex(12)}"
    parts = []
    for name, value in fields.items():
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode())
    parts.append(
        f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{filename}"\r\nContent-Type: {content_type}\r\n\r\n'.encode()
        + content + b"\r\n")
    parts.append(f"--{boundary}--\r\n".encode())
    return b"".join(parts), f"multipart/form-data; boundary={boundary}"


class Account:
    def __init__(self, label: str, gateway: str, token: str, user_id: str):
        self.label, self.gateway, self.token, self.user_id = label, gateway, token, user_id
        self.workspace: str | None = None

    def api(self, method: str, path: str, *, workspace: str | None = None, body=None, extra: dict | None = None, idempotent: bool = False):
        headers = {"Authorization": f"Bearer {self.token}", **(extra or {})}
        bound = workspace or self.workspace
        if bound:
            headers["X-Nexus-Workspace-Id"] = bound
        if idempotent:
            headers["Idempotency-Key"] = str(uuid.uuid4())
        return call(method, f"{self.gateway}{path}", headers=headers, body=body)


class Smoke:
    def __init__(self, env: dict[str, str], keep_document: bool):
        self.env, self.keep_document = env, keep_document
        self.gateway = env["SMOKE_GATEWAY_URL"].rstrip("/")
        self.results: list[dict] = []
        self.marker = f"ZEPHYR-{secrets.token_hex(4).upper()}"
        self.document_id: str | None = None
        self.owner: Account | None = None
        self.deleted = False

    def check(self, name: str, ok: bool, detail: str = "") -> None:
        self.results.append({"check": name, "ok": bool(ok), "detail": detail})
        print(f"{'PASS' if ok else 'FAIL'}  {name}{f' — {detail}' if detail else ''}", flush=True)
        if not ok:
            raise SmokeFailure(name)

    def sign_in(self, label: str) -> Account:
        status, body = call("POST", f"{self.env['SMOKE_SUPABASE_URL'].rstrip('/')}/auth/v1/token?grant_type=password",
                            headers={"apikey": self.env["SMOKE_SUPABASE_PUBLISHABLE_KEY"]},
                            body={"email": self.env[f"SMOKE_USER_{label}_EMAIL"], "password": self.env[f"SMOKE_USER_{label}_PASSWORD"]})
        ok = status == 200 and isinstance(body, dict) and body.get("access_token")
        self.check(f"account {label} signs in", ok, f"HTTP {status}")
        return Account(label, self.gateway, body["access_token"], body["user"]["id"])

    def ensure_workspace(self, account: Account) -> None:
        status, body = account.api("GET", "/api/v1/workspaces")
        self.check(f"account {account.label} lists its workspaces", status == 200 and isinstance(body, dict), f"HTTP {status}")
        if body["workspaces"]:
            account.workspace = body["workspaces"][0]["workspace_id"]
            return
        status, created = account.api("POST", "/api/v1/workspaces", body={"name": f"Smoke test {account.label}"}, idempotent=True)
        self.check(f"account {account.label} creates a workspace", status == 201, f"HTTP {status}")
        status, current = account.api("GET", "/api/v1/workspaces/current")
        self.check(f"account {account.label} is the owner of its workspace",
                   status == 200 and current.get("role") == "owner" and current.get("user_id") == account.user_id, f"HTTP {status}")
        account.workspace = current["workspace_id"]

    def approve_processing(self, account: Account) -> None:
        """The owner allows Gemini to process this workspace's non-sensitive documents (once per terms version)."""
        status, policy = account.api("GET", "/api/v1/privacy/processing-policy")
        self.check(f"account {account.label} can read its processing policy",
                   status == 200 and policy.get("operator_rights_current") is True and policy.get("owner_can_manage") is True,
                   f"HTTP {status} {json.dumps(policy)[:200] if status != 200 or not policy.get('operator_rights_current') else ''}")
        if policy["state"] == "APPROVED":
            return
        status, approved = account.api("PATCH", "/api/v1/privacy/processing-policy", body={
            "operation": "approve", "terms_hash": policy["terms_hash"], "policy_version": policy["policy_version"],
            "acknowledged_non_sensitive_only": True})
        self.check(f"account {account.label} approves Gemini processing as workspace owner",
                   status == 200 and approved.get("state") == "APPROVED", f"HTTP {status} {json.dumps(approved)[:200] if status != 200 else ''}")

    def delete_document(self) -> tuple[int, dict]:
        """Deletes the uploaded document and waits while the service reports that copies are still being erased."""
        started = time.time()
        while True:
            status, body = self.owner.api("POST", f"/api/v1/documents/{self.document_id}/delete", idempotent=True)
            body = body if isinstance(body, dict) else {}
            pending = status == 202 and body.get("state") == "PENDING"
            if not pending or time.time() - started > DELETION_DEADLINE:
                self.deleted = status == 200 and body.get("state") == "DELETED"
                return status, body
            print(f"      deletion pending ({body.get('reason')}); asking again in 30 seconds", flush=True)
            time.sleep(30)

    def clean_up(self) -> None:
        """After a failed run: remove the uploaded document, so the next run does not find leftovers."""
        if self.keep_document or self.deleted or not self.document_id or not self.owner:
            return
        status, body = self.delete_document()
        print(f"      clean-up: deleting the test document returned HTTP {status} {body.get('state') or body.get('error', {}).get('code') or ''}", flush=True)

    def ask(self, account: Account, question: str, **scope):
        return account.api("POST", "/api/v1/chat", body={"question": question, "non_sensitive_attested": True, **scope}, idempotent=True)

    def run(self) -> None:
        status, health = call("GET", f"{self.gateway}/health")
        self.check("gateway is the candidate preview", status == 200 and isinstance(health, dict) and "candidate" in str(health.get("service")),
                   f"{health.get('service') if isinstance(health, dict) else status}")
        print(f"      commit {health.get('source_commit')}, models {json.dumps(health.get('gemini_models'))}")
        status, ready = call("GET", f"{self.gateway}/ready")
        reached = ready.get("dependencies", {}) if isinstance(ready, dict) else {}
        self.check("the gateway reaches its database and its search index", status == 200 and ready.get("readiness") == "READY",
                   f"HTTP {status}; database {reached.get('database', {}).get('state')}, search index {reached.get('search_index', {}).get('state')}")
        status, _ = call("GET", f"{self.gateway}/api/v1/workspaces")
        self.check("a request without a login is refused", status == 401, f"HTTP {status}")
        status, _ = call("GET", f"{self.gateway}/api/v1/workspaces", headers={"Authorization": "Bearer not-a-real-token"})
        self.check("a request with a forged token is refused", status == 401, f"HTTP {status}")

        a, b = self.sign_in("A"), self.sign_in("B")
        self.owner = a
        self.ensure_workspace(a)
        self.ensure_workspace(b)
        self.check("the two accounts have different workspaces", a.workspace != b.workspace)
        self.approve_processing(a)
        self.approve_processing(b)

        text = (
            "NexusRAG smoke-test policy.\n\n"
            f"The retention period for audit records is 47 days. The reference code of this policy is {self.marker}.\n\n"
            "Backups are verified every Tuesday by the operations team. Access reviews happen quarterly.\n"
        ).encode()
        payload, content_type = multipart({"data_classification": "non_sensitive", "non_sensitive_attested": "true"},
                                          f"smoke-policy-{self.marker.lower()}.txt", text, "text/plain")
        status, uploaded = a.api("POST", "/api/v1/documents/upload", body=payload, extra={"Content-Type": content_type}, idempotent=True)
        self.check("account A uploads a document", status == 202 and isinstance(uploaded, dict) and uploaded.get("job_id"),
                   f"HTTP {status} {json.dumps(uploaded)[:200] if status != 202 else ''}")
        self.document_id = uploaded["document"]["document_id"]

        started, job = time.time(), {}
        while time.time() - started < INGESTION_DEADLINE:
            status, job = a.api("GET", f"/api/v1/documents/{self.document_id}/status")
            if status == 200 and job.get("status") in {"completed", "failed", "cancelled"}:
                break
            time.sleep(5)
        self.check("ingestion completes", job.get("status") == "completed",
                   f"{job.get('status')}/{job.get('stage')} after {int(time.time() - started)}s {job.get('error_message') or ''}")
        status, listing = a.api("GET", "/api/v1/documents")
        mine = next((item for item in listing.get("documents", []) if item["document_id"] == self.document_id), None) if status == 200 else None
        self.check("the document is listed as ready with chunks", bool(mine) and mine["status"] == "ready" and mine["chunk_count"] > 0,
                   f"{mine and mine['status']}, {mine and mine['chunk_count']} chunks")

        question = "What is the retention period for audit records, and what is the reference code of the policy?"
        status, answer = self.ask(a, question)
        self.check("account A gets an answer", status == 200 and isinstance(answer, dict), f"HTTP {status} {json.dumps(answer)[:240] if status != 200 else ''}")
        sources = answer.get("sources") or []
        self.check("the answer is grounded in the uploaded document",
                   "47" in answer.get("answer", "") and self.marker in answer.get("answer", "") and bool(sources)
                   and all(source.get("metadata", {}).get("document_id") == self.document_id for source in sources),
                   f"{len(sources)} sources; model {answer.get('metadata', {}).get('model')}")
        session_id = answer.get("metadata", {}).get("session_id")
        status, previews = a.api("GET", f"/api/v1/documents/{self.document_id}/chunks")
        self.check("the cited passages can be opened", status == 200 and self.marker in json.dumps(previews), f"HTTP {status}")

        status, other = self.ask(b, question)
        self.check("account B cannot answer from A's document",
                   status == 200 and not other.get("sources") and self.marker not in json.dumps(other), f"HTTP {status}")
        status, _ = b.api("GET", "/api/v1/documents", workspace=a.workspace)
        self.check("account B cannot list A's workspace", status in {403, 404}, f"HTTP {status}")
        status, _ = b.api("GET", f"/api/v1/documents/{self.document_id}/status", workspace=a.workspace)
        self.check("account B cannot read A's document through A's workspace", status in {403, 404}, f"HTTP {status}")
        status, _ = b.api("GET", f"/api/v1/documents/{self.document_id}/status")
        self.check("account B cannot read A's document through its own workspace", status == 404, f"HTTP {status}")
        status, leaked = b.api("POST", "/api/v1/chat", workspace=a.workspace, idempotent=True,
                               body={"question": question, "non_sensitive_attested": True})
        self.check("account B cannot chat in A's workspace", status in {403, 404} and self.marker not in json.dumps(leaked), f"HTTP {status}")
        if session_id:
            status, hijack = self.ask(b, question, session_id=session_id)
            self.check("account B cannot continue A's conversation", status != 200 or self.marker not in json.dumps(hijack), f"HTTP {status}")

        if self.keep_document:
            print("      keeping the document (--keep-document)")
            return
        status, deleted = self.delete_document()
        self.check("account A deletes the document and every stored copy is verified gone",
                   status == 200 and deleted.get("success") is True and deleted.get("state") == "DELETED" and int(deleted.get("receipts") or 0) >= 5,
                   f"HTTP {status} {json.dumps(deleted)[:240]}")
        status, listing = a.api("GET", "/api/v1/documents")
        self.check("the document is no longer listed",
                   status == 200 and all(item["document_id"] != self.document_id for item in listing.get("documents", [])))
        status, after = self.ask(a, question)
        self.check("the deleted document no longer answers",
                   status == 200 and not after.get("sources") and self.marker not in json.dumps(after), f"HTTP {status}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--keep-document", action="store_true", help="skip the deletion checks")
    parser.add_argument("--report", type=Path, help="write the check results as JSON")
    args = parser.parse_args(argv)
    names = ["SMOKE_GATEWAY_URL", "SMOKE_SUPABASE_URL", "SMOKE_SUPABASE_PUBLISHABLE_KEY",
             "SMOKE_USER_A_EMAIL", "SMOKE_USER_A_PASSWORD", "SMOKE_USER_B_EMAIL", "SMOKE_USER_B_PASSWORD"]
    env = {name: os.environ.get(name, "").strip() for name in names}
    missing = [name for name, value in env.items() if not value]
    if missing:
        print(f"Missing environment: {', '.join(missing)}", file=sys.stderr)
        return 2
    smoke = Smoke(env, args.keep_document)
    try:
        smoke.run()
        outcome = 0
    except SmokeFailure:
        outcome = 1
        smoke.clean_up()
    passed = sum(1 for result in smoke.results if result["ok"])
    print(f"\n{'PREVIEW_SMOKE_PASS' if outcome == 0 else 'PREVIEW_SMOKE_FAIL'}: {passed}/{len(smoke.results)} checks passed")
    if args.report:
        args.report.write_text(json.dumps({"passed": outcome == 0, "marker": smoke.marker, "document_id": smoke.document_id,
                                           "checks": smoke.results}, indent=2) + "\n")
    return outcome


if __name__ == "__main__":
    sys.exit(main())
