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

/*
 * Specs that belong to the phone devices and to nothing else. See the projects
 * block below for why the split has to be explicit in BOTH directions.
 *
 * A RegExp rather than a glob because Playwright matches it against the full
 * file path, which is backslash-separated on Windows — `e2e/mobile/**` silently
 * matches nothing here, and a testMatch that matches nothing is a project that
 * runs zero tests and reports success.
 */
const MOBILE_SPECS = /[\\/]e2e[\\/]mobile[\\/].*\.spec\.ts$/;
const NBA_SURVIVOR_OPT_IN_SPEC = /[\\/]e2e[\\/]nba-survivor-authenticated-rehearsal\.spec\.ts$/;
const ZOMBIE_REHEARSAL_SPEC = /[\\/]e2e[\\/]zombie-(?:four-sport-native|provider-week)-rehearsal\.spec\.ts$/;
const DESKTOP_TEST_IGNORE = [
  MOBILE_SPECS,
  ...(process.env.AF_NBA_SURVIVOR_BROWSER_DB === '1' ? [] : [NBA_SURVIVOR_OPT_IN_SPEC]),
  ...(process.env.AF_ZOMBIE_REHEARSAL === '1' ? [] : [ZOMBIE_REHEARSAL_SPEC]),
];

/**
 * NODE_OPTIONS for the `next dev` web server: the runner's own, with any
 * `--conditions` / `-C` flag removed. `PLAYWRIGHT_SERVER_NODE_OPTIONS`, when
 * set, replaces it outright.
 *
 * Why the condition goes: isolated DB specs import services directly and need
 * `--conditions=react-server` in the RUNNER, but the same flag in Next dev
 * breaks react-dom/server in server components.
 *
 * 🛑 WHY EVERYTHING ELSE STAYS. This used to blank NODE_OPTIONS for the server
 * entirely (`PLAYWRIGHT_SERVER_NODE_OPTIONS ?? ''`), which also threw away the
 * `--max-old-space-size=8192` every CI lane sets for exactly this server (see
 * the notes in .github/workflows/playwright.yml). scripts/playwright-dev-server.cjs
 * then fell back to its 4096MB default, and next dev restarts itself once the
 * heap passes 0.8 x heap_size_limit ("Server is approaching the used memory
 * threshold, restarting..."). Measured on the Draft Room Regression lane: up to
 * three restarts per run at 4096MB. Each one refuses connections for a few
 * seconds (ChunkLoadError on a lazy draft-room chunk, a test failing on an
 * element that chunk renders) and throws away every route global setup warmed,
 * so the next lazy chunk took 15.6s to serve. The blanking landed 2026-10-15;
 * the lane had 1 failed job in 215 over Oct 11-14 and 31 in 270 over Oct 16-19.
 */
function serverNodeOptions(): string {
  const explicit = process.env.PLAYWRIGHT_SERVER_NODE_OPTIONS;
  if (explicit !== undefined) return explicit;
  const tokens = (process.env.NODE_OPTIONS ?? '').split(/\s+/).filter(Boolean);
  const kept: string[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token === '--conditions' || token === '-C') {
      i += 1; // the condition name is the next token
      continue;
    }
    if (token.startsWith('--conditions=') || token.startsWith('-C=')) continue;
    kept.push(token);
  }
  return kept.join(' ');
}

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

  /*
   * Configure projects for major browsers.
   *
   * 🛑 A PROJECT MULTIPLIES THE WHOLE `testDir`, SO THE MOBILE ONES ARE SCOPED.
   *
   * Playwright runs every spec under `testDir` in every project. There are 154
   * specs in `e2e/`, the core lane already takes 17-60 minutes per shard, and
   * parts of it are red — so uncommenting the two mobile projects as they
   * shipped (no `testMatch`) would have added 308 spec-runs to every command
   * that does not pin `--project`, on devices nothing was written for.
   *
   * ⚠ AND THE CI LANES WOULD NOT HAVE SHOWN IT. Every lane in
   * `.github/workflows/playwright.yml` pins `--project=chromium`, including the
   * one REQUIRED check (`Draft Room Regression` runs
   * `test:e2e:draft-room:chromium`). The cost would have landed on the UNPINNED
   * scripts — `test:e2e`, `test:e2e:db`, `test:e2e:draft-room`,
   * `test:e2e:click-audits` — which are what a human runs locally. Green CI, a
   * suite nobody can run.
   *
   * So the phone devices own `e2e/mobile/` and nothing else, and the desktop
   * projects ignore that directory: a spec asserting phone invariants has no
   * meaning at 1280px and would simply fail there.
   */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: DESKTOP_TEST_IGNORE,
    },

    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
      testIgnore: DESKTOP_TEST_IGNORE,
    },

    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
      testIgnore: DESKTOP_TEST_IGNORE,
    },

    /*
     * Test against mobile viewports.
     *
     * Pixel 5 and iPhone 12 are the audit's two target engines: Chromium and
     * WebKit at phone width. iPhone 12 is 390x844, which is the width the
     * landed `/core` repairs were measured at.
     */
    {
      name: 'Mobile Chrome',
      use: { ...devices['Pixel 5'] },
      testMatch: MOBILE_SPECS,
    },
    {
      name: 'Mobile Safari',
      use: { ...devices['iPhone 12'] },
      testMatch: MOBILE_SPECS,
    },

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
      // See serverNodeOptions() above: the runner's NODE_OPTIONS minus any
      // `--conditions` flag, so CI's heap size still reaches `next dev`.
      NODE_OPTIONS: serverNodeOptions(),
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
      /*
       * ⚠ PINNED PAST THE PAYWALL LAUNCH. The specs drive /core as users with no plan; from Oct 15
       * the depth paywall (lib/core-app/coreDepthAccess.ts) locks Trade Center, Player Finder,
       * Competitive Edge and Commissioner depth under them, and every spec touching those would
       * fail — or quietly pass against a lock card. Far future unless a run sets it on purpose.
       * A server started by hand and reused (`reuseExistingServer`) does not get this: start it
       * with the same variable.
       */
      AF_PAYWALL_STARTS_AT: process.env.AF_PAYWALL_STARTS_AT ?? '2099-01-01T00:00:00.000Z',
    },
  },
});
