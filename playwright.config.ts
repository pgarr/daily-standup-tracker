import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  projects: [
    // API-only project — no browser needed for request-context tests.
    // Add a chromium project in Phase 4 when browser-driven tests are introduced.
    { name: "api", use: {} },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:4321",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    // No SUPABASE_* env vars: createClient() returns null when vars are absent,
    // context.locals.user = null, protected routes redirect correctly.
    // Providing a fake URL would trigger a real (failing) network call to Supabase.
  },
  use: {
    baseURL: "http://localhost:4321",
  },
});
