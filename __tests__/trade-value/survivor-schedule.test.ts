import { describe, expect, it } from 'vitest'

import { guillotineHorizon } from '@/lib/trade-intel/guillotine'
import {
  blendAcrossRosterChange,
  shareOfRemainingFrom,
  survivorHorizon,
  validateSchedule,
  SURVIVOR_ALL_STARS_2026,
  SURVIVOR_ALL_STARS_SUPERFLEX_WEEK,
  type SurvivorSchedule,
} from '@/lib/trade-intel/survivorSchedule'

const S = SURVIVOR_ALL_STARS_2026

/* A flat one-a-week league — the shape `guillotineHorizon` already assumes. */
const FLAT: SurvivorSchedule = {
  id: 'flat',
  label: 'flat',
  aliveByWeek: Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i + 1, 12 - i])),
}

describe('validateSchedule — a malformed schedule must not produce a price', () => {
  it('🛑 refuses a schedule where eliminations reverse', () => {
    expect(validateSchedule({ id: 'x', label: 'x', aliveByWeek: { 1: 10, 2: 11 } })).toMatch(/do not reverse/)
  })

  it('refuses nothing, one week, and a non-numeric count', () => {
    expect(validateSchedule(null)).toBe('no schedule')
    expect(validateSchedule({ id: 'x', label: 'x', aliveByWeek: { 1: 10 } })).toMatch(/at least two/)
    expect(validateSchedule({ id: 'x', label: 'x', aliveByWeek: { 1: 10, 2: 0 } })).toMatch(/week 2/)
  })

  it('accepts the real schedule', () => {
    expect(validateSchedule(S)).toBeNull()
  })
})

