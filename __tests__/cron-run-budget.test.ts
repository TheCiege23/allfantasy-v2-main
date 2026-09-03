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

/**
 * Weighted lead share — a unit too large to finish unless it leads.
 *
 * 🛑 THE FAILURE THIS ADDRESSES, MEASURED. Plain rotation is fair by COUNT and unfair by COST: it
 * hands every unit the lead once per cycle, so a unit big enough to consume the whole budget is
 * refreshed once per cycle however often the job runs. On 2026-09-03, NCAAF held 10,189
 * AFProjectionSnapshot rows against NFL's 3,154, and every NCAAF row dated from its previous turn
 * at the front, exactly 7 days earlier — while every other sport had written within two days.
 */
describe('rotateForFairness — weighted lead share', () => {
  const sports = ['NFL', 'NBA', 'NHL', 'MLB', 'NCAAF', 'NCAAB', 'SOCCER'] as const
  const weighted = new Map<string, number>([['NCAAF', 2]])
  const period = 1000

  const leadAt = (i: number, w?: Map<string, number>) =>
    rotateForFairness(sports, period, fakeClock(i * period).now, w)[0]

  it('🛑 unweighted behaviour is BYTE-IDENTICAL when no share is given', () => {
    // The weight is opt-in. Every existing caller must be unaffected, so this pins the default.
    for (let i = 0; i < 14; i += 1) {
      const c1 = fakeClock(i * period)
      const c2 = fakeClock(i * period)
      expect(rotateForFairness(sports, period, c1.now)).toEqual(
        rotateForFairness(sports, period, c2.now, new Map()),
      )
    }
  })

  it('leads the weighted unit twice per 8 periods instead of once per 7', () => {
    const plain = Array.from({ length: 56 }, (_, i) => leadAt(i)).filter((s) => s === 'NCAAF').length
    const withW = Array.from({ length: 56 }, (_, i) => leadAt(i, weighted)).filter((s) => s === 'NCAAF').length
    expect(plain).toBe(8) // 56 / 7
    expect(withW).toBe(14) // 56 / 8 * 2
    expect(withW).toBeGreaterThan(plain)
  })

  it('🛑 still gives EVERY unit the lead within a cycle — the tail is not starved', () => {
    /*
     * The whole reason rotation exists. Weighting one unit must not cost another its turn, or this
     * re-creates the starvation from the other direction: `sports-data-importer` had NBA, NHL, MLB
     * and SOCCER frozen at 2026-04-26 while NFL, first in a fixed list, kept updating.
     */
    const leaders = new Set(Array.from({ length: 8 }, (_, i) => leadAt(i, weighted)))
    expect(leaders).toEqual(new Set(sports))
  })

  it('🛑 returns each unit EXACTLY ONCE — a duplicate would redo work and starve the tail', () => {
    for (let i = 0; i < 8; i += 1) {
      const out = rotateForFairness(sports, period, fakeClock(i * period).now, weighted)
      expect(out).toHaveLength(sports.length)
      expect(new Set(out).size).toBe(sports.length)
    }
  })

  it('improves the weighted unit\'s AVERAGE position, not just its lead count', () => {
    const avg = (w?: Map<string, number>) => {
      let total = 0
      for (let i = 0; i < 56; i += 1) {
        total += rotateForFairness(sports, period, fakeClock(i * period).now, w).indexOf('NCAAF')
      }
      return total / 56
    }
    expect(avg(weighted)).toBeLessThan(avg())
  })

  it('ignores a nonsensical share rather than corrupting the rotation', () => {
    for (const bad of [0, -3, 0.4, NaN]) {
      const out = rotateForFairness(sports, period, fakeClock(0).now, new Map([['NCAAF', bad]]))
      expect(out).toHaveLength(sports.length)
      expect(new Set(out).size).toBe(sports.length)
    }
  })
})
