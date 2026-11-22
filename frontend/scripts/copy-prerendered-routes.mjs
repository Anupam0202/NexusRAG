import { copyFile, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Pages are served by the Worker (OpenNext renders clean URLs), which gives each one its policy
// (src/lib/security-headers.ts). The only page published as a static asset is the document shell, which the Worker
// itself fetches for every /documents/<id> link. Any other HTML among the assets would be served without the Worker,
// and so without its policy, at a URL ending in .html; the build fails instead.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appOutput = path.join(root, ".next", "server", "app");
const staticAssets = path.join(root, ".open-next", "assets");
const documentShell = "documents/__static_document__.html";
// Pages that must stay prerendered: they may not depend on request data.
const requiredPrerendered = [
  "index.html",
  "auth/login.html",
  "auth/callback.html",
  "auth/signup.html",
  "auth/confirm.html",
  "auth/forgot-password.html",
  "auth/update-password.html",
  "chat.html",
  "documents.html",
  "evidence-os.html",
  "findings.html",
  "radar.html",
  "settings/billing-or-usage.html",
  documentShell,
];

async function walk(directory, prefix = "") {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = path.join(prefix, entry.name);
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(absolute, relative)));
    } else if (entry.isFile() && entry.name.endsWith(".html")) {
      files.push(relative.split(path.sep).join("/"));
    }
  }
  return files;
}

const prerendered = new Set(await walk(appOutput));
const missing = requiredPrerendered.filter((page) => !prerendered.has(page));
if (missing.length) {
  throw new Error(`These pages were not prerendered: ${missing.join(", ")}`);
}

const destination = path.join(staticAssets, documentShell);
await mkdir(path.dirname(destination), { recursive: true });
await copyFile(path.join(appOutput, documentShell), destination);

// The Worker answers prerendered pages from these copies (open-next.config.ts) instead of rendering them again on
// every request, which ran past the Workers Free plan's CPU limit under load (issue #45). Only the Worker can read
// cdn-cgi/ assets.
async function cachedPages(directory) {
  const pages = [];
  for (const entry of await readdir(directory, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".cache")) continue;
    const relative = path.relative(directory, path.join(entry.parentPath, entry.name)).split(path.sep).join("/");
    const page = relative.match(/^[^/]+\/route-cache\/APP_PAGE\/[0-9a-f]+\/\$\/(.+)\.cache$/)?.[1];
    if (page) pages.push(`${page}.html`);
  }
  return new Set(pages);
}
const cacheDirectory = path.join(staticAssets, "cdn-cgi", "_next_cache");
const cached = await cachedPages(cacheDirectory).catch(() => new Set());
const uncached = requiredPrerendered.filter((page) => !cached.has(page));
if (uncached.length) {
  throw new Error(`These prerendered pages would be rendered again on every request: ${uncached.join(", ")}`);
}

const published = await walk(staticAssets);
const unexpected = published.filter((page) => page !== documentShell);
if (unexpected.length) {
  throw new Error(`These pages would be served without the Worker's policy: ${unexpected.join(", ")}`);
}

console.log(
  `Verified ${requiredPrerendered.length} prerendered pages; published the document shell as the only static page.`
);
