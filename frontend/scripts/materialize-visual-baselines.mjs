// Materialize committed, platform-neutral baselines for exact-head CI.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const source = join(root, "..", "src", "e2e", "baselines");
const destination = join(
  root,
  "..",
  "src",
  "e2e",
  "visual-regression.spec.ts-snapshots"
);

const names = [
  "home-chromium-linux.png",
  "evidence-os-chromium-linux.png",
  "home-mobile-chrome-linux.png",
  "evidence-os-mobile-chrome-linux.png",
];

await mkdir(destination, { recursive: true });
for (const name of names) {
  const encoded = await readFile(join(source, `${name}.b64`), "utf8");
  const bytes = Buffer.from(encoded.replace(/\s+/g, ""), "base64");
  if (bytes.subarray(1, 4).toString("ascii") !== "PNG") {
    throw new Error(`Invalid PNG baseline: ${name}`);
  }
  await writeFile(join(destination, name), bytes);
}

console.log(`Materialized ${names.length} visual baselines.`);