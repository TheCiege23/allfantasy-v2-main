import { describe, expect, it } from 'vitest'
// @ts-expect-error -- .mjs script, no types.
import { orderByUrgency, intervalMsForSchedule } from '../scripts/cron-fast-tier-loop.mjs'
// @ts-expect-error -- .mjs script, no types.
import { readVercelCrons, classifyCrons } from '../scripts/cron-tier.mjs'

/**
 * The first production run of the fast-tier loop starved exactly the jobs it was built for.
 *
 * `classifyCrons` returns vercel.json order, which puts the every-minute jobs LAST. The scheduler
 * iterated that array directly, so when slower jobs filled the concurrency pool it re-scanned from
 * index 0 each tick and never reached the tail. Measured lateness rose monotonically with index:
 *
 *   draft-tick          (idx 8)   14.1 min late   (declared every 1 min)
 *   live-score-tick     (idx 9)   20.8 min late   (declared every 2 min)
 *   legacy-import-drain (idx 10)  20.8 min late   (declared every 1 min)
 */

const t0 = 1_700_000_000_000

describe('orderByUrgency', () => {
  it('puts the job that has missed the most cycles first, regardless of array position', () => {
    const due = [
      { path: '/slow', intervalMs: 1_800_000, dueAt: t0 - 180_000 }, // 30m job, 3m late  → 0.1
      { path: '/fast', intervalMs: 60_000, dueAt: t0 - 120_000 },    // 1m job,  2m late  → 2.0
    ]
    expect(orderByUrgency(due, t0).map((j) => j.path)).toEqual(['/fast', '/slow'])
  })

  it('does NOT rank by absolute lateness, which is the trap', () => {
    // /slow is later in wall-clock terms but has not missed a single cycle; /fast has missed four.
    const due = [
      { path: '/slow', intervalMs: 1_800_000, dueAt: t0 - 600_000 }, // 10m late of a 30m cadence
      { path: '/fast', intervalMs: 60_000, dueAt: t0 - 240_000 },    // 4m late of a 1m cadence
    ]
    expect(orderByUrgency(due, t0)[0].path).toBe('/fast')
  })

  it('breaks ties toward the tighter cadence', () => {
    const due = [
      { path: '/two-min', intervalMs: 120_000, dueAt: t0 - 120_000 },
      { path: '/one-min', intervalMs: 60_000, dueAt: t0 - 60_000 },
    ]
    expect(orderByUrgency(due, t0)[0].path).toBe('/one-min')
  })

  it('does not mutate the input array', () => {
    const due = [
      { path: '/a', intervalMs: 60_000, dueAt: t0 - 10_000 },
      { path: '/b', intervalMs: 60_000, dueAt: t0 - 90_000 },
    ]
    const before = due.map((j) => j.path)
    orderByUrgency(due, t0)
    expect(due.map((j) => j.path)).toEqual(before)
  })
})

describe('the real fast tier, under contention', () => {
  it('serves every-minute jobs before half-hourly ones when all are equally overdue', () => {
    // Reproduces the production shape: all 12 due at once, pool smaller than the job count.
    const { fast } = classifyCrons(readVercelCrons())
    const due = fast.map((c: { path: string; schedule: string }) => ({
      path: c.path,
      intervalMs: intervalMsForSchedule(c.schedule),
      dueAt: t0 - intervalMsForSchedule(c.schedule), // each exactly one cycle late
    }))
    const firstEight = orderByUrgency(due, t0).slice(0, 8).map((j) => j.path)

    // These three sit at indices 8, 9 and 10 of vercel.json order and were the starved ones.
    expect(firstEight).toContain('/api/cron/draft-tick')
    expect(firstEight).toContain('/api/cron/live-score-tick')
    expect(firstEight).toContain('/api/cron/legacy-import-drain')
  })
})
