import { copyFile, mkdir, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appOutput = path.join(root, ".next", "server", "app");
const staticAssets = path.join(root, ".open-next", "assets");
const requiredAssets = [
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
  "settings/billing-or-usage.html",
  "documents/__static_document__.html",
];

async function walk(directory, prefix = "") {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = path.join(prefix, entry.name);
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(absolute, relative)));
    } else if (entry.isFile() && entry.name.endsWith(".html")) {
      files.push(relative);
    }
  }
  return files;
}

const generatedHtml = await walk(appOutput);
const copied = new Set();
for (const relative of generatedHtml) {
  const destinationRelative =
    relative === "_not-found.html" ? "404.html" : relative;
  const destination = path.join(staticAssets, destinationRelative);
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(path.join(appOutput, relative), destination);
  copied.add(destinationRelative.split(path.sep).join("/"));
}

for (const required of requiredAssets) {
  const candidate = path.join(staticAssets, required);
  let exists = false;
  try {
    exists = (await stat(candidate)).isFile();
  } catch {
    // Report a build failure below rather than deploying an SSR fallback.
  }
  if (!exists) {
    throw new Error(`Required static route asset was not generated: ${required}`);
  }
}

console.log(
  `Published ${copied.size} pre-rendered HTML routes as Workers Static Assets; required routes verified.`
);