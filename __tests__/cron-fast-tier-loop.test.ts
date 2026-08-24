import { describe, expect, it } from 'vitest'
// @ts-expect-error -- .mjs script, no types; imported for its pure scheduling helpers.
import { intervalMsForSchedule, nextBoundary, isSystemicFailure } from '../scripts/cron-fast-tier-loop.mjs'
// @ts-expect-error -- .mjs script, no types.
import { readVercelCrons, classifyCrons } from '../scripts/cron-tier.mjs'

/**
 * The fast tier exists because GitHub schedules cannot fire more often than hourly and the host's
 * scheduler is unavailable. This workflow starts hourly and ticks internally, so the scheduling
 * arithmetic is the part that has to be right — a wrong interval silently under- or over-fires a
 * job against a live provider.
 */

describe('intervalMsForSchedule', () => {
  it('reads every-minute and step schedules', () => {
    expect(intervalMsForSchedule('* * * * *')).toBe(60_000)
    expect(intervalMsForSchedule('*/1 * * * *')).toBe(60_000)
    expect(intervalMsForSchedule('*/2 * * * *')).toBe(120_000)
    expect(intervalMsForSchedule('*/30 * * * *')).toBe(1_800_000)
  })

  it('returns null for hourly-or-slower, which belongs to the slow tier', () => {
    // "0 * * * *" is hourly: the minute field is a literal, not a step.
    expect(intervalMsForSchedule('0 * * * *')).toBeNull()
    expect(intervalMsForSchedule('30 7 * * *')).toBeNull()
  })

  it('returns null rather than guessing on malformed input', () => {
    expect(intervalMsForSchedule('')).toBeNull()
    expect(intervalMsForSchedule(null)).toBeNull()
    expect(intervalMsForSchedule('*/0 * * * *')).toBeNull()
    expect(intervalMsForSchedule('*/60 * * * *')).toBeNull()
  })
})

describe('nextBoundary', () => {
  it('aligns to the epoch, not to process start', () => {
    // Two loops started seconds apart must choose the SAME slots, or an overlapping run doubles
    // the effective rate instead of coinciding with the first.
    const a = nextBoundary(1_000_000_000_000, 120_000)
    const b = nextBoundary(1_000_000_000_000 + 7_000, 120_000)
    expect(a % 120_000).toBe(0)
    expect(b % 120_000).toBe(0)
    expect(b).toBe(a)
  })

  it('always advances, so a job scheduled exactly on a boundary cannot re-fire in a loop', () => {
    const onBoundary = 1_000_000_020_000
    expect(onBoundary % 60_000).toBe(0)
    expect(nextBoundary(onBoundary, 60_000)).toBeGreaterThan(onBoundary)
  })

  it('gives the next whole slot for the cadences actually in use', () => {
    const base = 1_700_000_000_000 - (1_700_000_000_000 % 3_600_000) // top of an hour
    expect(nextBoundary(base + 10_000, 60_000)).toBe(base + 60_000)
    expect(nextBoundary(base + 10_000, 120_000)).toBe(base + 120_000)
    expect(nextBoundary(base + 130_000, 120_000)).toBe(base + 240_000)
  })
})

/**
 * ⚠ THIS CONTRACT CHANGED: a bare attempt COUNT is no longer enough to blame a job.
 *
 * It used to be `attempts >= 3 && succeeded === 0`, which cannot tell a route that is broken from
 * one whose every attempt happened to land inside a host outage — and a low-frequency job fires
 * only three times in a 55-minute window, so a single outage could consume all of them. The
 * failures are now recorded individually, with a kind, so the two can be separated. See
 * cron-fast-tier-host-vs-job.test.ts for that half.
 */
const jobFail = (n: number, at = 1_700_000_000_000) =>
  Array.from({ length: n }, (_, i) => ({ path: '/x', at: at + i * 60_000, kind: 'job', error: 'HTTP 500' }))

describe('isSystemicFailure', () => {
  it('ignores a single bad tick, because one blip must not redden an hourly workflow', () => {
    expect(isSystemicFailure({ attempts: 1, succeeded: 0, failures: jobFail(1) })).toBe(false)
    expect(isSystemicFailure({ attempts: 2, succeeded: 0, failures: jobFail(2) })).toBe(false)
  })

  it('flags a job that has failed every attempt — that is a 401 or 404, not weather', () => {
    expect(isSystemicFailure({ attempts: 3, succeeded: 0, failures: jobFail(3) })).toBe(true)
    expect(isSystemicFailure({ attempts: 40, succeeded: 0, failures: jobFail(40) })).toBe(true)
  })

  it('does not flag a job that succeeded even once', () => {
    expect(isSystemicFailure({ attempts: 40, succeeded: 1, failures: jobFail(39) })).toBe(false)
  })

  it('is not fooled by a stat with no recorded failures, which cannot prove anything', () => {
    // Defensive: an attempt count with no failure detail is not evidence of a broken route.
    expect(isSystemicFailure({ attempts: 40, succeeded: 0, failures: [] })).toBe(false)
  })
})

describe('coverage of the declared fast tier', () => {
  it('derives an interval for every fast cron in vercel.json', () => {
    // A fast cron this loop cannot schedule would be dropped with only a warning, so assert the
    // two classifiers agree rather than discovering the gap in production.
    const { fast } = classifyCrons(readVercelCrons())
    expect(fast.length).toBeGreaterThan(0)
    const unschedulable = fast.filter((c: { schedule: string }) => intervalMsForSchedule(c.schedule) == null)
    expect(unschedulable).toEqual([])
  })

  it('never claims a slow-tier cron, so the two workflows cannot double-fire one job', () => {
    const { slow } = classifyCrons(readVercelCrons())
    const claimed = slow.filter((c: { schedule: string }) => intervalMsForSchedule(c.schedule) != null)
    expect(claimed).toEqual([])
  })
})
