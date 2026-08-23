/**
 * `lib/cron/runBudget.ts` — the wall-clock budget these long imports stop against.
 *
 * WHY IT EXISTS. Measured 2026-08-23: `import-players` and `import-season-stats` both returned
 * **HTTP 502 at ~300,200ms**. The platform edge severs the connection at a 300s cap and answers
 * 502 itself, so neither `maxDuration` nor a client timeout buys more room — the work has to fit.
 *
 * Both functions take an injectable clock precisely so this is testable without waiting minutes.
 */
import { describe, it, expect } from 'vitest'

import { createRunBudget, rotateForFairness, CRON_RUN_BUDGET_MS } from '../lib/cron/runBudget'

/** Controllable clock, so a 240s budget can be exercised in microseconds. */
function fakeClock(start = 1_000_000) {
  let t = start
  return { now: () => t, advance: (ms: number) => { t += ms } }
}

describe('createRunBudget', () => {
  it('is not exhausted before the budget elapses', () => {
    const c = fakeClock()
    const b = createRunBudget(1000, c.now)
    c.advance(999)
    expect(b.exhausted()).toBe(false)
  })

  it('is exhausted exactly AT the budget, not only past it', () => {
    // `>=` not `>`. At the boundary the next unit would start with zero time left, which is the
    // case that overruns the ceiling.
    const c = fakeClock()
    const b = createRunBudget(1000, c.now)
    c.advance(1000)
    expect(b.exhausted()).toBe(true)
  })

  it('reports elapsed and remaining, with remaining floored at zero', () => {
    const c = fakeClock()
    const b = createRunBudget(1000, c.now)
    c.advance(400)
    expect(b.elapsedMs()).toBe(400)
    expect(b.remainingMs()).toBe(600)
    c.advance(5000)
    // Never negative — a caller logging "time left" must not print a negative number.
    expect(b.remainingMs()).toBe(0)
  })

  it('leaves real headroom under the 300s edge ceiling', () => {
    // The budget is only checked BETWEEN units, so a unit starting at 239s runs to completion past
    // the check and the response still has to serialise. If this ever creeps to 300s the routes go
    // back to returning 502 instead of a partial result.
    expect(CRON_RUN_BUDGET_MS).toBeLessThanOrEqual(240_000)
    expect(300_000 - CRON_RUN_BUDGET_MS).toBeGreaterThanOrEqual(60_000)
  })
})

describe('rotateForFairness', () => {
  const sports = ['NFL', 'NBA', 'NHL', 'MLB'] as const

  it('gives every unit the lead exactly once per cycle', () => {
    // THE POINT. A budget over a FIXED order does the first few units forever and never reaches
    // the tail — it converts "everything is late" into "the tail is never done", which is worse
    // because it looks fine. sports-data-importer had exactly this: NBA, NHL, MLB and SOCCER sat
    // frozen at 2026-04-26 while NFL, first in the list, kept updating.
    const period = 1000
    const leaders = [0, 1, 2, 3].map((i) => {
      const c = fakeClock(i * period)
      return rotateForFairness(sports, period, c.now)[0]
    })
    expect(new Set(leaders).size).toBe(4)
  })

  it('preserves every unit and the relative order, only rotating the start', () => {
    const c = fakeClock(2000)
    const out = rotateForFairness(sports, 1000, c.now)
    expect(out).toHaveLength(4)
    expect(new Set(out)).toEqual(new Set(sports))
    expect(out).toEqual(['NHL', 'MLB', 'NFL', 'NBA'])
  })

  it('is stable within a period — the same fire order for repeated calls', () => {
    const c = fakeClock(1500)
    expect(rotateForFairness(sports, 1000, c.now)).toEqual(rotateForFairness(sports, 1000, c.now))
  })

  it('handles empty and single-element lists without rotating', () => {
    expect(rotateForFairness([], 1000)).toEqual([])
    expect(rotateForFairness(['NFL'], 1000)).toEqual(['NFL'])
  })

  it('does not mutate the input', () => {
    // The call sites pass module-level constants like TSDB_SPORTS; mutating one would reorder it
    // permanently for every later caller in the same process.
    const original = [...sports]
    const c = fakeClock(3000)
    rotateForFairness(sports, 1000, c.now)
    expect([...sports]).toEqual(original)
  })
})
