"""Record or check the operator's review of the providers the service sends data to.

Documents can be processed only while the operator has a current review on record for Google Gemini, Qdrant
Cloud and Supabase Storage (valid for 365 days). `record` reads each provider's published terms, stores a
fingerprint of their text together with the reviewing account, and marks the provider usable. When the
fingerprint differs from the last one, workspace owners are asked to approve Gemini processing again.

  SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... python3 scripts/provider_review.py status
  SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... python3 scripts/provider_review.py record \\
      --reviewer-email you@example.com --i-have-read-the-terms

The reviewer must be a confirmed account of this deployment. Run `record` only after reading the terms.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import re
import sys
from urllib import error, parse, request

PROVIDERS = ("gemini", "qdrant", "supabase_storage")
MAX_TERMS_BYTES = 5 * 1024 * 1024
USER_AGENT = "nexusrag-provider-review"


class ReviewError(RuntimeError):
    """A step failed; the message is safe to print."""


class _Text(HTMLParser):
    """Collects the visible text of a page, so markup changes alone do not look like new terms."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self._skip = 0

    def handle_starttag(self, tag, attrs):
        if tag in {"script", "style", "noscript", "template", "svg"}:
            self._skip += 1

    def handle_endtag(self, tag):
        if tag in {"script", "style", "noscript", "template", "svg"} and self._skip:
            self._skip -= 1

    def handle_data(self, data):
        if not self._skip:
            self.parts.append(data)


def terms_fingerprint(body: bytes) -> tuple[str, int]:
    """SHA-256 of the page's visible text with whitespace collapsed, and the length of that text."""
    parser = _Text()
    parser.feed(body.decode("utf-8", "replace"))
    text = re.sub(r"\s+", " ", " ".join(parser.parts)).strip()
    if len(text) < 500:
        raise ReviewError("The terms page has too little text to be the published terms.")
    return hashlib.sha256(text.encode("utf-8")).hexdigest(), len(text)


def fetch_terms(url: str) -> bytes:
    if not url.startswith("https://"):
        raise ReviewError("Terms must be published over HTTPS.")
    call = request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "text/html"})
    try:
        with request.urlopen(call, timeout=30) as response:
            body = response.read(MAX_TERMS_BYTES + 1)
    except error.HTTPError as exc:
        raise ReviewError(f"The terms page returned HTTP {exc.code}: {url}") from None
    except (error.URLError, TimeoutError, OSError) as exc:
        raise ReviewError(f"The terms page could not be read ({type(exc).__name__}): {url}") from None
    if len(body) > MAX_TERMS_BYTES:
        raise ReviewError(f"The terms page is larger than expected: {url}")
    return body


class Database:
    def __init__(self, url: str, service_key: str):
        self.base = url.rstrip("/") + "/rest/v1/"
        self.headers = {"apikey": service_key, "Authorization": f"Bearer {service_key}",
                        "Content-Type": "application/json", "User-Agent": USER_AGENT}

    def call(self, method: str, path: str, body: dict | None = None):
        outgoing = request.Request(self.base + path, method=method, headers=self.headers,
                                   data=json.dumps(body).encode() if body is not None else None)
        try:
            with request.urlopen(outgoing, timeout=30) as response:
                return json.loads(response.read(1024 * 1024) or b"null")
        except error.HTTPError as exc:
            detail = exc.read(2048).decode("utf-8", "replace")
            code = re.search(r"NR:([A-Z_]+)", detail)
            hint = {"INVALID_SCOPE": "the reviewer must be a confirmed account of this deployment",
                    "FORBIDDEN": "the service role key was not accepted"}.get(code.group(1) if code else "", "")
            raise ReviewError(f"The database refused the request (HTTP {exc.code}"
                              f"{', ' + code.group(1) if code else ''}){': ' + hint if hint else ''}.") from None
        except (error.URLError, TimeoutError, OSError, ValueError) as exc:
            raise ReviewError(f"The database could not be reached ({type(exc).__name__}).") from None


def status(database: Database) -> tuple[list[dict], bool]:
    rows = database.call("POST", "rpc/nexus_provider_rights_status", {}) or []
    healthy = len(rows) >= len(PROVIDERS) and all(row.get("current") and not row.get("renew_soon") for row in rows)
    return rows, healthy


def table(rows: list[dict]) -> str:
    lines = ["## Provider reviews", "", "| Provider | Usable now | Reviewed | Valid until |", "|---|---|---|---|"]
    for row in rows:
        usable = "yes" if row.get("current") else "**no**"
        if row.get("current") and row.get("renew_soon"):
            usable = "yes, **renew within 30 days**"
        lines.append(f"| `{row.get('provider')}` | {usable} | {str(row.get('terms_checked_at') or 'never')[:10]} "
                     f"| {str(row.get('valid_until') or '—')[:10]} |")
    return "\n".join(lines) + "\n"


def record(database: Database, reviewer_email: str) -> list[dict]:
    listing = database.call("GET", "provider_registry?select=id,terms_url&id=in.(" + ",".join(PROVIDERS) + ")") or []
    urls = {row["id"]: row["terms_url"] for row in listing}
    missing = [provider for provider in PROVIDERS if provider not in urls]
    if missing:
        raise ReviewError(f"The database has no provider record for: {', '.join(missing)}. Apply the migrations first.")
    # Read every page before recording anything, so a failed download leaves the records untouched.
    reviewed = []
    for provider in PROVIDERS:
        body = fetch_terms(urls[provider])
        fingerprint, length = terms_fingerprint(body)
        reviewed.append((provider, urls[provider], fingerprint, length))
    results = []
    for provider, url, fingerprint, length in reviewed:
        results.append(database.call("POST", "rpc/nexus_record_provider_review", {
            "p_provider": provider, "p_reviewer_email": reviewer_email, "p_terms_url": url, "p_content_hash": fingerprint,
            "p_terms": {"url": url, "fingerprint": "sha256 of the page's visible text, whitespace collapsed",
                        "text_characters": length, "read_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                        "host": parse.urlparse(url).hostname},
        }))
    return results


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("command", choices=["status", "record"])
    parser.add_argument("--reviewer-email", help="confirmed account that read the terms")
    parser.add_argument("--i-have-read-the-terms", action="store_true",
                        help="required for record: you have read each provider's current terms")
    args = parser.parse_args(argv)
    url, key = os.environ.get("SUPABASE_URL", "").strip(), os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    if not url or not key:
        print("::error::SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.", file=sys.stderr)
        return 2
    database = Database(url, key)
    try:
        if args.command == "record":
            if not args.reviewer_email or not args.i_have_read_the_terms:
                raise ReviewError("record needs --reviewer-email and --i-have-read-the-terms.")
            for result in record(database, args.reviewer_email):
                changed = "new terms: workspace owners will be asked to approve again" if result.get("terms_changed") else "terms unchanged"
                print(f"recorded {result.get('provider')}: revision {result.get('revision')}, {changed}")
        rows, healthy = status(database)
    except ReviewError as exc:
        print(f"::error::{exc}", file=sys.stderr)
        return 1
    text = table(rows)
    print(text)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with Path(os.environ["GITHUB_STEP_SUMMARY"]).open("a", encoding="utf-8") as handle:
            handle.write(text + "\n")
    if not healthy:
        print("::error::A provider review is missing or about to lapse. Read the terms, then run "
              "`python3 scripts/provider_review.py record`.", file=sys.stderr)
    return 0 if healthy else 1


if __name__ == "__main__":
    sys.exit(main())
