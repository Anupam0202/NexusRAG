import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./src/e2e",
  timeout: 30_000,
  use: {
    baseURL: process.env.E2E_BASE_URL || "http://localhost:3002",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-chrome",
      use: { ...devices["Pixel 7"] },
    },
  ],
});
