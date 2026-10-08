"""Summarize local Grype receipts; never manufacture an unavailable scan result."""
import argparse
from collections import Counter
import json
import os
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--report-dir', type=Path, default=Path('/tmp'))
args = parser.parse_args()
failed = False
lines = ["## Full image vulnerability receipts", ""]
for name in ("backend", "frontend"):
    path = args.report_dir / f"nexusrag-{name}-grype.json"
    if not path.is_file():
        lines.append(f"{name}: SCAN_RESULT_UNAVAILABLE (not a passed gate)")
        failed = True
        continue
    result = json.loads(path.read_text())
    findings = result.get("matches")
    if (not isinstance(findings, list) or not result.get("descriptor", {}).get("version")
            or result.get("descriptor", {}).get("name") != "grype"
            or result.get("source", {}).get("type") != "image"):
        raise SystemExit(f"Invalid {name} image vulnerability receipt")
    if result.get("ignoredMatches"):
        raise SystemExit(f"Suppressed {name} findings are not permitted")
    severity = Counter(item["vulnerability"]["severity"] for item in findings)
    if any(severity[key] for key in ('Medium', 'High', 'Critical', 'Unknown')):
        failed = True
    scanner = result["descriptor"]["version"]
    source = result.get("source", {})
    target = source.get("target", {})
    lines.append(f"{name}: Grype {scanner}; source type {source.get('type')}; target {target.get('imageID', target.get('userInput', 'UNKNOWN'))}")
    lines.append(f"Findings: {json.dumps(dict(sorted(severity.items())))}. Medium/high/critical fail the required job, including findings without an available fix. Lower severities remain visible for review.")
    # Compact complete receipt in job logs; bounded high-severity-first summary.
    # No vulnerability suppression: missing fix information remains explicit.
    for item in findings:
        print("IMAGE_FINDING", json.dumps({
            "image": name, "id": item["vulnerability"]["id"],
            "severity": item["vulnerability"]["severity"],
            "package": item["artifact"]["name"], "version": item["artifact"]["version"],
            "type": item["artifact"].get("type", "UNKNOWN"),
            "fix": item["vulnerability"].get("fix", {"state": "UNKNOWN"}),
            "locations": [value.get("path", "UNKNOWN") for value in item["artifact"].get("locations", [])],
        }, sort_keys=True))
    rank = {"Critical": 0, "High": 1, "Unknown": 2, "Medium": 3, "Low": 4, "Negligible": 5}
    prioritized = sorted(findings, key=lambda item: (rank.get(item["vulnerability"]["severity"], 2), item["artifact"]["name"], item["vulnerability"]["id"]))
    for item in prioritized[:20]:
        vulnerability = item['vulnerability']; package = item['artifact']
        lines.append(f"- {vulnerability['id']}: {package['name']} {package['version']} ({vulnerability['severity']})")
    if len(findings) > 20:
        lines.append(f"{len(findings)-20} additional findings remain in the complete IMAGE_FINDING job-log receipt and ephemeral local JSON; this summary is bounded, not a complete finding list.")
    lines.append("")
text = "\n".join(lines) + "\n"
print(text)
if os.environ.get('GITHUB_STEP_SUMMARY'):
    with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as stream:
        stream.write(text)

if failed:
    raise SystemExit("Image vulnerability acceptance failed or lacks required evidence")
