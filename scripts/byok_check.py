"""Live check of users' own Gemini keys (BYOK, NX-24) on the preview. Run it with the BYOK Check workflow.

The only Gemini keys are the GitHub environments' own. The workflow gives the preview environment's key to this
script as BYOK_TEST_KEY, and the script uses it as one test account's own key:

1. It signs in as the test account through Supabase Auth's admin API (a magic link it verifies itself; the
   account's password is not changed and no email is sent).
2. It marks the account's five free chats as used, keeping the count it found.
3. A question without a key must be refused with HTTP 402 BYOK_REQUIRED.
4. It stores the key (the gateway checks it with Google and seals it) and asks again: the answer must be generated
   and say that the account's own Google project carries its cost.
5. It removes the key; a question must be refused again.

Whatever happens, it removes the key and restores the count before it exits. It refuses any gateway but the
preview's and any account outside @nexusrag.test, and prints statuses only: never the key, its fingerprint, a token
or an answer, because workflow logs are public.

  SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... BYOK_TEST_KEY=... \\
  python3 scripts/byok_check.py --gateway https://nexusrag-preview.pages.dev --email nexus-e2e-b@nexusrag.test \\
    --question "A question one of the account's ready documents answers"
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import uuid
from typing import Callable
from urllib import error, request

PREVIEW_GATEWAY = "nexusrag-v6-candidate-gateway"
TEST_DOMAIN = "@nexusrag.test"
FREE_CHATS = 5  # nexus_admit_account_operation: the platform key serves five chats per account
USER_AGENT = "nexusrag-byok-check"

Http = Callable[[str, str, dict, "dict | None"], "tuple[int, object]"]


class CheckFailed(RuntimeError):
    pass


def http(method: str, url: str, headers: dict, body: dict | None = None) -> tuple[int, object]:
    """Returns (status, parsed JSON or text); never raises for an HTTP error."""
    data = json.dumps(body).encode() if body is not None else None
    outgoing = request.Request(url, data=data, method=method,
                               headers={"User-Agent": USER_AGENT, **({"Content-Type": "application/json"} if data else {}), **headers})
    try:
        with request.urlopen(outgoing, timeout=90) as response:
            status, raw = response.status, response.read(4 * 1024 * 1024)
    except error.HTTPError as exc:
        status, raw = exc.code, exc.read(1024 * 1024)
    except (error.URLError, TimeoutError, OSError) as exc:
        return 0, type(exc).__name__
    text = raw.decode("utf-8", "replace")
    try:
        return status, json.loads(text)
    except ValueError:
        return status, text


def service_headers(key: str) -> dict:
    # A secret key (sb_secret_...) is refused as a Bearer token; a legacy service_role JWT goes in both headers.
    return {"apikey": key, **({} if key.startswith("sb_") else {"Authorization": f"Bearer {key}"})}


def code_of(body: object) -> str | None:
    return (body.get("error") or {}).get("code") if isinstance(body, dict) and isinstance(body.get("error"), dict) else None


class Check:
    def __init__(self, call: Http, gateway: str, supabase: str, service_key: str, user_key: str, email: str, question: str):
        self.call, self.gateway, self.supabase = call, gateway.rstrip("/"), supabase.rstrip("/")
        self.service = service_headers(service_key)
        self.user_key, self.email, self.question = user_key, email, question
        self.token = self.user_id = self.workspace = None
        self.usage_before: dict | None = None
        self.key_stored = False

    def step(self, name: str, ok: bool, detail: str = "") -> None:
        print(f"{'PASS' if ok else 'FAIL'}  {name}{f' ({detail})' if detail else ''}", flush=True)
        if not ok:
            raise CheckFailed(name)

    def api(self, method: str, path: str, body: dict | None = None) -> tuple[int, object]:
        headers = {"Authorization": f"Bearer {self.token}", "Idempotency-Key": str(uuid.uuid4())}
        if self.workspace:
            headers["X-Nexus-Workspace-Id"] = self.workspace
        return self.call(method, f"{self.gateway}{path}", headers, body)

    def refuse_anything_but_the_preview(self) -> None:
        if not self.email.endswith(TEST_DOMAIN):
            raise CheckFailed(f"only a test account ({TEST_DOMAIN}) may be used")
        status, health = self.call("GET", f"{self.gateway}/health", {}, None)
        service = health.get("service") if isinstance(health, dict) else None
        if status != 200 or service != PREVIEW_GATEWAY:
            raise CheckFailed(f"the gateway is not the preview's (HTTP {status}, service {service})")

    def sign_in(self) -> None:
        status, link = self.call("POST", f"{self.supabase}/auth/v1/admin/generate_link", self.service,
                                 {"type": "magiclink", "email": self.email})
        hashed = (link.get("hashed_token") or (link.get("properties") or {}).get("hashed_token")) if isinstance(link, dict) else None
        self.step("Supabase Auth issues a sign-in link for the test account", status == 200 and bool(hashed), f"HTTP {status}")
        status, session = self.call("POST", f"{self.supabase}/auth/v1/verify", {"apikey": self.service["apikey"]},
                                    {"type": "magiclink", "token_hash": hashed})
        ok = status == 200 and isinstance(session, dict) and session.get("access_token") and (session.get("user") or {}).get("id")
        self.step("the link signs the test account in", bool(ok), f"HTTP {status}")
        self.token, self.user_id = session["access_token"], session["user"]["id"]
        status, listing = self.api("GET", "/api/v1/workspaces")
        workspaces = listing.get("workspaces") if isinstance(listing, dict) else None
        self.step("the account has a workspace", status == 200 and bool(workspaces), f"HTTP {status}")
        self.workspace = workspaces[0]["workspace_id"]
        status, documents = self.api("GET", "/api/v1/documents")
        ready = [d for d in (documents.get("documents") or [])] if isinstance(documents, dict) else []
        self.step("the workspace holds a ready document to ask about", status == 200 and any(d.get("status") == "ready" for d in ready), f"HTTP {status}")

    def usage(self) -> dict | None:
        status, rows = self.call("GET", f"{self.supabase}/rest/v1/nexus_account_usage?user_id=eq.{self.user_id}&select=free_chat_queries,lifetime_documents",
                                 self.service, None)
        if status != 200 or not isinstance(rows, list):
            raise CheckFailed(f"the account's usage could not be read (HTTP {status})")
        return rows[0] if rows else None

    def use_up_free_chats(self) -> None:
        self.usage_before = self.usage() or {}
        status, _ = self.call("POST", f"{self.supabase}/rest/v1/nexus_account_usage?on_conflict=user_id",
                              {**self.service, "Prefer": "resolution=merge-duplicates,return=minimal"},
                              {"user_id": self.user_id, "free_chat_queries": FREE_CHATS})
        self.step("the account's free chats are marked as used", status in (200, 201, 204), f"HTTP {status}")

    def ask(self) -> tuple[int, object]:
        return self.api("POST", "/api/v1/chat", {"question": self.question, "non_sensitive_attested": True})

    def remove_key(self) -> tuple[int, object]:
        status, body = self.api("DELETE", "/api/v1/apikey")
        if status == 200 and isinstance(body, dict) and body.get("workspace_key_configured") is False:
            self.key_stored = False
        return status, body

    def run(self) -> None:
        self.refuse_anything_but_the_preview()
        self.sign_in()
        status, key = self.api("GET", "/api/v1/apikey")
        if isinstance(key, dict) and key.get("workspace_key_configured"):
            self.key_stored = True
            status, _ = self.remove_key()
            self.step("a key left by an earlier run is removed", not self.key_stored, f"HTTP {status}")
        self.use_up_free_chats()
        status, refused = self.ask()
        self.step("without a key, a question past the free chats is refused", status == 402 and code_of(refused) == "BYOK_REQUIRED",
                  f"HTTP {status} {code_of(refused)}")
        status, stored = self.api("POST", "/api/v1/apikey", {"api_key": self.user_key, "cost_consent": True})
        self.key_stored = status == 200
        self.step("the gateway checks the key with Google and stores it sealed",
                  status == 200 and isinstance(stored, dict) and stored.get("workspace_key_configured") is True
                  and bool(stored.get("key_fingerprint")), f"HTTP {status} {code_of(stored) or ''}".strip())
        status, listed = self.api("GET", "/api/v1/apikey")
        self.step("the account reports a key of its own", status == 200 and isinstance(listed, dict) and listed.get("workspace_key_configured") is True,
                  f"HTTP {status}")
        status, answer = self.ask()
        meta = answer.get("metadata") or {} if isinstance(answer, dict) else {}
        self.step("with the key, the question is answered at the account's own cost",
                  status == 200 and meta.get("provider_cost_owner") == "USER_GOOGLE_PROJECT" and not meta.get("abstained") and bool(answer.get("sources")),
                  f"HTTP {status} {code_of(answer) or ''}, cost owner {meta.get('provider_cost_owner')}, sources {len(answer.get('sources') or []) if isinstance(answer, dict) else 0}".replace("  ", " "))
        status, removed = self.remove_key()
        self.step("the key is removed", status == 200 and not self.key_stored, f"HTTP {status}")
        status, refused = self.ask()
        self.step("without the key, questions are refused again", status == 402 and code_of(refused) == "BYOK_REQUIRED",
                  f"HTTP {status} {code_of(refused)}")

    def clean_up(self) -> list[str]:
        """Removes the key and restores the usage count; returns what could not be undone."""
        problems = []
        if self.key_stored:
            status, _ = self.remove_key()
            if self.key_stored:
                problems.append(f"the key could not be removed (HTTP {status}); remove it in the account's settings")
        if self.usage_before is not None:
            body = {"user_id": self.user_id, "free_chat_queries": int(self.usage_before.get("free_chat_queries") or 0)}
            status, _ = self.call("POST", f"{self.supabase}/rest/v1/nexus_account_usage?on_conflict=user_id",
                                  {**self.service, "Prefer": "resolution=merge-duplicates,return=minimal"}, body)
            if status not in (200, 201, 204):
                problems.append(f"the usage count could not be restored (HTTP {status})")
        return problems


def main(argv: list[str] | None = None, call: Http = http) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--gateway", required=True)
    parser.add_argument("--email", required=True)
    parser.add_argument("--question", required=True)
    args = parser.parse_args(argv)
    missing = [name for name in ("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "BYOK_TEST_KEY") if not os.environ.get(name)]
    if missing:
        print(f"Missing environment: {', '.join(missing)}", file=sys.stderr)
        return 2
    check = Check(call, args.gateway, os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"],
                  os.environ["BYOK_TEST_KEY"], args.email, args.question)
    failure = None
    try:
        check.run()
    except CheckFailed as exc:
        failure = str(exc)
    finally:
        problems = check.clean_up()
    for problem in problems:
        print(f"FAIL  clean-up: {problem}", flush=True)
    if failure or problems:
        print(f"BYOK check failed: {failure or 'clean-up incomplete'}", file=sys.stderr)
        return 1
    print("BYOK check passed: the account's own key was stored, used and removed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
