import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright E2E configuration for Totus.
 *
 * When running locally: starts the dev server on :3000.
 * When running in CI: uses PLAYWRIGHT_BASE_URL (Vercel preview URL).
 *
 * Auth strategy: mock auth mode (NEXT_PUBLIC_USE_MOCK_AUTH=true).
 * A setup project signs in once and saves storageState for all tests.
 */
export default defineConfig({
  testDir: "./e2e",
  outputDir: "./test-results",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "blob" : "html",
  timeout: 30_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    ...(process.env.VERCEL_AUTOMATION_BYPASS_SECRET && {
      extraHTTPHeaders: {
        "x-vercel-protection-bypass":
          process.env.VERCEL_AUTOMATION_BYPASS_SECRET,
      },
    }),
  },

  projects: [
    // Auth setup — signs in and saves session state
    { name: "setup", testMatch: /global-setup\.ts/, teardown: "cleanup" },
    { name: "cleanup", testMatch: /global-teardown\.ts/ },

    // Main test suite — reuses auth state from setup
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        storageState: "e2e/.auth/user.json",
      },
      dependencies: ["setup"],
    },
  ],

  // Local dev server — skipped when PLAYWRIGHT_BASE_URL is set (CI)
  ...(!process.env.PLAYWRIGHT_BASE_URL && {
    webServer: {
      command: "bun run dev",
      url: "http://localhost:3000",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  }),
});
