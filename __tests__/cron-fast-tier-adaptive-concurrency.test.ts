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

  it('does not throttle before it has enough evidence', () => {
    // One slow call at startup must not collapse the pool.
    expect(effectiveConcurrency([120_000])).toBe(8)
    expect(effectiveConcurrency([120_000, 110_000, 90_000])).toBe(8)
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

describe('input robustness', () => {
  it('survives a non-array', () => {
    expect(effectiveConcurrency(undefined as unknown as number[])).toBe(8)
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
