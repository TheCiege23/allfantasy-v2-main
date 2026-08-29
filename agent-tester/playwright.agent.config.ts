/**
 * Playwright config for the agent tester.
 *
 * Deliberately SEPARATE from the root playwright.config.ts, for three reasons:
 *
 *   1. No webServer. The root config boots `next dev` locally; this suite runs
 *      against an already-deployed staging URL and must never start a server.
 *   2. Its own testDir, so `npx playwright test` at the root does not sweep
 *      these up and run exploratory write traffic as part of the normal suite.
 *   3. Different economics. Agent runs are long and few; retries and parallelism
 *      that make sense for 90 click-audits are wrong here.
 *
 * Run it explicitly:
 *   npm run test:agent
 */

import { defineConfig, devices } from "@playwright/test"

const BASE_URL =
  process.env.AGENT_TESTER_BASE_URL ?? process.env.BASE_URL ?? ""

export default defineConfig({
  testDir: "./missions",

  /*
   * Serial by default. These personas create accounts and leagues; running them
   * in parallel against one staging DB produces interference that reads as app
   * bugs and is not. Opt into parallelism explicitly if your staging can take it.
   */
  fullyParallel: false,
  workers: Number(process.env.AGENT_TESTER_WORKERS ?? 1),

  /*
   * No retries. A retry on an exploratory agent does not reproduce the previous
   * run — the agent makes different choices — so a "flaky" pass tells you
   * nothing and costs a full run. Investigate the report instead.
   */
  retries: 0,

  /*
   * Generous. A mission is dozens of interactions, each with deliberate human
   * pacing, plus optional idle periods for the interrupted-user persona.
   */
  timeout: Number(process.env.AGENT_TESTER_TIMEOUT_MS ?? 15 * 60_000),

  globalSetup: "./global-setup.ts",

  reporter: [
    ["list"],
    ["html", { outputFolder: "agent-tester/reports/playwright", open: "never" }],
  ],

  use: {
    baseURL: BASE_URL,

    /*
     * Always on, unlike the root config's on-first-retry. With no retries, a
     * trace captured after the fact is impossible — and the trace is the
     * artifact that makes an agent finding reproducible.
     */
    trace: "on",
    video: "retain-on-failure",
    screenshot: "only-on-failure",

    /* Staging preview deploys sometimes carry self-signed or preview certs. */
    ignoreHTTPSErrors: true,
  },

  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile",
      use: { ...devices["Pixel 5"] },
    },
  ],
})
