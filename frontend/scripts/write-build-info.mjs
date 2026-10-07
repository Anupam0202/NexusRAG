// Only non-secret reviewed source identity is emitted into the public asset bundle.
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
const sha = process.env.SOURCE_COMMIT;
if (!/^[a-f0-9]{40}$/.test(sha || "")) throw new Error("SOURCE_COMMIT must be a full reviewed commit SHA.");
const root = fileURLToPath(new URL("../public/", import.meta.url));
mkdirSync(root, { recursive: true });
writeFileSync(`${root}_nexus-build.json`, JSON.stringify({ source_commit: sha, format: "nexusrag-build/1" }) + "\n");
