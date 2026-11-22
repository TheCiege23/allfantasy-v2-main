import type { BrowserContext } from '@playwright/test'

/**
 * Answer the browser's Content-Security-Policy reports in the browser, so they never reach `next dev`.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 *
 * `next dev` evaluates every module with eval, and the Report-Only policy middleware sends
 * (lib/security/cspReportOnly.ts) reports each one to /api/security/csp-report. One draft-room
 * harness load sent 985 of them, measured 2026-10-29. In dev they report webpack's evals, not a
 * policy hit; the policy is measured in production.
 *
 * They are not free for the server. `next dev` rescans the whole app directory (2,783 files) on
 * every request it routes (DevRouteMatcherManager.matchAll), so each report cost ~1s of CPU and
 * ~20MB of heap. 200 of them took the server from 3.2GB to 7.3GB, and a local run of the Draft Room
 * Regression click audit, with CI's flags, reached 12.7GB. By then the `/` readiness probe in
 * gotoDraftRoomHarness timed out at 120s and pages sat on "Loading draft harness…". Those are the
 * timeouts the lane reported, and no test was slow.
 *
 * Context-level, so every page in the test is covered, including ones a click opens.
 */
export async function answerCspReportsInBrowser(context: BrowserContext): Promise<void> {
  await context.route('**/api/security/csp-report', async (route) => {
    await route.fulfill({ status: 204, body: '' }).catch(() => null)
  })
}
