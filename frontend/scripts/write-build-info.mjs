// Only non-secret reviewed source identity is emitted into the public asset bundle.
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { siteOrigin } from "./write-page-policy.mjs";

/**
 * The public build identity: the reviewed commit and, when the build has one, the address it was made for. The
 * front door (apps/front-door) reads `site_url` to decide whether it serves this build or sends visitors to it.
 */
export function buildInfo(env) {
  const sha = env.SOURCE_COMMIT;
  if (!/^[a-f0-9]{40}$/.test(sha || "")) throw new Error("SOURCE_COMMIT must be a full reviewed commit SHA.");
  const site = siteOrigin(env);
  return { source_commit: sha, format: "nexusrag-build/1", ...(site ? { site_url: site } : {}) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = fileURLToPath(new URL("../public/", import.meta.url));
  mkdirSync(root, { recursive: true });
  writeFileSync(`${root}_nexus-build.json`, JSON.stringify(buildInfo(process.env)) + "\n");
}
