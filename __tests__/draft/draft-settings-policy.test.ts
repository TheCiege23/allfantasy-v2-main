import { describe, expect, it } from 'vitest'
import {
  CUSTOM_TIMER_MAX_SECONDS,
  CUSTOM_TIMER_MIN_SECONDS,
  STANDARD_TIMER_SECONDS,
  buildRandomizeChatMessage,
  clampRandomizeTimes,
  classifyDraftPace,
  computeDraftRoundsFromSlots,
  customTimerToSeconds,
  formatCountsTaxiAndDevy,
  secondsToCustomParts,
  shuffleTimes,
  slowDraftPauseAllowed,
  timerOptionsFor,
  validateDraftTimerSeconds,
} from '@/lib/draft/draftSettingsPolicy'

describe('time per pick — the standard list', () => {
  it('is exactly 30s, 1m, 90s, 2m, 5m, 10m, 20m, 30m, 1h, 2h, 4h, 6h, 8h', () => {
    expect([...STANDARD_TIMER_SECONDS]).toEqual([30, 60, 90, 120, 300, 600, 1200, 1800, 3600, 7200, 14400, 21600, 28800])
  })
  it('shows a saved off-list value (e.g. a legacy 24h) in sorted position, once', () => {
    expect(timerOptionsFor(86400).at(-1)).toBe(86400)
    expect(timerOptionsFor(45).slice(0, 2)).toEqual([30, 45])
    expect(timerOptionsFor(90)).toEqual([...STANDARD_TIMER_SECONDS])
    expect(timerOptionsFor(null)).toEqual([...STANDARD_TIMER_SECONDS])
  })
})

describe('validateDraftTimerSeconds', () => {
  const free = { allowCustom: false }
  const sub = { allowCustom: true }
  it('accepts every standard value and the legacy 12h / 24h for anyone', () => {
    for (const s of [...STANDARD_TIMER_SECONDS, 43200, 86400]) expect(validateDraftTimerSeconds(s, free)).toEqual({ ok: true, seconds: s })
  })
  it('refuses a custom value without the subscription — unless it is the league’s saved value', () => {
    expect(validateDraftTimerSeconds(45, free)).toMatchObject({ ok: false, code: 'TIMER_CUSTOM_REQUIRES_SUBSCRIPTION' })
    expect(validateDraftTimerSeconds(45, { allowCustom: false, currentSeconds: 45 })).toEqual({ ok: true, seconds: 45 })
  })
  it('accepts a custom value within 10s..72h for AF Commissioner, rounding to whole seconds', () => {
    expect(validateDraftTimerSeconds(CUSTOM_TIMER_MIN_SECONDS, sub)).toEqual({ ok: true, seconds: 10 })
    expect(validateDraftTimerSeconds(CUSTOM_TIMER_MAX_SECONDS, sub)).toEqual({ ok: true, seconds: 259200 })
    expect(validateDraftTimerSeconds('2700', sub)).toEqual({ ok: true, seconds: 2700 })
    expect(validateDraftTimerSeconds(44.6, sub)).toEqual({ ok: true, seconds: 45 })
  })
  it('refuses out-of-range and non-numbers', () => {
    expect(validateDraftTimerSeconds(9, sub)).toMatchObject({ ok: false, code: 'TIMER_OUT_OF_RANGE' })
    expect(validateDraftTimerSeconds(CUSTOM_TIMER_MAX_SECONDS + 1, sub)).toMatchObject({ ok: false, code: 'TIMER_OUT_OF_RANGE' })
    expect(validateDraftTimerSeconds('abc', sub)).toMatchObject({ ok: false, code: 'TIMER_INVALID' })
    expect(validateDraftTimerSeconds(undefined, sub)).toMatchObject({ ok: false, code: 'TIMER_INVALID' })
    expect(validateDraftTimerSeconds(Number.NaN, sub)).toMatchObject({ ok: false, code: 'TIMER_INVALID' })
  })
})

describe('custom timer editor', () => {
  it('converts amount + unit, decimals allowed, bounds enforced', () => {
    expect(customTimerToSeconds(45, 'minutes')).toBe(2700)
    expect(customTimerToSeconds('1.5', 'hours')).toBe(5400)
    expect(customTimerToSeconds(72, 'hours')).toBe(259200)
    expect(customTimerToSeconds(73, 'hours')).toBeNull()
    expect(customTimerToSeconds(0.1, 'minutes')).toBeNull() // 6s < 10s
    expect(customTimerToSeconds(0, 'minutes')).toBeNull()
    expect(customTimerToSeconds('', 'minutes')).toBeNull()
  })
  it('pre-fills from a saved value in the best unit', () => {
    expect(secondsToCustomParts(7200)).toEqual({ amount: 2, unit: 'hours' })
    expect(secondsToCustomParts(2700)).toEqual({ amount: 45, unit: 'minutes' })
    expect(secondsToCustomParts(90)).toEqual({ amount: 1.5, unit: 'minutes' })
  })
})

