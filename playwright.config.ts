import { defineConfig, devices } from '@playwright/test';

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
// import dotenv from 'dotenv';
// import path from 'path';
// dotenv.config({ path: path.resolve(__dirname, '.env') });

/**
 * See https://playwright.dev/docs/test-configuration.
 */
const PLAYWRIGHT_PORT = Number(process.env.PLAYWRIGHT_PORT ?? process.env.PORT ?? 3101);
const PLAYWRIGHT_BASE_URL =
  process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${PLAYWRIGHT_PORT}`;
const PLAYWRIGHT_DIST_DIR =
  process.env.AF_NEXT_DIST_DIR ?? process.env.PLAYWRIGHT_DIST_DIR ?? `.next-playwright-${PLAYWRIGHT_PORT}`;

export default defineConfig({
  testDir: './e2e',
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Opt out of parallel tests on CI. */
  workers: process.env.CI ? 1 : undefined,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: 'html',
  /* Screenshot snapshot directory — committed baselines live here. */
  snapshotDir: './e2e/__snapshots__',

  /*
   * ⚠ THE DEFAULT 30s TEST TIMEOUT IS SHORTER THAN ONE COLD ROUTE COMPILE.
   *
   * The suite runs against `next dev`, which compiles a route the first time it
   * is requested. Measured on /pricing from a clean dist dir: 32.5s to
   * domContentLoaded. Playwright's default per-test timeout is 30s, so a test
   * that is the first to touch a route loses the race before its first
   * assertion runs — and when the test times out Playwright aborts the
   * in-flight navigation, which surfaces as `page.goto: net::ERR_ABORTED` or
   * `ERR_CONNECTION_RESET`. Both appear throughout the core-shard logs and read
   * as the server having crashed, which it had not.
   *
   * Specs that set their own describe-level timeout keep it; this only raises
   * the floor for the ones that never did.
   *
   * ⚠ 60s, NOT 90s, AND THE FIRST ATTEMPT AT 90s COST MORE THAN IT SAVED.
   * Measured across two CI runs: raising the floor let genuinely-broken tests
   * run to the new ceiling instead of failing fast, and `retries: 2` means every
   * one of them pays it three times. Six timeouts at 90s x 3 attempts is 27
   * minutes of pure waiting where 30s would have been 9 — and total wall time
   * went from 96.6m to 113.6m between those runs even though failures fell.
   *
   * 60s still clears a cold compile (the worst measured was /pricing at 32.5s,
   * and globalSetup now precompiles the 33 busiest routes anyway), while
   * costing a third less on every test that is simply broken. The floor exists
   * for tests losing a compile race, not to give broken ones more room.
   */
  timeout: 60_000,

  /*
   * Compile the busiest routes once, before any test is on the clock. Without
   * this the first test to reach each route pays its compile inside its own
   * timeout, which is both the flake above and a large part of why the core
   * shards run over an hour.
   */
  globalSetup: './e2e/global-setup.ts',

  /* Visual-diff threshold applied to all toHaveScreenshot() calls in this config. */
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.02,
      animations: 'disabled',
    },
  },

  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('')`. */
    baseURL: PLAYWRIGHT_BASE_URL,

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },

    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },

    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },

    /* Test against mobile viewports. */
    // {
    //   name: 'Mobile Chrome',
    //   use: { ...devices['Pixel 5'] },
    // },
    // {
    //   name: 'Mobile Safari',
    //   use: { ...devices['iPhone 12'] },
    // },

    /* Test against branded browsers. */
    // {
    //   name: 'Microsoft Edge',
    //   use: { ...devices['Desktop Edge'], channel: 'msedge' },
    // },
    // {
    //   name: 'Google Chrome',
    //   use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    // },
  ],

  /* Run local dev server before tests (or reuse if already running). */
  webServer: {
    command:
      process.env.PLAYWRIGHT_DEV_COMMAND ??
      `node scripts/playwright-dev-server.cjs --port ${PLAYWRIGHT_PORT}`,
    url: `${PLAYWRIGHT_BASE_URL}/api/auth/csrf`,
    reuseExistingServer: true,
    /**
     * Cold-starting `next dev` on this app does not fit in 120s.
     *
     * The dev server must run scripts/clean-next-dev.cjs, boot Next, and compile
     * `/api/auth/csrf` (the readiness URL) before Playwright will proceed. When
     * that overran, the whole run aborted with "Timed out waiting 120000ms from
     * config.webServer" and ZERO specs executed — which reads as a suite-wide
     * failure rather than as a server that was still starting.
     */
    timeout: 300_000,
    env: {
      ...process.env,
      PORT: String(PLAYWRIGHT_PORT),
      AF_NEXT_DIST_DIR: PLAYWRIGHT_DIST_DIR,
      DATABASE_URL:
        process.env.DATABASE_URL ??
        process.env.POSTGRES_PRISMA_URL ??
        process.env.POSTGRES_URL ??
        process.env.DIRECT_URL ??
        process.env.POSTGRES_URL_NON_POOLING ??
        '',
      PLAYWRIGHT_E2E: '1',
    },
  },
});
