import type { FullConfig } from '@playwright/test'

/**
 * Warm the dev server's route compiler before any test starts its clock.
 *
 * ── WHY ──────────────────────────────────────────────────────────────────────
 *
 * The suite runs against `next dev`, which compiles each route on its first
 * request. Measured from a clean dist dir, /pricing took 32.5s to reach
 * domContentLoaded. Every one of those seconds is currently charged to whichever
 * test happens to touch the route first, inside that test's own timeout — so a
 * route's first visitor can fail purely for being first, and when it times out
 * Playwright aborts the in-flight navigation and the log fills with
 * `net::ERR_ABORTED` and `ERR_CONNECTION_RESET` that look like server crashes.
 *
 * Paying those compiles here instead makes the cost visible in one place, once,
 * and off the clock. It is also most of why the core shards run over an hour:
 * the same compile is paid inside a timed test on every shard.
 *
 * ── DELIBERATELY BOUNDED AND FAIL-SOFT ───────────────────────────────────────
 *
 * Warming is an optimisation, never a gate. A route that 404s, 500s, redirects
 * to /login or times out is ignored: the point is only to have webpack compile
 * it. If the whole warm-up fails, the suite runs exactly as it does today, just
 * slower. Global setup must never be the reason a shard goes red.
 */

/*
 * ⚠ DERIVED FROM WHAT THE SUITE ACTUALLY VISITS, NOT GUESSED. Counted from
 * `page.goto(...)` across e2e/*.spec.ts — the suite touches 110 distinct static
 * routes, and this is the head of that distribution plus the handful the
 * checkout and SEO-landing flows navigate INTO (which never appear in a goto
 * because a click gets there). Comments are the goto count.
 *
 * The tail is deliberately not warmed. Compiling all 110 would cost more up
 * front than it saves, and a route visited once still gets 90s of test timeout
 * to compile in.
 */
const WARM_ROUTES = [
  '/',
  '/settings', // 47
  '/e2e/draft-room', // 15
  '/league', // 15
  '/dashboard', // 10
  '/admin', // 7
  '/e2e/dashboard-soccer-grouping', // 7
  '/tools-hub', // 7
  '/pricing', // 6
  '/e2e/subscription-entitlement', // 5
  '/messages', // 5
  '/e2e/mock-draft-room', // 4
  '/e2e/monetization-in-context', // 4
  '/e2e/post-purchase-sync', // 4
  '/tokens', // 4
  '/af-legacy', // 3
  '/create-league', // 3
  '/e2e/admin-dashboard', // 3
  '/e2e/commissioner', // 3
  '/e2e/matchups', // 3
  '/tools/trade-analyzer', // 2
  '/trade-evaluator', // 2
  '/login',
  '/signup',
  '/players',
  '/trade-analyzer',
  /*
   * Reached by CLICK rather than goto, so they never show up in the counts —
   * and each one is a destination an assertion waits 20s for. /install is the
   * case that proved it: the click fired, the route was compiling, and
   * `toHaveURL(/\/install$/)` timed out while the browser was still on the
   * page it started from.
   */
  '/install',
  '/sports/fantasy-football',
  '/bracket',
  '/upgrade',
  '/pro',
  '/all-access',
  '/commissioner-upgrade',
]

/** Generous: this is a cold webpack compile, not a request against a warm app. */
const PER_ROUTE_TIMEOUT_MS = 120_000

/** Compiles run on one dev server; flooding it makes every route slower. */
const CONCURRENCY = 4

async function warm(baseURL: string, path: string): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PER_ROUTE_TIMEOUT_MS)
  const started = Date.now()
  try {
    const res = await fetch(`${baseURL}${path}`, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'user-agent': 'playwright-global-setup-warmup' },
    })
    // Body must be drained, or the compile can still be streaming when we move on.
    await res.text().catch(() => '')
    return `${path} ${res.status} ${Date.now() - started}ms`
  } catch (err) {
    return `${path} skipped (${(err as Error).name}) ${Date.now() - started}ms`
  } finally {
    clearTimeout(timer)
  }
}

export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL =
    config.projects[0]?.use?.baseURL ??
    process.env.PLAYWRIGHT_BASE_URL ??
    `http://127.0.0.1:${process.env.PLAYWRIGHT_PORT ?? process.env.PORT ?? 3101}`

  const started = Date.now()
  const queue = [...WARM_ROUTES]
  const results: string[] = []

  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    for (;;) {
      const path = queue.shift()
      if (!path) return
      results.push(await warm(String(baseURL), path))
    }
  })

  try {
    await Promise.all(workers)
    // eslint-disable-next-line no-console
    console.log(
      `[global-setup] warmed ${results.length} routes in ${Math.round((Date.now() - started) / 1000)}s\n  ` +
        results.join('\n  ')
    )
  } catch {
    // See the note above: warming never gates the run.
  }
}
