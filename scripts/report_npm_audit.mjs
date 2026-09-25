#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const escapeAnnotation = (value) => String(value)
  .replaceAll('%', '%25')
  .replaceAll('\r', '%0D')
  .replaceAll('\n', '%0A')
  .replaceAll(':', '%3A')
  .replaceAll(',', '%2C');

const path = process.argv[2];
if (!path) {
  console.error('::error title=npm audit report::Missing audit JSON path');
  process.exit(2);
}

let report;
try {
  report = JSON.parse(readFileSync(path, 'utf8'));
} catch (error) {
  console.error(`::error title=npm audit report::${escapeAnnotation(error.message)}`);
  process.exit(2);
}

const vulnerabilities = Object.values(report.vulnerabilities ?? {});
const actionable = vulnerabilities
  .filter((item) => ['high', 'critical'].includes(item.severity))
  .sort((left, right) => left.name.localeCompare(right.name));

for (const item of actionable) {
  const advisory = (item.via ?? []).find((entry) => typeof entry === 'object') ?? {};
  const url = advisory.url ? ` ${advisory.url}` : '';
  const direct = item.isDirect ? 'direct' : 'transitive';
  const fix = item.fixAvailable === false ? 'no automatic fix' : 'fix available';
  const message = `${item.name} ${item.severity} ${direct}; range ${item.range}; ${fix}.${url}`;
  console.error(`::error title=npm audit ${escapeAnnotation(item.name)}::${escapeAnnotation(message)}`);
}

const counts = report.metadata?.vulnerabilities ?? {};
console.log(`npm audit counts: critical=${counts.critical ?? 0} high=${counts.high ?? 0} moderate=${counts.moderate ?? 0} low=${counts.low ?? 0}`);
if (actionable.length === 0 && !report.metadata) {
  console.error('::error title=npm audit report::Audit response did not contain vulnerability metadata');
  process.exit(2);
}
