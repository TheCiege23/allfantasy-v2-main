import { describe, expect, it } from 'vitest'
// No `@ts-expect-error` here, unlike cron-fast-tier-loop.test.ts's identical-looking import of
// the same module: within one compilation, TypeScript infers a shape for a `.mjs` module the
// first time some file imports it, and a LATER file importing the same module sees that cached
// inference rather than a fresh "no declaration file" error. Confirmed by tsc itself -- an
// `@ts-expect-error` here was flagged TS2578 "Unused directive", not merely unnecessary caution.
import { intervalMsForSchedule, nextBoundary, assignPhases } from '../scripts/cron-fast-tier-loop.mjs'
import { readVercelCrons, classifyCrons } from '../scripts/cron-tier.mjs'

/**
 * ROOT CAUSE FIXED. `nextBoundary` aligned every job to the epoch with no phase concept, so any
 * two jobs sharing a cadence (e.g. every 30 minutes) landed on the EXACT SAME instant forever, by
 * construction.
 *
 * MEASURED IN PRODUCTION 2026-09-03: five every-30-minute jobs -- fantasy-os-exec-sync, domain-os-refresh,
 * import-injuries, draft-pool-prewarm, trade-grade-notify -- all became due in the same tick
 * TWICE, 14:32:08Z and 15:02:05Z, 29m57s apart. Confirmed not deploy-correlated against two
 * different deployments independently: one had a build in progress and the collision still
 * happened; a different build's entire window was clean with no collision nearby. At least two of
 * the five are independently slow enough that admitting them together was never survivable:
 * domain-os-refresh measures p99 430s and trade-grade-notify measures p99 359s, both already over
 * their own 300s maxDuration running alone. The adaptive concurrency backoff could not see it
 * coming -- it reacts to recent call latency, and the window right before each collision was full
 * of fast every-minute-job samples, so all five were admitted before any of them had returned.
 *
 * `assignPhases` spreads jobs that share an interval longer than a minute evenly across that
 * interval, so they can never land in the same tick again. Every-minute jobs are left at phase 0,
 * deliberately -- they have always collided with each other and that has never been the failure;
 * only sparser cadences carrying individually-heavy jobs produced this incident.
 */

describe('nextBoundary with a phase', () => {
  it('defaults to phase 0, reproducing the original alignment exactly', () => {
    const now = 1_700_000_000_000
    expect(nextBoundary(now, 120_000)).toBe(nextBoundary(now, 120_000, 0))
  })

  it('shifts the boundary by exactly the phase, without changing the interval', () => {
    // `now` must sit before BOTH the phase-0 point and the phase-600_000 point of the SAME
    // upcoming cycle, or the two "next boundary" calls are not comparing the same cycle and the
    // difference is not a clean +phase (a phased job's OWN next occurrence can legitimately land
    // earlier than an unphased job's, depending on where `now` falls relative to each).
    const base = 1_700_000_000_000 - (1_700_000_000_000 % 3_600_000) // top of an hour
    const now = base - 700_000 // before both phase points of the cycle starting at `base`
    const unshifted = nextBoundary(now, 1_800_000)
    const shifted = nextBoundary(now, 1_800_000, 600_000)
    expect(unshifted).toBe(base)
    expect(shifted).toBe(base + 600_000)
    expect(shifted - unshifted).toBe(600_000)
  })

  it('a phased boundary still always advances past now', () => {
    const now = 1_700_000_000_000
    const phased = nextBoundary(now, 1_800_000, 900_000)
    expect(phased).toBeGreaterThan(now)
  })

  it('two overlapping loop starts still choose the SAME phased instant', () => {
    // The property the un-phased version already guaranteed must survive: this is what stops an
    // overlapping run from doubling the effective rate instead of coinciding with the first.
    const a = nextBoundary(1_000_000_000_000, 1_800_000, 300_000)
    const b = nextBoundary(1_000_000_000_000 + 7_000, 1_800_000, 300_000)
    expect(a).toBe(b)
  })
})

