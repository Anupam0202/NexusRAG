import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const lock = JSON.parse(await readFile(resolve(root, "frontend/package-lock.json"), "utf8"));
const pyproject = await readFile(resolve(root, "backend/pyproject.toml"), "utf8");
const outputDir = resolve(root, "artifacts");
await mkdir(outputDir, { recursive: true });

const normalizeLicense = (value) => {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (value && typeof value.type === "string") return value.type.trim();
  return "UNKNOWN";
};

const npmComponents = Object.entries(lock.packages ?? {})
  .filter(([path, value]) => path && path.includes("node_modules/") && value?.version)
  .map(([path, value]) => {
    const name = value.name || path.slice(path.lastIndexOf("node_modules/") + 13);
    const license = normalizeLicense(value.license);
    return {
      type: "library",
      name,
      version: String(value.version),
      scope: value.dev ? "optional" : "required",
      purl: `pkg:npm/${encodeURIComponent(name)}@${encodeURIComponent(String(value.version))}`,
      licenses: license === "UNKNOWN" ? [] : [{ license: { id: license } }],
      properties: [
        { name: "nexusrag:ecosystem", value: "npm" },
        { name: "nexusrag:license", value: license },
      ],
    };
  });

const dependencyBlock = pyproject.match(/\ndependencies\s*=\s*\[([\s\S]*?)\n\]/)?.[1] ?? "";
const pythonComponents = [...dependencyBlock.matchAll(/"([^"\n]+)"/g)].map((match) => {
  const declaration = match[1];
  const name = declaration.split(/[<>=!~\[]/, 1)[0].trim();
  const versionRange = declaration.slice(name.length).trim() || "unspecified";
  return {
    type: "library",
    name,
    version: versionRange,
    purl: `pkg:pypi/${encodeURIComponent(name.toLowerCase())}`,
    licenses: [],
    properties: [
      { name: "nexusrag:ecosystem", value: "pypi" },
      { name: "nexusrag:declaration", value: declaration },
      { name: "nexusrag:license", value: "UNKNOWN" },
    ],
  };
});

const components = [...npmComponents, ...pythonComponents].sort((a, b) =>
  `${a.purl}:${a.version}`.localeCompare(`${b.purl}:${b.version}`),
);
const sourceDigest = createHash("sha256")
  .update(JSON.stringify(components))
  .digest("hex");
const serial = `urn:uuid:${randomUUID()}`;
const bom = {
  bomFormat: "CycloneDX",
  specVersion: "1.6",
  serialNumber: serial,
  version: 1,
  metadata: {
    timestamp: new Date().toISOString(),
    tools: { components: [{ type: "application", name: "nexusrag-supply-chain-generator", version: "1" }] },
    component: {
      type: "application",
      name: "NexusRAG Evidence Intelligence OS",
      version: "v6-foundations",
      properties: [{ name: "nexusrag:source-component-sha256", value: sourceDigest }],
    },
  },
  components,
};

const forbiddenPatterns = [/\bAGPL-3\.0\b/i, /\bSSPL-1\.0\b/i, /\bBUSL-1\.1\b/i];
const licenses = components.map((component) => ({
  ecosystem: component.properties.find((item) => item.name === "nexusrag:ecosystem")?.value,
  name: component.name,
  version: component.version,
  license: component.properties.find((item) => item.name === "nexusrag:license")?.value ?? "UNKNOWN",
}));
const forbidden = licenses.filter((item) => forbiddenPatterns.some((pattern) => pattern.test(item.license)));
const licenseInventory = {
  schema_version: 1,
  status: forbidden.length ? "BLOCKED" : "REVIEW_REQUIRED",
  generated_at: bom.metadata.timestamp,
  component_count: licenses.length,
  known_license_count: licenses.filter((item) => item.license !== "UNKNOWN").length,
  unknown_license_count: licenses.filter((item) => item.license === "UNKNOWN").length,
  forbidden,
  entries: licenses,
  caveat: "Declared Python dependencies require resolved-environment licence enrichment before release.",
};

await writeFile(resolve(outputDir, "nexusrag.cdx.json"), `${JSON.stringify(bom, null, 2)}\n`);
await writeFile(resolve(outputDir, "license-inventory.json"), `${JSON.stringify(licenseInventory, null, 2)}\n`);
console.log(`components=${components.length} known_licenses=${licenseInventory.known_license_count} unknown_licenses=${licenseInventory.unknown_license_count}`);
if (forbidden.length) {
  console.error(`forbidden_licenses=${forbidden.map((item) => `${item.name}:${item.license}`).join(",")}`);
  process.exit(1);
}
