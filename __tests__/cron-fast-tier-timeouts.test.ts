import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
// @ts-expect-error -- .mjs script, no types.
import { routeMaxDurationMs, timeoutForJob } from '../scripts/cron-fast-tier-loop.mjs'
// @ts-expect-error -- .mjs script, no types.
import { readVercelCrons, classifyCrons } from '../scripts/cron-tier.mjs'

/**
 * One global 180s timeout silently broke four jobs.
 *
 * The loop justified that value as "above the largest fast-tier maxDuration (120s on
 * live-score-tick and import-scores)" — two routes checked, twelve in the tier. FOUR declare
 * `maxDuration = 300`: fantasy-os-exec-sync, alert-sweep, draft-pool-prewarm, trade-grade-notify.
 * Each reported `timed out after 180000ms` while its handler was still working, and
 * draft-pool-prewarm looked permanently broken at 0-for-3 as a result.
 *
 * The budget is now read from each route's own source, so a second list cannot drift from the
 * routes the way that comment drifted.
 */

describe('routeMaxDurationMs', () => {
  const read = (src: string) => () => src

  it('reads a declared budget', () => {
    expect(routeMaxDurationMs('/api/cron/x', read('export const maxDuration = 300\n'))).toBe(300_000)
    expect(routeMaxDurationMs('/api/cron/x', read('export const maxDuration=60'))).toBe(60_000)
  })

  it('returns null when the route declares none', () => {
    // draft-tick declares nothing; it must not inherit some other route's budget.
    expect(routeMaxDurationMs('/api/cron/x', read('export const dynamic = "force-dynamic"'))).toBeNull()
  })

  it('returns null when there is no route file at all', () => {
    expect(
      routeMaxDurationMs('/api/cron/missing', () => {
        throw new Error('ENOENT')
      }),
    ).toBeNull()
  })

  it('ignores a query string, which vercel.json paths carry', () => {
    let asked = ''
    routeMaxDurationMs('/api/cron/sync?job=teams', (p: string) => {
      asked = p
      return 'export const maxDuration = 120'
    })
    expect(asked).toBe('app/api/cron/sync/route.ts')
  })
})

describe('timeoutForJob', () => {
  it('always exceeds the route budget, so the route answers before we give up', () => {
    // The whole defect: a client timeout at or below the server budget reports a failure over
    // work that then completes.
    for (const s of [60, 120, 300]) {
      expect(timeoutForJob(s * 1000)).toBeGreaterThan(s * 1000)
    }
  })

  it('gives the 300s routes enough room — this is the bug being fixed', () => {
    expect(timeoutForJob(300_000)).toBe(330_000)
    expect(timeoutForJob(300_000)).toBeGreaterThan(180_000)
  })

  it('assumes a default for a route that declares nothing', () => {
    expect(timeoutForJob(null)).toBe(90_000)
  })

  it('is clamped at both ends', () => {
    expect(timeoutForJob(1_000)).toBe(60_000)
    expect(timeoutForJob(10_000_000)).toBe(330_000)
  })
})

describe('the real fast tier', () => {
  it('gives EVERY declared route more time than it asks for', () => {
    // Guards the exact drift that caused this: a route raising its maxDuration must not silently
    // start being killed early.
    const { fast } = classifyCrons(readVercelCrons())
    const tooTight: string[] = []
    for (const c of fast as Array<{ path: string }>) {
      const budget = routeMaxDurationMs(c.path, (rel: string) => readFileSync(rel, 'utf8'))
      if (budget != null && timeoutForJob(budget) <= budget) tooTight.push(c.path)
    }
    expect(tooTight).toEqual([])
  })

  /*
   * One route may tick every 5 minutes on a 300s budget, and ONLY because it caps its own per-tick
   * work below that budget: `trade-grade-notify` hosts the 5-minute offer sweep (Guap's ruling,
   * 2026-09-25), which stops STARTING leagues at 120s, while its 18-week rotation and offer ledger —
   * the work the 300s was sized for — run only every third tick (`claimRotationTick`). The
   * exception is checked against those two lines, so removing either turns this red again.
   */
  const BUDGETED_EVERY_TICK: Record<string, RegExp[]> = {
    '/api/cron/trade-grade-notify': [/detectAndNotifyRecent\(\{ deadlineMs: 120_000/, /claimRotationTick\(\)/],
  }

  it('keeps every timeout well inside its own cadence for the slow-cadence jobs', () => {
    // A long timeout is only safe because the routes declaring 300s run every 15-30 minutes.
    const { fast } = classifyCrons(readVercelCrons())
    for (const c of fast as Array<{ path: string; schedule: string }>) {
      const budget = routeMaxDurationMs(c.path, (rel: string) => readFileSync(rel, 'utf8'))
      if (budget !== 300_000) continue
      const minutes = Number(c.schedule.split(' ')[0].replace('*/', ''))
      if (BUDGETED_EVERY_TICK[c.path]) {
        const src = readFileSync(`app${c.path}/route.ts`, 'utf8')
        for (const proof of BUDGETED_EVERY_TICK[c.path]!) expect(src).toMatch(proof)
        expect(minutes).toBeGreaterThanOrEqual(5)
        continue
      }
      expect(minutes).toBeGreaterThanOrEqual(15)
    }
  })
})
