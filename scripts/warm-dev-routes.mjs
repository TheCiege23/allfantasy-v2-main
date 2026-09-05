#!/usr/bin/env node
/*
 * Warm a freshly started `next dev` ONE ROUTE AT A TIME.
 *
 * 🛑 THE FIRST HUMAN LOAD OF /core/trades CAN 500 WITH "more than one copy of React".
 * Observed 2026-09-05, 52 seconds to a blank error page, then fine on refresh:
 *
 *     Warning: Invalid hook call ... more than one copy of React
 *     ⨯ TypeError: Cannot read properties of null (reading 'useMemo')  at AfCoreShell.tsx:800
 *     GET /core/trades?league=...  500 in 52089ms
 *
 * ⚠ THE COMPONENT IS NOT AT FAULT AND THE STACK IS MISLEADING. `AfCoreShell` declares
 * 'use client', is imported once, exports both named and default, and there is exactly one
 * react/react-dom (18.3.1) in node_modules. All three real causes of that error are absent.
 *
 * THE ACTUAL MECHANISM is visible in the dev server's own compile log:
 *
 *     ○ Compiling /core/[[...screen]] ...
 *     ✓ Compiled /api/meta/events in 38.2s          <- a DIFFERENT route finishes
 *     ...  and `/core/[[...screen]]` NEVER reports a ✓
 *
 * The page begins compiling; its client bundle immediately fires ~15 API requests; each of
 * those routes starts its OWN compile; the page's compile is superseded before it finishes;
 * and the server renders against a half-built module graph, which is where the second copy
 * of React comes from. Verified by positive control — every other route in that same log DOES
 * report a completed compile, so "never completed" is an observation rather than a gap.
 *
 * ⚠ DEV ONLY. `next build` compiles every route ahead of time, so the race cannot occur.
 * Confirmed rather than assumed: production `/core/trades` answers HTTP 200.
 *
 * So this does not patch anything — it removes the CONCURRENCY. Hitting the routes in series,
 * before a human arrives, means each compile finishes alone.
 */

const BASE = process.env.WARM_BASE_URL || 'http://localhost:3000'

/*
 * ⚠ ORDER MATTERS AND SO DOES THE FACT THAT THIS IS A LIST, NOT A CRAWL. The page route goes
 * LAST, after the API routes its own bundle would otherwise trigger mid-compile. Warming them
 * in the order the browser happens to request them would reproduce the race this exists to
 * avoid.
 */
const ROUTES = [
  '/api/auth/session',
  '/api/geo/check',
  '/api/i18n/translations?lang=en',
  '/api/user/profile',
  '/api/user/time-context',
  '/api/auth/confirm-age',
  '/login',
  '/',
  '/core/trades',
]

/** Long: a cold route compile here has been measured at 66 seconds. */
const PER_ROUTE_TIMEOUT_MS = 180_000

async function warm(path) {
  const started = Date.now()
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), PER_ROUTE_TIMEOUT_MS)
  try {
    const r = await fetch(BASE + path, { signal: ctl.signal, redirect: 'manual' })
    const ms = Date.now() - started
    /*
     * ⚠ A 3xx IS A PASS. Every gated route answers 307 to an unauthenticated warm-up, and that
     * is the route COMPILING AND RUNNING — which is the whole point. Only a 5xx means the
     * compile produced something broken.
     */
    const bad = r.status >= 500
    console.log(`  ${bad ? 'FAIL' : ' ok '}  ${String(r.status).padEnd(3)} ${String(ms).padStart(6)}ms  ${path}`)
    return !bad
  } catch (e) {
    console.log(`  FAIL   ---  ${String(Date.now() - started).padStart(6)}ms  ${path}  (${e.name})`)
    return false
  } finally {
    clearTimeout(timer)
  }
}

const main = async () => {
  console.log(`warming ${BASE} — one route at a time, page route last`)
  let ok = true
  for (const path of ROUTES) {
    // Deliberately sequential. `Promise.all` here would rebuild the exact race.
    ok = (await warm(path)) && ok
  }
  console.log(ok ? '\nall routes compiled cleanly' : '\nsome routes returned 5xx — see above')
  process.exit(ok ? 0 : 1)
}

void main()