describe('survivorHorizon — the constitution, priced', () => {
  it('reads the Gauntlet as the double elimination it is', () => {
    // W1-10 chop one; W11-13 chop two, one on each tribe; W17 chops nobody.
    expect(survivorHorizon(S, 5)!.chopsThisWeek).toBe(1)
    expect(survivorHorizon(S, 11)!.chopsThisWeek).toBe(2)
    expect(survivorHorizon(S, 12)!.chopsThisWeek).toBe(2)
    expect(survivorHorizon(S, 13)!.chopsThisWeek).toBe(2)
    expect(survivorHorizon(S, 14)!.chopsThisWeek).toBe(1)
    expect(survivorHorizon(S, 17)!.chopsThisWeek).toBe(0)
  })

  it('🛑 hazard DOUBLES entering the Gauntlet — the thing a flat model cannot see', () => {
    const w10 = survivorHorizon(S, 10)!
    const w11 = survivorHorizon(S, 11)!
    expect(w10.hazard).toBeCloseTo(1 / 13, 4)
    expect(w11.hazard).toBeCloseTo(2 / 12, 4)
    expect(w11.hazard / w10.hazard).toBeGreaterThan(2)
  })

  it('week one is exactly 1.0, and the season ends at 3 teams with nobody going home', () => {
    expect(survivorHorizon(S, 1)!.multiplier).toBe(1)
    expect(survivorHorizon(S, 1)!.expectedWeeksAlive).toBeCloseTo(223 / 22, 4) // 10.14 of 17
    const w17 = survivorHorizon(S, 17)!
    expect(w17.teamsAlive).toBe(3)
    expect(w17.expectedWeeksAlive).toBe(1)
    expect(w17.hazard).toBe(0)
    expect(w17.basis).toMatch(/last word/)
  })

  it('the multiplier falls monotonically — later is never worth more', () => {
    const weeks = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]
    let prev = Number.POSITIVE_INFINITY
    for (const w of weeks) {
      const m = survivorHorizon(S, w)!.multiplier
      expect(m, `week ${w}`).toBeLessThan(prev)
      prev = m
    }
  })

  it('the published multipliers are what a caller will actually get', () => {
    /* Pinned against the numbers in the module header, so the doc and the code cannot drift. */
    expect(survivorHorizon(S, 9)!.multiplier).toBeCloseTo(0.529, 3)
    expect(survivorHorizon(S, 10)!.multiplier).toBeCloseTo(0.463, 3)
    expect(survivorHorizon(S, 11)!.multiplier).toBeCloseTo(0.395, 3)
    expect(survivorHorizon(S, 12)!.multiplier).toBeCloseTo(0.355, 3)
    expect(survivorHorizon(S, 13)!.multiplier).toBeCloseTo(0.321, 3)
  })

  it('🛑 THE GAUNTLET ALONE, with the model held constant — 9.1 points at week 11', () => {
    /*
     * ⚠ THE FIRST VERSION OF THIS TEST COMPARED AGAINST `guillotineHorizon` AND GOT 12.9 POINTS,
     * WHICH CONFLATED TWO CAUSES. About 3.8 of those points are the off-by-one asserted below,
     * not the Gauntlet. Holding the maths fixed and changing ONLY the schedule isolates it.
     */
    const FLAT22: SurvivorSchedule = {
      id: 'flat22',
      label: 'flat 22-team, one a week',
      aliveByWeek: Object.fromEntries(Array.from({ length: 17 }, (_, i) => [i + 1, 22 - i])),
    }

    const gap = (w: number) => survivorHorizon(FLAT22, w)!.multiplier - survivorHorizon(S, w)!.multiplier

    expect(gap(11)).toBeCloseTo(0.091, 2)
    expect(gap(10)).toBeCloseTo(0.077, 2)
    expect(gap(9)).toBeCloseTo(0.066, 2)

    // The error PEAKS at the Gauntlet's doorstep and shrinks on both sides of it.
    for (const w of [8, 9, 10]) expect(gap(w), `week ${w}`).toBeLessThan(gap(11))
    for (const w of [12, 13, 14]) expect(gap(w), `week ${w}`).toBeLessThan(gap(11))

    // And the whole season is shorter than a flat one, by about two thirds of a week.
    expect(survivorHorizon(S, 1)!.expectedWeeksAlive).toBeCloseTo(10.14, 2)
    expect(survivorHorizon(FLAT22, 1)!.expectedWeeksAlive).toBeCloseTo(10.82, 2)
  })

  it('⚠ [control] documents the off-by-one against `guillotineHorizon`, rather than hiding it', () => {
    /*
     * `guillotineHorizon` uses (T−1)/2, which does not count the week you are playing now; summing
     * the survival curve gives (T+1)/2, which does. Zero at a full field, growing as it shrinks.
     * Pinned here so nobody later "fixes" one to match the other without reading why they differ —
     * and so the 9.1-point Gauntlet figure above can never be quietly re-derived from this gap.
     */
    const flatRelAt = (alive: number, start: number) =>
      guillotineHorizon({ teamsRemaining: alive, startingTeams: start })!.expectedWeeksAlive /
      guillotineHorizon({ teamsRemaining: start, startingTeams: start })!.expectedWeeksAlive

    expect(Math.abs(survivorHorizon(FLAT, 1)!.multiplier - flatRelAt(12, 12))).toBeCloseTo(0, 5)
    expect(Math.abs(survivorHorizon(FLAT, 6)!.multiplier - flatRelAt(7, 12))).toBeCloseTo(0.070, 2)
    expect(Math.abs(survivorHorizon(FLAT, 12)!.multiplier - flatRelAt(1, 12))).toBeCloseTo(0.154, 2)

    // The tell that mine is the one counting the current week: a lone survivor still plays a week.
    expect(guillotineHorizon({ teamsRemaining: 1, startingTeams: 12 })!.expectedWeeksAlive).toBe(0)
    expect(survivorHorizon(FLAT, 12)!.expectedWeeksAlive).toBe(1)
  })

  it('🛑 returns NULL for a week the schedule does not list, rather than clamping', () => {
    /* Clamping week 30 to week 17 answers a question about a season that has ended, and the
     * caller cannot tell that from a real answer. */
    expect(survivorHorizon(S, 30)).toBeNull()
    expect(survivorHorizon(S, 0)).toBeNull()
    expect(survivorHorizon(null, 5)).toBeNull()
  })
})