describe('assignPhases', () => {
  it('leaves every-minute jobs at phase 0', () => {
    const jobs = [
      { path: '/a', intervalMs: 60_000, phaseMs: 0 },
      { path: '/b', intervalMs: 60_000, phaseMs: 0 },
      { path: '/c', intervalMs: 60_000, phaseMs: 0 },
    ]
    assignPhases(jobs)
    expect(jobs.every((j) => j.phaseMs === 0)).toBe(true)
  })

  it('leaves a lone job on a shared-capable cadence at phase 0 -- nothing to spread it from', () => {
    const jobs = [{ path: '/only', intervalMs: 1_800_000, phaseMs: 0 }]
    assignPhases(jobs)
    expect(jobs[0].phaseMs).toBe(0)
  })

  it('spreads two jobs on the same interval to opposite ends of it', () => {
    const jobs = [
      { path: '/z', intervalMs: 1_800_000, phaseMs: 0 },
      { path: '/a', intervalMs: 1_800_000, phaseMs: 0 },
    ]
    assignPhases(jobs)
    const phases = jobs.map((j) => j.phaseMs).sort((a, b) => a - b)
    expect(phases).toEqual([0, 900_000])
  })

  it('THE ACTUAL INCIDENT: five */30 jobs no longer share a phase', () => {
    const paths = [
      '/api/cron/fantasy-os-exec-sync',
      '/api/cron/domain-os-refresh',
      '/api/cron/import-injuries',
      '/api/cron/draft-pool-prewarm',
      '/api/cron/trade-grade-notify',
    ]
    const jobs = paths.map((path) => ({ path, intervalMs: 1_800_000, phaseMs: 0 }))
    assignPhases(jobs)

    const phases = jobs.map((j) => j.phaseMs)
    expect(new Set(phases).size).toBe(5) // no two share a phase
    for (const p of phases) {
      expect(p).toBeGreaterThanOrEqual(0)
      expect(p).toBeLessThan(1_800_000)
    }

    // The regression this exists to prevent: with the OLD unphased nextBoundary, every one of
    // these five produces the identical due time. With phases applied, no two do -- for any tick
    // they might all be freshly due in.
    const now = 1_700_000_000_000
    const dueTimes = jobs.map((j) => nextBoundary(now, j.intervalMs, j.phaseMs))
    expect(new Set(dueTimes).size).toBe(5)
  })

  it('separates every pair by at least interval/groupSize, not merely "not equal"', () => {
    // A hash-based spread could pass the "no two share a phase" test above while still landing
    // two jobs seconds apart -- silently reproducing the collision. Assert the actual minimum gap.
    const jobs = Array.from({ length: 5 }, (_, i) => ({ path: `/j${i}`, intervalMs: 1_800_000, phaseMs: 0 }))
    assignPhases(jobs)
    const phases = jobs.map((j) => j.phaseMs).sort((a, b) => a - b)
    for (let i = 1; i < phases.length; i += 1) {
      expect(phases[i] - phases[i - 1]).toBe(360_000) // 1_800_000 / 5, exactly
    }
  })

  it('is deterministic across repeated calls and independent of input order', () => {
    const forward = [
      { path: '/api/cron/domain-os-refresh', intervalMs: 1_800_000, phaseMs: 0 },
      { path: '/api/cron/fantasy-os-exec-sync', intervalMs: 1_800_000, phaseMs: 0 },
    ]
    const reversed = [...forward].reverse().map((j) => ({ ...j }))
    assignPhases(forward)
    assignPhases(reversed)
    const byPath = (arr: { path: string; phaseMs: number }[]) =>
      Object.fromEntries(arr.map((j) => [j.path, j.phaseMs]))
    expect(byPath(forward)).toEqual(byPath(reversed))
  })

  it('does not touch phaseMs on jobs from a DIFFERENT interval group', () => {
    const jobs = [
      { path: '/thirty-a', intervalMs: 1_800_000, phaseMs: 0 },
      { path: '/thirty-b', intervalMs: 1_800_000, phaseMs: 0 },
      { path: '/ten-a', intervalMs: 600_000, phaseMs: 0 },
      { path: '/ten-b', intervalMs: 600_000, phaseMs: 0 },
    ]
    assignPhases(jobs)
    const thirty = jobs.filter((j) => j.intervalMs === 1_800_000).map((j) => j.phaseMs)
    const ten = jobs.filter((j) => j.intervalMs === 600_000).map((j) => j.phaseMs)
    // Each group is internally spread (not both left at 0)...
    expect(new Set(thirty).size).toBe(2)
    expect(new Set(ten).size).toBe(2)
    // ...and neither group's spread depends on the OTHER group's size.
    expect(Math.max(...thirty)).toBe(900_000) // 1_800_000 / 2
    expect(Math.max(...ten)).toBe(300_000) // 600_000 / 2
  })
})

