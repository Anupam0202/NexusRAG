// @vitest-environment node
import { ESLint } from "eslint";
import { beforeAll, expect, it } from "vitest";

const eslint = new ESLint({ cwd: process.cwd() });

// Load the cold plugin/config graph in bounded setup, not the assertion budget.
beforeAll(async () => {
  await eslint.calculateConfigForFile("worker.js");
}, 120_000);

it("excludes generated Wrangler bundles without excluding maintained Worker and UI source", async () => {
  expect(await eslint.isPathIgnored(".wrangler/tmp/bundle-regression/worker.js")).toBe(true);
  expect(await eslint.isPathIgnored("worker.js")).toBe(false);
  expect(await eslint.isPathIgnored("src/components/chat/MessageBubble.tsx")).toBe(false);
});
