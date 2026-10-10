// @vitest-environment node
import { ESLint } from "eslint";
import { expect, it } from "vitest";

it("excludes generated Wrangler bundles without excluding maintained Worker and UI source", async () => {
  const eslint = new ESLint({ cwd: process.cwd() });
  expect(await eslint.isPathIgnored(".wrangler/tmp/bundle-regression/worker.js")).toBe(true);
  expect(await eslint.isPathIgnored("worker.js")).toBe(false);
  expect(await eslint.isPathIgnored("src/components/chat/MessageBubble.tsx")).toBe(false);
});