describe('the real cron schedule, after this fix', () => {
  it('no two fast-tier jobs sharing an interval > 1 minute share a phase', () => {
    // The regression test for the actual incident: run the real classifier and the real
    // assignPhases over cron-schedule.json exactly as main() does, and assert the collision
    // cannot reoccur for whatever the schedule currently declares -- not just the five jobs
    // named in the incident, so a FUTURE job added to */30 (or any other multi-job cadence) is
    // covered automatically.
    const { fast } = classifyCrons(readVercelCrons())
    const jobs: { path: string; intervalMs: number; phaseMs: number }[] = fast
      .map((c: { path: string; schedule: string }) => ({
        path: c.path,
        intervalMs: intervalMsForSchedule(c.schedule) as number | null,
        phaseMs: 0,
      }))
      // Type predicate, not a bare boolean filter -- `.filter()` alone does not narrow
      // `number | null` to `number` for TypeScript, which is exactly what TS2345/TS18047
      // below were complaining about the first time this test was written.
      .filter((j: { intervalMs: number | null }): j is { path: string; intervalMs: number; phaseMs: number } =>
        j.intervalMs != null,
      )

    assignPhases(jobs)

    const byInterval = new Map<number, number[]>()
    for (const j of jobs) {
      if (j.intervalMs <= 60_000) continue // every-minute jobs are deliberately not spread
      if (!byInterval.has(j.intervalMs)) byInterval.set(j.intervalMs, [])
      byInterval.get(j.intervalMs)!.push(j.phaseMs)
    }

    for (const [intervalMs, phases] of byInterval) {
      expect(new Set(phases).size, `duplicate phase among jobs on a ${intervalMs / 60_000}-min cadence`).toBe(
        phases.length,
      )
    }
  })

  it('names the five jobs from the actual incident and confirms they now spread', () => {
    const { fast } = classifyCrons(readVercelCrons())
    const named = [
      '/api/cron/fantasy-os-exec-sync',
      '/api/cron/domain-os-refresh',
      '/api/cron/import-injuries',
      '/api/cron/draft-pool-prewarm',
      '/api/cron/trade-grade-notify',
    ]
    const present = named.filter((p) => fast.some((c: { path: string }) => c.path === p))
    // If the schedule has changed since the incident, this documents that rather than failing
    // silently -- but as of this fix, all five are still on the fast tier.
    expect(present).toEqual(named)

    const jobs = fast
      .filter((c: { path: string }) => named.includes(c.path))
      .map((c: { path: string; schedule: string }) => ({
        path: c.path,
        intervalMs: intervalMsForSchedule(c.schedule),
        phaseMs: 0,
      }))
    assignPhases(jobs)
    const phases = jobs.map((j: { phaseMs: number }) => j.phaseMs)
    expect(new Set(phases).size).toBe(5)
  })
})
