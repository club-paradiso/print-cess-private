import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./test/e2e",
  timeout: 180_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["line"], ["html", { open: "never" }]] : "line",
  use: {
    baseURL: "http://127.0.0.1:3000",
    screenshot: "off",
    trace: "off",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "iphone", grep: /@viewport/u, use: { ...devices["iPhone 15"] } },
    { name: "android", grep: /@viewport/u, use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: "pnpm dev",
    env: {
      ...process.env,
      PRINT_CESS_ADAPTER_MODE: "local",
      ENABLE_BROWSER_KIOSK: "true",
      ENABLE_DEMO_ROUTES: "false",
      PUBLIC_BASE_URL: "http://127.0.0.1:3000",
      ALLOWED_ORIGINS: "http://127.0.0.1:3000",
      ADMIN_DIAGNOSTICS_SECRET: "print-cess-e2e-admin-only",
    },
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    url: "http://127.0.0.1:3000",
  },
});