describe('the Week 9 superflex step — the chart cannot express it', () => {
  it('is weighted by SURVIVAL, not by calendar weeks', () => {
    /* Nine of seventeen weeks are superflex weeks — 53% by calendar. But a week you are unlikely
     * to reach is worth less than one you will certainly play, so the survival-weighted share is
     * materially lower, for exactly the managers deciding whether to buy a quarterback. */
    const share = shareOfRemainingFrom(S, 1, SURVIVOR_ALL_STARS_SUPERFLEX_WEEK)!
    const calendar = 9 / 17
    expect(share).toBeLessThan(calendar)
    expect(share).toBeGreaterThan(0.2)
  })

  it('rises to 1.0 once the change is behind you, and is 1.0 from the change week itself', () => {
    expect(shareOfRemainingFrom(S, 9, 9)).toBe(1)
    expect(shareOfRemainingFrom(S, 14, 9)).toBe(1)
    expect(shareOfRemainingFrom(S, 17, 9)).toBe(1)
  })

  it('rises monotonically as the change approaches', () => {
    let prev = -1
    for (const w of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
      const s = shareOfRemainingFrom(S, w, 9)!
      expect(s, `week ${w}`).toBeGreaterThan(prev)
      prev = s
    }
  })

  it('🛑 blends a real quarterback rather than picking a chart — measured values, both directions', () => {
    /*
     * Josh Allen on the live prod charts, 12-team pair: 5,688 at 1QB and 10,500 at superflex
     * (+85%). Neither number is right for this league before Week 9, and the gap is far too large
     * to round away — the top eight QBs measured +79% to +98%, median rank gain +38.
     */
    const early = blendAcrossRosterChange({ schedule: S, week: 1, changeWeek: 9, before: 5688, after: 10500 })!
    expect(early.value).toBeGreaterThan(5688)
    expect(early.value).toBeLessThan(10500)
    expect(early.reason).toMatch(/blended/)

    const late = blendAcrossRosterChange({ schedule: S, week: 10, changeWeek: 9, before: 5688, after: 10500 })!
    expect(late.value).toBe(10500)
    expect(late.shareAfter).toBe(1)
    expect(late.reason).toMatch(/behind you/)
    expect(late.reason).not.toMatch(/never arrives/)

    // The blend must move toward the superflex number as Week 9 approaches, never away from it.
    const w8 = blendAcrossRosterChange({ schedule: S, week: 8, changeWeek: 9, before: 5688, after: 10500 })!
    expect(w8.value).toBeGreaterThan(early.value)
  })

  it('[control] a non-quarterback whose value does NOT change is unmoved at every week', () => {
    /* Measured: the top receivers move between -3% and +1% across a numQbs change. A blend of two
     * equal numbers must return that number exactly, or the machinery is inventing movement. */
    for (const w of [1, 5, 9, 14, 17]) {
      expect(blendAcrossRosterChange({ schedule: S, week: w, changeWeek: 9, before: 9654, after: 9654 })!.value).toBe(9654)
    }
  })

  it('🛑 returns NULL rather than one side when it cannot tell', () => {
    expect(blendAcrossRosterChange({ schedule: null, week: 1, changeWeek: 9, before: 100, after: 200 })).toBeNull()
    expect(blendAcrossRosterChange({ schedule: S, week: 30, changeWeek: 9, before: 100, after: 200 })).toBeNull()
    expect(blendAcrossRosterChange({ schedule: S, week: 1, changeWeek: 9, before: Number.NaN, after: 200 })).toBeNull()
  })
})
