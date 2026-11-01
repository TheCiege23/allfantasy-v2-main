/**
 * Draft settings — the hourly pick-timer list, the "Number of randomizes" run that is replayed pass
 * by pass, and the typed draft date. Panel behaviour is in draft-settings-panel.test.tsx.
 */
import { describe, expect, it } from 'vitest'
import {
  HOURLY_TIMER_SECONDS,
  RANDOMIZE_COUNT_OPTIONS,
  RANDOMIZE_MAX_TIMES,
  STANDARD_TIMER_SECONDS,
  buildRandomizeChatMessage,
  randomizeStepMs,
  shuffleTimes,
  shuffleTimesWithSteps,
  timerSelectOptions,
  validateDraftTimerSeconds,
} from '@/lib/draft/draftSettingsPolicy'
import { formatTypedDate, parseTypedDate } from '@/components/league-settings/DraftSettingsCommissionerPanel'

/** Deterministic `random` so two runs can be compared. */
function seeded(seed: number) {
  let x = seed
  return () => {
    x = (x * 16807) % 2147483647
    return (x - 1) / 2147483646
  }
}

describe('time per pick — every hour 1 to 24', () => {
  it('is exactly 1h..24h', () => {
    expect(HOURLY_TIMER_SECONDS.length).toBe(24)
    expect(HOURLY_TIMER_SECONDS[0]).toBe(3600)
    expect(HOURLY_TIMER_SECONDS.at(-1)).toBe(86400)
  })

  it('with the plan: standard list plus every hour, nothing locked', () => {
    const opts = timerSelectOptions(90, true)
    const secs = opts.map((o) => o.seconds)
    for (const s of [...STANDARD_TIMER_SECONDS, ...HOURLY_TIMER_SECONDS]) expect(secs).toContain(s)
    expect(secs).toEqual([...secs].sort((a, b) => a - b))
    expect(new Set(secs).size).toBe(secs.length)
    expect(opts.every((o) => !o.locked)).toBe(true)
  })

  it('without the plan: the extra hours (legacy 12h/24h too) are listed but locked; standard hours stay open', () => {
    const byS = new Map(timerSelectOptions(90, false).map((o) => [o.seconds, o.locked]))
    expect(byS.get(3 * 3600)).toBe(true)
    expect(byS.get(24 * 3600)).toBe(true)
    for (const s of STANDARD_TIMER_SECONDS) expect(byS.get(s)).toBe(false)
  })

  it('never locks the value the league already saved', () => {
    const byS = new Map(timerSelectOptions(5 * 3600, false).map((o) => [o.seconds, o.locked]))
    expect(byS.get(5 * 3600)).toBe(false)
  })

  it('the server accepts every hour for the plan and refuses the extra ones without it', () => {
    for (const s of HOURLY_TIMER_SECONDS) expect(validateDraftTimerSeconds(s, { allowCustom: true }).ok).toBe(true)
    const free = validateDraftTimerSeconds(3 * 3600, { allowCustom: false })
    expect(free.ok).toBe(false)
    if (!free.ok) expect(free.code).toBe('TIMER_CUSTOM_REQUIRES_SUBSCRIPTION')
    expect(validateDraftTimerSeconds(2 * 3600, { allowCustom: false }).ok).toBe(true)
  })
})

describe('randomize — every pass is kept so it can be shown', () => {
  it('the count dropdown is 1–20, 25, 50, 100', () => {
    expect([...RANDOMIZE_COUNT_OPTIONS]).toEqual([...Array.from({ length: 20 }, (_, i) => i + 1), 25, 50, 100])
    expect(Math.max(...RANDOMIZE_COUNT_OPTIONS)).toBe(RANDOMIZE_MAX_TIMES)
  })

  it('returns one step per pass, the last step is the final order, and it matches shuffleTimes', () => {
    const teams = ['A', 'B', 'C', 'D', 'E', 'F']
    const run = shuffleTimesWithSteps(teams, 9, seeded(42))
    expect(run.steps.length).toBe(9)
    expect(run.steps.at(-1)).toEqual(run.final)
    for (const step of run.steps) expect([...step].sort()).toEqual(teams)
    expect(shuffleTimes(teams, 9, seeded(42))).toEqual(run.final)
    // The input is never mutated.
    expect(teams).toEqual(['A', 'B', 'C', 'D', 'E', 'F'])
  })

  it('each pass is its own array, so replaying one does not change another', () => {
    const run = shuffleTimesWithSteps([1, 2, 3, 4], 3, seeded(7))
    expect(run.steps[0]).not.toBe(run.steps[1])
  })

  it('step timing stays readable: 900ms for a few, 250ms floor, ~15s budget', () => {
    expect(randomizeStepMs(1)).toBe(900)
    expect(randomizeStepMs(9)).toBe(900)
    expect(randomizeStepMs(50)).toBe(300)
    expect(randomizeStepMs(100)).toBe(250)
  })

  it('chat credits who chose the number, only when more than one shuffle ran', () => {
    expect(buildRandomizeChatMessage(9, ['A', 'B'], 'Mixon It Up')).toMatch(/^🎲 Draft order randomized 9 times \(number chosen by Mixon It Up\) — final order:/)
    expect(buildRandomizeChatMessage(1, ['A'], 'Mixon It Up')).toMatch(/^🎲 Draft order randomized — final order:/)
    expect(buildRandomizeChatMessage(3, ['A'])).toMatch(/^🎲 Draft order randomized 3 times — final order:/)
  })
})

describe('typed draft date', () => {
  it('reads the language’s order: month first in English, day first in Spanish', () => {
    expect(parseTypedDate('08/29/2027', 'en')).toBe('2027-08-29')
    expect(parseTypedDate('8/29/2027', 'en')).toBe('2027-08-29')
    expect(parseTypedDate('29/08/2027', 'es')).toBe('2027-08-29')
    expect(parseTypedDate('29-8-2027', 'es')).toBe('2027-08-29')
    expect(parseTypedDate('2027-08-29', 'es')).toBe('2027-08-29')
  })

  it('refuses dates that do not exist and text that is not a date', () => {
    expect(parseTypedDate('02/30/2027', 'en')).toBeNull()
    expect(parseTypedDate('29/08/2027', 'en')).toBeNull()
    expect(parseTypedDate('13/01/2027', 'en')).toBeNull()
    expect(parseTypedDate('next sunday', 'en')).toBeNull()
    expect(parseTypedDate('', 'en')).toBeNull()
    expect(parseTypedDate('02/29/2028', 'en')).toBe('2028-02-29')
    expect(parseTypedDate('02/29/2027', 'en')).toBeNull()
  })

  it('formats a saved date back into the same order', () => {
    expect(formatTypedDate('2027-08-29', 'en')).toBe('08/29/2027')
    expect(formatTypedDate('2027-08-29', 'es')).toBe('29/08/2027')
    expect(formatTypedDate('', 'en')).toBe('')
  })
})
