import {defineConfig,devices} from "@playwright/test";
export default defineConfig({testDir:"./src/e2e",testMatch:"obligation-evidence.spec.ts",workers:1,retries:0,
  use:{baseURL:process.env.E2E_BASE_URL||"http://127.0.0.1:3037",timezoneId:"UTC",trace:"retain-on-failure",actionTimeout:10_000},
  projects:[{name:"chromium",use:{...devices["Desktop Chrome"],launchOptions:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{}}}]});