describe('pace labels', () => {
  it('slow at ≥ 30 min, middy from 3 min to < 30 min, live under 3 min', () => {
    expect(classifyDraftPace(1800)).toBe('slow')
    expect(classifyDraftPace(28800)).toBe('slow')
    expect(classifyDraftPace(1799)).toBe('middy')
    expect(classifyDraftPace(180)).toBe('middy')
    expect(classifyDraftPace(179)).toBe('fast')
    expect(classifyDraftPace(30)).toBe('fast')
    expect(classifyDraftPace(0)).toBeNull()
    expect(classifyDraftPace(null)).toBeNull()
  })
  it('the overnight auto-pause is available only for a slow draft', () => {
    expect(slowDraftPauseAllowed(1800)).toBe(true)
    expect(slowDraftPauseAllowed(1200)).toBe(false)
    expect(slowDraftPauseAllowed(90)).toBe(false)
  })
})

describe('rounds = draftable roster spots', () => {
  // Template rows shaped like RosterTemplateService's defaults.
  const slots = [
    { slotName: 'QB', starterCount: 1, benchCount: 0, reserveCount: 0, taxiCount: 0, devyCount: 0 },
    { slotName: 'RB', starterCount: 2, benchCount: 0, reserveCount: 0, taxiCount: 0, devyCount: 0 },
    { slotName: 'WR', starterCount: 3, benchCount: 0, reserveCount: 0, taxiCount: 0, devyCount: 0 },
    { slotName: 'FLEX', starterCount: 1, benchCount: 0, reserveCount: 0, taxiCount: 0, devyCount: 0 },
    { slotName: 'BN', starterCount: 0, benchCount: 7, reserveCount: 0, taxiCount: 0, devyCount: 0 },
    { slotName: 'IR', starterCount: 0, benchCount: 0, reserveCount: 2, taxiCount: 0, devyCount: 0 },
    { slotName: 'TAXI', starterCount: 0, benchCount: 0, reserveCount: 0, taxiCount: 3, devyCount: 0 },
    { slotName: 'DEVY', starterCount: 0, benchCount: 0, reserveCount: 0, taxiCount: 0, devyCount: 2 },
  ]
  it('redraft: starters + bench; IR, taxi and devy excluded', () => {
    const r = computeDraftRoundsFromSlots(slots, false)
    expect(r).toMatchObject({ rounds: 14, rosterSpots: 14, starters: 7, bench: 7, irExcluded: 2, taxiDevyCounted: 0, taxiDevyExcluded: 5 })
  })
  it('dynasty/devy/C2C/salary cap: taxi and devy count, IR still does not', () => {
    const r = computeDraftRoundsFromSlots(slots, true)
    expect(r).toMatchObject({ rounds: 19, rosterSpots: 19, irExcluded: 2, taxiDevyCounted: 5, taxiDevyExcluded: 0 })
  })
  it('an IR/IL row is excluded even when its count is modelled as starters', () => {
    const r = computeDraftRoundsFromSlots([
      { slotName: 'C', starterCount: 2 },
      { slotName: 'IL', starterCount: 4 },
      { slotName: 'INJURED_RESERVE', benchCount: 1 },
    ], false)
    expect(r).toMatchObject({ rounds: 2, irExcluded: 5 })
  })
  it('caps at 50 and reports 0 for an empty template', () => {
    expect(computeDraftRoundsFromSlots([{ slotName: 'BN', benchCount: 80 }], false).rounds).toBe(50)
    expect(computeDraftRoundsFromSlots([], false)).toMatchObject({ rounds: 0, rosterSpots: 0 })
  })
  it('format detection', () => {
    for (const v of ['dynasty', 'DEVY', 'c2c', 'salary_cap', 'Salary Cap', 'devy_dynasty', 'DYNASTY_IDP', 'campus_to_canton']) {
      expect(formatCountsTaxiAndDevy([v]), v).toBe(true)
    }
    for (const v of ['redraft', 'keeper', 'big_brother', 'best_ball', '', null]) expect(formatCountsTaxiAndDevy([v]), String(v)).toBe(false)
    expect(formatCountsTaxiAndDevy(['redraft'], true)).toBe(true) // legacy isDynasty flag
  })
})

describe('randomize ×N', () => {
  it('non-subscribers always get one shuffle; subscribers 1–100', () => {
    expect(clampRandomizeTimes(20, false)).toBe(1)
    expect(clampRandomizeTimes(20, true)).toBe(20)
    expect(clampRandomizeTimes('100', true)).toBe(100)
    expect(clampRandomizeTimes(undefined, true)).toBe(1)
    expect(clampRandomizeTimes(0, true)).toBeNull()
    expect(clampRandomizeTimes(101, true)).toBeNull()
    expect(clampRandomizeTimes(2.5, true)).toBeNull()
  })
  it('shuffles N passes and keeps every team exactly once', () => {
    let calls = 0
    const rnd = () => { calls++; return 0.37 }
    const out = shuffleTimes(['a', 'b', 'c', 'd'], 5, rnd)
    expect([...out].sort()).toEqual(['a', 'b', 'c', 'd'])
    expect(calls).toBe(5 * 3) // n-1 swaps per pass
  })
  it('chat message names the count and the final order', () => {
    expect(buildRandomizeChatMessage(20, ['Aces', 'Bees'])).toBe('🎲 Draft order randomized 20 times — final order:\n1. Aces\n2. Bees')
    expect(buildRandomizeChatMessage(1, ['Aces'])).toBe('🎲 Draft order randomized — final order:\n1. Aces')
  })
})
