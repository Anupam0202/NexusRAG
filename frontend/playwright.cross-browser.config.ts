import { defineConfig, devices } from "@playwright/test";
import baseline from "./playwright.config";

// Functional public coverage uses real engines. Chromium-only screenshots are
// not reused as Firefox/WebKit image baselines or claimed as authenticated QA.
export default defineConfig({
  ...baseline,
  testMatch: "**/public-smoke.spec.ts",
  projects: [
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
    { name: "mobile-webkit", use: { ...devices["iPhone 13"] } },
  ],
});
