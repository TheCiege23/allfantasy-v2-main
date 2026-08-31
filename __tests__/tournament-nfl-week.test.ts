// @vitest-environment node
/**
 * Guards how a scheduled ingest works out which week it is.
 *
 * 🛑 A CRON CANNOT CARRY A MOVING WEEK. `cron-schedule.json` holds a literal
 * path, so the scheduled entry either hardcodes a week — wrong the moment the
 * season moves on — or resolves it at run time. The danger in resolving it is
 * that a wrong answer files a real week's scores under a number nothing else
 * uses, and nothing downstream could tell.
 */
import { describe, it, expect } from 'vitest'
import {
  parseNflState,
  resolveCurrentNflWeek,
  weeksToSweep,
} from '@/lib/tournament/resolveNflWeek'

describe('reading the platform’s own state', () => {
  it('takes season and week, coercing the strings Sleeper sends', () => {
    expect(parseNflState({ season: '2025', week: '6' })).toEqual({ season: 2025, week: 6 })
  })

  /**
   * ⚠ `week`, NOT `display_week`. They diverge in the offseason and around the
   * playoffs, and `week` is what `matchups/{week}` is keyed on — ingesting under
   * a display week files real scores under a number nothing else uses.
   */
  it('uses week rather than display_week when they disagree', () => {
    expect(parseNflState({ season: 2025, week: 6, display_week: 7 })?.week).toBe(6)
  })

  /**
   * 🛑 REFUSES RATHER THAN GUESSING. A scheduler that cannot establish the week
   * must do nothing — ingesting under an invented number is worse than skipping
   * a night, because the wrong rows look exactly like right ones.
   */
  it('returns null for anything it cannot read', () => {
    for (const bad of [null, undefined, {}, { season: 2025 }, { week: 6 }, { season: 'x', week: 'y' }]) {
      expect(parseNflState(bad as never)).toBeNull()
    }
  })

  /** Week 0 is the preseason state — nothing played, nothing to collect. */
  it('treats week 0 as nothing to ingest', () => {
    expect(parseNflState({ season: 2025, week: 0 })).toBeNull()
  })

  it('rejects an implausible season rather than trusting the payload', () => {
    expect(parseNflState({ season: 5, week: 3 })).toBeNull()
  })

  it('returns null when the fetch throws, instead of propagating', async () => {
    const out = await resolveCurrentNflWeek(async () => {
      throw new Error('network down')
    })
    expect(out).toBeNull()
  })

  it('returns the parsed week from a successful fetch', async () => {
    expect(await resolveCurrentNflWeek(async () => ({ season: 2025, week: 9 }))).toEqual({
      season: 2025,
      week: 9,
    })
  })
})

/**
 * 🛑 THE CURRENT WEEK ALONE IS NOT ENOUGH, BECAUSE OF A ONE-DAY WINDOW. Sleeper
 * advances `week` early in the new week while the week just played is only then
 * settling into its final numbers. Collecting the current week only would
 * capture partial scores every day and never once record the finished totals —
 * standings trailing reality by a week, invisibly.
 */
describe('which weeks a scheduled sweep collects', () => {
  it('takes the current week and the one before it', () => {
    expect(weeksToSweep({ season: 2025, week: 9 })).toEqual([
      { season: 2025, week: 9 },
      { season: 2025, week: 8 },
    ])
  })

  /** ⚠ No week 0: there is no previous week to reach back to in week 1. */
  it('does not reach below week 1', () => {
    expect(weeksToSweep({ season: 2025, week: 1 })).toEqual([{ season: 2025, week: 1 }])
  })

  it('stays within the same season', () => {
    for (const w of weeksToSweep({ season: 2025, week: 4 })) {
      expect(w.season).toBe(2025)
    }
  })
})
