import { describe, expect, it } from 'vitest'

import { effectiveConcurrency, orderByUrgency } from '../scripts/cron-fast-tier-loop.mjs'

/**
 * The fast-tier loop fires up to MAX_CONCURRENCY (8) requests at once. Against a warm container
 * those answer in 0.5-9s. Against a container that has just restarted they took 51-112s, measured
 * in production on 2026-09-03 — and eight of those at once saturated a single-threaded Node process
 * until real user requests timed out.
 *
 * `effectiveConcurrency` is the backoff. These tests pin the two things that make it safe:
 * it must NOT throttle a healthy app (or it re-introduces the starvation MAX_CONCURRENCY was
 * raised from 4 to fix), and it MUST throttle a sick one.
 */

const HEALTHY = [400, 900, 1200, 700, 2500, 800, 1100, 600]
/** The real numbers from the 2026-09-03 incident. */
const COLD = [111_587, 111_716, 110_982, 63_169, 51_535, 94_371, 82_731, 83_485]

describe('effectiveConcurrency — the healthy case must be untouched', () => {
  it('leaves the full cap in place when every recent call was fast', () => {
    expect(effectiveConcurrency(HEALTHY)).toBe(8)
  })

  it('reaches the full cap once a full healthy window exists', () => {
    expect(effectiveConcurrency(new Array(8).fill(1_000))).toBe(8)
  })

  it('ignores a single slow call among a healthy sample', () => {
    const oneBlip = [...HEALTHY.slice(1), 45_000]
    // 7 of 8 healthy -> round(8 * 0.875) = 7. Barely moves, which is the point.
    expect(effectiveConcurrency(oneBlip)).toBe(7)
  })

  it('treats a call just under the threshold as healthy', () => {
    expect(effectiveConcurrency(new Array(8).fill(29_999))).toBe(8)
  })
})

describe('effectiveConcurrency — the incident case must throttle', () => {
  it('drops to the floor when every recent call is cold-container slow', () => {
    expect(effectiveConcurrency(COLD)).toBe(2)
  })

  it('never returns zero, or a cold container would never get the traffic that warms it', () => {
    expect(effectiveConcurrency(new Array(8).fill(300_000))).toBeGreaterThanOrEqual(2)
  })

  it('scales with the healthy fraction rather than flipping', () => {
    const half = [...HEALTHY.slice(0, 4), ...COLD.slice(0, 4)]
    expect(effectiveConcurrency(half)).toBe(4)
  })

  it('recovers to the full cap once calls are fast again', () => {
    // The rolling window has moved past the incident.
    expect(effectiveConcurrency([...COLD, ...HEALTHY].slice(-8))).toBe(8)
  })

  it('reads only the most recent window, not the whole history', () => {
    // A long-ago outage must not hold the cap down forever.
    expect(effectiveConcurrency([...new Array(50).fill(200_000), ...HEALTHY])).toBe(8)
  })
})

describe('the backoff must not undo the starvation fix', () => {
  it('still hands the reduced slots to the most overdue job relative to its own cadence', () => {
    const now = 1_000_000
    // A 30-minute job 3 min late vs an every-minute job 2 min late: the second has missed two
    // whole cycles. Under a cap of 2 it is the one that must get a slot.
    const due = [
      { path: '/api/cron/import-injuries', intervalMs: 30 * 60_000, dueAt: now - 3 * 60_000 },
      { path: '/api/cron/draft-tick', intervalMs: 60_000, dueAt: now - 2 * 60_000 },
      { path: '/api/cron/live-score-tick', intervalMs: 2 * 60_000, dueAt: now - 2 * 60_000 },
    ]
    const cap = effectiveConcurrency(COLD)
    expect(cap).toBe(2)

    const admitted = orderByUrgency(due, now).slice(0, cap).map((j) => j.path)
    expect(admitted).toContain('/api/cron/draft-tick')
    expect(admitted).not.toContain('/api/cron/import-injuries')
  })
})

/**
 * SLOW START. The first version returned the full cap until it had 8 samples, so every workflow
 * run opened at concurrency 8 with the throttle inert — and the startup catch-up fires every job
 * at once. That took production down for six minutes at 04:01Z on 2026-09-03: eight crons at
 * 125,004ms, all abandoned. Capacity must be earned, not assumed.
 */
describe('slow start — a run must not open at full throttle', () => {
  it('starts at the floor with no evidence at all', () => {
    expect(effectiveConcurrency([])).toBe(2)
  })

  it('earns one slot per healthy call rather than jumping to the cap', () => {
    expect(effectiveConcurrency([500])).toBe(3)
    expect(effectiveConcurrency([500, 600])).toBe(4)
    expect(effectiveConcurrency([500, 600, 700])).toBe(5)
    expect(effectiveConcurrency([500, 600, 700, 800])).toBe(6)
    expect(effectiveConcurrency([500, 600, 700, 800, 900])).toBe(7)
    expect(effectiveConcurrency([500, 600, 700, 800, 900, 1000])).toBe(8)
  })

  it('does NOT ramp on slow calls — a cold container never earns the slots', () => {
    expect(effectiveConcurrency([120_000])).toBe(2)
    expect(effectiveConcurrency([120_000, 110_000, 90_000])).toBe(2)
  })

  it('is the regression test for the 04:01Z outage', () => {
    // A fresh run's very first tick, which is exactly when the startup catch-up fires everything.
    expect(effectiveConcurrency([])).toBeLessThanOrEqual(2)
    // And it must not have been 8, which is what took the site down.
    expect(effectiveConcurrency([])).not.toBe(8)
  })

  it('lets a backoff override an unfinished ramp', () => {
    // 5 samples, 3 healthy: earned = 2+3 = 5, steady = round(8 * 3/5) = 5. Lower of the two.
    expect(effectiveConcurrency([500, 600, 700, 120_000, 130_000])).toBe(5)
    // 5 samples, 1 healthy: earned = 3, steady = round(8 * 1/5) = 2. Backoff wins.
    expect(effectiveConcurrency([500, 120_000, 130_000, 140_000, 150_000])).toBe(2)
  })
})

describe('input robustness', () => {
  it('treats a non-array as no evidence, so the floor', () => {
    expect(effectiveConcurrency(undefined as unknown as number[])).toBe(2)
  })

  it('ignores non-finite samples rather than counting them as slow', () => {
    const withJunk = [...HEALTHY.slice(0, 7), Number.NaN]
    expect(effectiveConcurrency(withJunk)).toBe(8)
  })

  it('honours an explicit max, so the cap is not hard-wired into the maths', () => {
    expect(effectiveConcurrency(HEALTHY, 4)).toBe(4)
    expect(effectiveConcurrency(COLD, 4)).toBe(2)
  })
})
